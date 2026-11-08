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
        var full = Path.GetFullPath(root);
        if (full == Path.GetPathRoot(full)) return ExecutorReject.RootUnusable;
        return null;
    }

    public static string? ValidateCommand(string command, IReadOnlyList<string> allowlist)
    {
        var name = Path.GetFileName(command);
        if (string.IsNullOrWhiteSpace(name)) return ExecutorReject.CommandNotAllowed;
        if (ExecutorReject.Shells.Contains(name, StringComparer.OrdinalIgnoreCase))
            return ExecutorReject.CommandNotAllowed;
        if (!allowlist.Contains(name, StringComparer.Ordinal)) return ExecutorReject.CommandNotAllowed;
        return null;
    }

    public static string? ValidateWorkDir(string root, string directory)
    {
        var rootFull = Path.TrimEndingDirectorySeparator(Path.GetFullPath(root));
        var dirFull = Path.TrimEndingDirectorySeparator(Path.GetFullPath(directory));
        var separator = Path.DirectorySeparatorChar.ToString();
        return dirFull == rootFull || dirFull.StartsWith(rootFull + separator, StringComparison.Ordinal)
            ? null
            : ExecutorReject.DirOutsideRoot;
    }

    public static string? ValidateEnvironment(IReadOnlyDictionary<string, string> environment) =>
        environment.Keys.All(k => ExecutorReject.EnvAllow.Contains(k, StringComparer.Ordinal))
            ? null
            : ExecutorReject.EnvNotAllowed;

    public static string Truncate(string value)
    {
        if (value.Length <= Limits.MaxOutputBytes) return value;
        return value[..Limits.MaxOutputBytes] + "\n[truncated]";
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

    public async Task<ExecResult> ExecuteAsync(ShellConfig config, ExecRequest request, CancellationToken ct = default)
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
        try { return await SpawnAsync(request.Command, request.Args, dir, environment, ct).ConfigureAwait(false); }
        finally { _slots.Release(); }
    }

    private void EnsureSlots(int max)
    {
        max = Math.Clamp(max, 1, 8);
        if (max == _configuredSlots) return;
        _slots.Dispose();
        _slots = new SemaphoreSlim(max, max);
        _configuredSlots = max;
    }

    private static async Task<ExecResult> SpawnAsync(
        string command, string[] args, string directory,
        IReadOnlyDictionary<string, string> environment, CancellationToken ct)
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

        using var process = Process.Start(psi) ?? throw new ExecutorRejectException(ExecutorReject.SpawnFailed);
        var stdout = process.StandardOutput.ReadToEndAsync(ct);
        var stderr = process.StandardError.ReadToEndAsync(ct);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(global::AgentBuddy.Core.Contracts.Limits.ExecutorTimeoutSeconds));
        var timedOut = false;
        try { await process.WaitForExitAsync(timeout.Token).ConfigureAwait(false); }
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
        return new ExecResult(exitCode, ExecutorPolicy.Truncate(outText), ExecutorPolicy.Truncate(errText), timedOut);
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
