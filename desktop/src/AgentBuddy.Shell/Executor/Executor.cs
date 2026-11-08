using System.Diagnostics;
using System.Text.Json;
using AgentBuddy.Core.Contracts;
using AgentBuddy.Core.Gateway;
using AgentBuddy.Shell.Credentials;

namespace AgentBuddy.Shell.Executor;

public sealed record ExecRequest(
    string Command,
    string[] Args,
    string WorkingDirectory,
    IReadOnlyDictionary<string, string>? Environment = null);

public sealed record ExecResult(int ExitCode, string Stdout, string Stderr, bool TimedOut);

public sealed record ExecutorLimits(int MaxOutputBytes, int TimeoutSeconds, bool ShellsRefused);

public sealed class ExecutorRejectException(string reason) : Exception(reason)
{
    public string Reason { get; } = reason;
}

/// <summary>
/// All BYOM safety decisions are pure functions here. Commands are matched by
/// exact name, never assembled into a shell string. The root must be absolute
/// and every path/environment variable must stay inside its allowlists.
/// </summary>
public static class ExecutorPolicy
{
    public static string? ValidateRoot(string root)
    {
        if (string.IsNullOrWhiteSpace(root) || !Path.IsPathFullyQualified(root) || !Directory.Exists(root))
            return ExecutorReject.RootUnusable;
        var full = Path.TrimEndingDirectorySeparator(Path.GetFullPath(root));
        // A root that is a link to "/" (or "C:\") is the filesystem root in disguise.
        var resolved = Path.TrimEndingDirectorySeparator(ResolveExisting(full));
        if (IsFileSystemRoot(resolved)) return ExecutorReject.RootUnusable;
        return null;
    }

    public static string? ValidateCommand(string command, IReadOnlyList<string> allowlist)
    {
        // The allowlist matches an exact name and the name is what gets spawned.
        // Anything with a directory part ("../x", "/bin/x", "C:\x") is refused so a
        // relative or absolute path can never ride in on an allowlisted basename.
        if (string.IsNullOrWhiteSpace(command) || command != command.Trim()) return ExecutorReject.CommandNotAllowed;
        if (Path.IsPathRooted(command)) return ExecutorReject.CommandNotAllowed;
        if (command.Contains('/') || command.Contains('\\')) return ExecutorReject.CommandNotAllowed;
        if (Path.GetFileName(command) != command) return ExecutorReject.CommandNotAllowed;
        if (command is "." or "..") return ExecutorReject.CommandNotAllowed;
        if (command.Any(char.IsControl)) return ExecutorReject.CommandNotAllowed;
        if (ExecutorReject.Shells.Contains(command, StringComparer.OrdinalIgnoreCase))
            return ExecutorReject.CommandNotAllowed;
        if (ExecutorReject.Launchers.Contains(command, StringComparer.OrdinalIgnoreCase))
            return ExecutorReject.CommandNotAllowed;
        if (!allowlist.Contains(command, StringComparer.Ordinal)) return ExecutorReject.CommandNotAllowed;
        return null;
    }

    /// <summary>
    /// Both sides are resolved through any symlink first, so a link inside the root
    /// that points elsewhere is rejected instead of being compared as a string.
    /// </summary>
    public static string? ValidateWorkDir(string root, string directory)
    {
        var rootFull = Path.TrimEndingDirectorySeparator(ResolveExisting(Path.GetFullPath(root)));
        var dirFull = Path.TrimEndingDirectorySeparator(ResolveExisting(Path.GetFullPath(directory)));
        var separator = Path.DirectorySeparatorChar.ToString();
        var comparison = OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;
        return dirFull.Equals(rootFull, comparison) ||
               dirFull.StartsWith(rootFull + separator, comparison)
            ? null
            : ExecutorReject.DirOutsideRoot;
    }

    public static string? ValidateEnvironment(IReadOnlyDictionary<string, string> environment) =>
        environment.Keys.All(k => ExecutorReject.EnvAllow.Contains(k, StringComparer.Ordinal))
            ? null
            : ExecutorReject.EnvNotAllowed;

    /// <summary>
    /// An allowlist entry is a command name, not a command line: no separators, no
    /// shell, no launcher. Validated when the setting is saved as well as when used.
    /// </summary>
    public static string? ValidateAllowlistEntry(string? entry)
    {
        if (string.IsNullOrWhiteSpace(entry) || entry != entry.Trim()) return ExecutorReject.CommandNotAllowed;
        if (entry.Contains('/') || entry.Contains('\\') || entry.Contains(' ') || entry.Any(char.IsControl))
            return ExecutorReject.CommandNotAllowed;
        if (Path.GetFileName(entry) != entry || Path.IsPathRooted(entry) || entry is "." or "..")
            return ExecutorReject.CommandNotAllowed;
        if (ExecutorReject.Shells.Contains(entry, StringComparer.OrdinalIgnoreCase)) return ExecutorReject.CommandNotAllowed;
        if (ExecutorReject.Launchers.Contains(entry, StringComparer.OrdinalIgnoreCase)) return ExecutorReject.CommandNotAllowed;
        return null;
    }

    public static string Truncate(string value)
    {
        if (value.Length <= Limits.MaxOutputBytes) return value;
        return value[..Limits.MaxOutputBytes] + "\n[truncated]";
    }

    /// <summary>
    /// Resolves the deepest existing ancestor through its final link target and
    /// re-appends the parts that do not exist yet. Never throws; an unreadable
    /// path simply keeps its literal form.
    /// </summary>
    public static string ResolveExisting(string path)
    {
        try
        {
            var remainder = new List<string>();
            var probe = path;
            while (!string.IsNullOrEmpty(probe) && !Directory.Exists(probe) && !File.Exists(probe))
            {
                var parent = Path.GetDirectoryName(probe);
                if (string.IsNullOrEmpty(parent) || parent == probe) return path;
                remainder.Insert(0, Path.GetFileName(probe));
                probe = parent;
            }
            if (!Directory.Exists(probe) && !File.Exists(probe)) return path;
            var target = Directory.Exists(probe)
                ? Directory.ResolveLinkTarget(probe, returnFinalTarget: true)?.FullName
                : File.ResolveLinkTarget(probe, returnFinalTarget: true)?.FullName;
            if (target is null) return path;
            return remainder.Count == 0 ? target : Path.Combine([target, .. remainder]);
        }
        catch (Exception) { return path; }
    }

    private static bool IsFileSystemRoot(string path)
    {
        var trimmed = Path.TrimEndingDirectorySeparator(path);
        return string.IsNullOrEmpty(trimmed) || trimmed == Path.GetPathRoot(trimmed);
    }
}

/// <summary>
/// .NET cannot setpgid() before exec, so a true Unix process group is not
/// available through System.Diagnostics.Process. We use the framework's
/// entireProcessTree kill after a TERM grace period and say so plainly; Windows
/// has no process-group semantics either and is not presented as having them.
/// </summary>
public static class ProcGroup
{
    public static void TerminateTree(Process process)
    {
        try
        {
            if (!process.HasExited)
            {
                if (!OperatingSystem.IsWindows()) Signal(process.Id, 15);
                Thread.Sleep(250);
                if (!process.HasExited) process.Kill(entireProcessTree: true);
            }
            process.WaitForExit(1000);
        }
        catch (Exception) { /* already gone */ }
    }

    [System.Runtime.InteropServices.DllImport("libc", EntryPoint = "kill", SetLastError = true)]
    private static extern int Signal(int pid, int sig);
}

/// <summary>Default off, explicit user confirmation required before enabling.</summary>
public sealed class ExecutorService(ICredentialStore credentials)
{
    private SemaphoreSlim _slots = new(1, 1);
    private int _configuredSlots = 1;

    public bool Enabled { get; private set; }
    public string Status => Enabled ? "running" : "disabled";

    public async Task<bool> HasApiKeyAsync(CancellationToken ct = default) =>
        !string.IsNullOrEmpty(await credentials.GetAsync("executor_api_key", ct).ConfigureAwait(false));
    public ExecutorLimits Limits => new(global::AgentBuddy.Core.Contracts.Limits.MaxOutputBytes,
        global::AgentBuddy.Core.Contracts.Limits.ExecutorTimeoutSeconds, true);

    public void SetEnabled(bool enabled, bool userConfirmed)
    {
        if (enabled && !userConfirmed)
            throw new ExecutorRejectException(ErrorCodes.Forbidden);
        Enabled = enabled;
    }

    public Task<ExecResult> ExecuteAsync(ShellConfig config, ExecRequest request, CancellationToken ct = default) =>
        ExecuteAsync(config, request,
            TimeSpan.FromSeconds(global::AgentBuddy.Core.Contracts.Limits.ExecutorTimeoutSeconds), ct);

    /// <summary>
    /// The budget is a parameter so the timeout/kill path can be driven in a test
    /// instead of waiting the production minute out.
    /// </summary>
    internal async Task<ExecResult> ExecuteAsync(ShellConfig config, ExecRequest request, TimeSpan timeout,
        CancellationToken ct = default)
    {
        if (!Enabled) throw new ExecutorRejectException(ExecutorReject.CommandNotAllowed);
        var rootError = ExecutorPolicy.ValidateRoot(config.ExecutorRoot);
        if (rootError is not null) throw new ExecutorRejectException(rootError);
        var commandError = ExecutorPolicy.ValidateCommand(request.Command, config.ExecutorAllowlist);
        if (commandError is not null) throw new ExecutorRejectException(commandError);
        var dir = string.IsNullOrWhiteSpace(request.WorkingDirectory) ? config.ExecutorRoot : request.WorkingDirectory;
        var dirError = ExecutorPolicy.ValidateWorkDir(config.ExecutorRoot, dir);
        if (dirError is not null) throw new ExecutorRejectException(dirError);
        var environment = request.Environment ?? new Dictionary<string, string>();
        var envError = ExecutorPolicy.ValidateEnvironment(environment);
        if (envError is not null) throw new ExecutorRejectException(envError);

        EnsureSlots(config.ExecutorMaxConcurrency);
        await _slots.WaitAsync(ct).ConfigureAwait(false);
        try { return await SpawnAsync(request.Command, request.Args, dir, environment, timeout, ct).ConfigureAwait(false); }
        finally { _slots.Release(); }
    }

    /// <summary>
    /// Changing the concurrency swaps in a fresh semaphore. The old one is left for
    /// the GC: disposing it while tasks still hold slots would throw ObjectDisposed
    /// on their Release(), and SemaphoreSlim only needs disposal for its wait handle.
    /// </summary>
    private void EnsureSlots(int max)
    {
        max = Math.Clamp(max, 1, 8);
        if (max == _configuredSlots) return;
        _slots = new SemaphoreSlim(max, max);
        _configuredSlots = max;
    }

    private static async Task<ExecResult> SpawnAsync(
        string command, string[] args, string directory,
        IReadOnlyDictionary<string, string> environment, TimeSpan timeout, CancellationToken ct)
    {
        var psi = new ProcessStartInfo(command)
        {
            WorkingDirectory = directory,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true
        };
        foreach (var arg in args) psi.ArgumentList.Add(arg); // argv directly, no shell
        psi.Environment.Clear();
        foreach (var key in ExecutorReject.EnvAllow)
        {
            var inherited = Environment.GetEnvironmentVariable(key);
            if (inherited is not null) psi.Environment[key] = inherited;
        }
        foreach (var (key, value) in environment)
            if (ExecutorReject.EnvAllow.Contains(key, StringComparer.Ordinal)) psi.Environment[key] = value;

        Process? started;
        try { started = Process.Start(psi); }
        catch (Exception) { throw new ExecutorRejectException(ExecutorReject.SpawnFailed); }
        if (started is null) throw new ExecutorRejectException(ExecutorReject.SpawnFailed);
        using var process = started;

        // Bounded reads: output past the cap is drained and discarded, never buffered.
        var stdout = ReadBoundedAsync(process.StandardOutput, ct);
        var stderr = ReadBoundedAsync(process.StandardError, ct);
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
        deadline.CancelAfter(timeout);
        var timedOut = false;
        try { await process.WaitForExitAsync(deadline.Token).ConfigureAwait(false); }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            timedOut = true;
            ProcGroup.TerminateTree(process);
        }
        string outText, errText;
        try { outText = await stdout.ConfigureAwait(false); } catch (OperationCanceledException) { outText = ""; }
        try { errText = await stderr.ConfigureAwait(false); } catch (OperationCanceledException) { errText = ""; }
        int exitCode;
        try { exitCode = process.HasExited ? process.ExitCode : -1; }
        catch (InvalidOperationException) { exitCode = -1; }
        return new ExecResult(exitCode, outText, errText, timedOut);
    }

    /// <summary>
    /// Keeps at most <see cref="global::AgentBuddy.Core.Contracts.Limits.MaxOutputBytes"/>
    /// characters but keeps reading until the pipe closes, so the child never blocks
    /// on a full buffer while a chatty command runs.
    /// </summary>
    private static async Task<string> ReadBoundedAsync(StreamReader reader, CancellationToken ct)
    {
        var bounded = new System.Text.StringBuilder();
        var buffer = new char[4096];
        var truncated = false;
        while (true)
        {
            var read = await reader.ReadAsync(buffer, ct).ConfigureAwait(false);
            if (read == 0) break;
            var room = global::AgentBuddy.Core.Contracts.Limits.MaxOutputBytes - bounded.Length;
            if (room <= 0) { truncated = true; continue; }
            var take = Math.Min(read, room);
            bounded.Append(buffer, 0, take);
            if (take < read) truncated = true;
        }
        if (truncated) bounded.Append("\n[truncated]");
        return bounded.ToString();
    }
}

/// <summary>The three-verb node protocol from executor/jobs.rs, without a session.</summary>
public sealed class NodeJobs(IAgentHubClient hub, ICredentialStore credentials)
{
    public async Task<JsonElement?> EnrollAsync(string nodeId, string name, string[] capabilities, CancellationToken ct = default)
    {
        var apiKey = await credentials.GetAsync("executor_api_key", ct).ConfigureAwait(false);
        if (string.IsNullOrEmpty(apiKey)) throw new HubApiException(ErrorCodes.Unauthenticated, 401);
        return await hub.SendAsync(Endpoints.SandboxNodes, HttpMethod.Post,
            new { id = nodeId, name, capabilities }, ct).ConfigureAwait(false);
    }

    public Task<JsonElement?> HeartbeatAsync(string nodeId, CancellationToken ct = default) =>
        hub.SendAsync(Endpoints.Format(Endpoints.SandboxNodeHeartbeat, ("id", nodeId)), HttpMethod.Post, null, ct);

    public Task<JsonElement?> ClaimAsync(string nodeId, int waitSeconds, CancellationToken ct = default) =>
        hub.SendAsync(Endpoints.WithQuery(Endpoints.Format(Endpoints.SandboxNodeJobs, ("id", nodeId)),
            ("wait", Math.Max(waitSeconds, 1))), HttpMethod.Get, null, ct);

    public Task<JsonElement?> ReportAsync(string nodeId, string jobId, ExecResult result, CancellationToken ct = default) =>
        hub.SendAsync(Endpoints.Format(Endpoints.SandboxNodeJobById, ("id", nodeId), ("jobId", jobId)),
            HttpMethod.Post, new { exitCode = result.ExitCode, stdout = result.Stdout, stderr = result.Stderr }, ct);
}
