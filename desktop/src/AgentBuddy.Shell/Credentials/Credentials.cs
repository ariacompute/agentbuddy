using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;
using System.Text.Json;
using AgentBuddy.Core.Contracts;
using AgentBuddy.Core.Services;

namespace AgentBuddy.Shell.Credentials;

public interface ICredentialStore
{
    string Backend { get; }
    Task<string?> GetAsync(string name, CancellationToken ct = default);
    Task SetAsync(string name, string secret, CancellationToken ct = default);
    Task DeleteAsync(string name, CancellationToken ct = default);
}

/// <summary>
/// agenthub session cookies and executor API keys belong to the OS credential
/// store. When no store is available we fall back to a file created 0600 from
/// the very first byte. Secrets are never written to config.json or logs.
/// </summary>
public sealed class CredentialStore(IAppPaths paths) : ICredentialStore
{
    public const string Service = "agentbuddy";
    private readonly ICredentialStore _primary = CreatePrimary();
    private readonly FileCredentialStore _fallback = new(paths);

    public string Backend { get; private set; } = "memory";

    public async Task<string?> GetAsync(string name, CancellationToken ct = default)
    {
        try
        {
            var value = await _primary.GetAsync(name, ct).ConfigureAwait(false);
            if (value is not null) { Backend = _primary.Backend; return value; }
        }
        catch (Exception) { /* unavailable store: fall back, log nothing about the secret */ }
        try
        {
            var fromFile = await _fallback.GetAsync(name, ct).ConfigureAwait(false);
            Backend = fromFile is null ? "memory" : "file";
            return fromFile;
        }
        catch (Exception) { Backend = "memory"; return null; } // corrupt or unreadable: behave as if signed out
    }

    public async Task SetAsync(string name, string secret, CancellationToken ct = default)
    {
        try
        {
            await _primary.SetAsync(name, secret, ct).ConfigureAwait(false);
            Backend = _primary.Backend;
            return;
        }
        catch (Exception) { /* fall through to the private file */ }
        await _fallback.SetAsync(name, secret, ct).ConfigureAwait(false);
        Backend = "file";
    }

    public async Task DeleteAsync(string name, CancellationToken ct = default)
    {
        try { await _primary.DeleteAsync(name, ct).ConfigureAwait(false); }
        catch (Exception) { /* best effort */ }
        try { await _fallback.DeleteAsync(name, ct).ConfigureAwait(false); }
        catch (Exception) { /* an unreadable store still counts as signed out */ }
    }

    private static ICredentialStore CreatePrimary()
    {
        if (OperatingSystem.IsWindows()) return new WindowsCredentialStore();
        if (OperatingSystem.IsMacOS() && Exists("security")) return new UnixCommandCredentialStore("macos");
        if (OperatingSystem.IsLinux() && Exists("secret-tool")) return new UnixCommandCredentialStore("linux");
        return new NoopCredentialStore();
    }

    /// <summary>
    /// Looks the helper up on PATH instead of spawning it: probing by execution would
    /// leave a process behind on every start and could block on a wedged helper.
    /// </summary>
    private static bool Exists(string executable)
    {
        var path = Environment.GetEnvironmentVariable("PATH") ?? "";
        foreach (var directory in path.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
        {
            try
            {
                if (File.Exists(Path.Combine(directory.Trim(), executable))) return true;
            }
            catch (Exception) { /* malformed PATH entry */ }
        }
        return false;
    }
}

public sealed class NoopCredentialStore : ICredentialStore
{
    public string Backend => "memory";
    public Task<string?> GetAsync(string name, CancellationToken ct = default) => Task.FromResult<string?>(null);
    public Task SetAsync(string name, string secret, CancellationToken ct = default) => throw new NotSupportedException("no credential store");
    public Task DeleteAsync(string name, CancellationToken ct = default) => Task.CompletedTask;
}

public sealed class FileCredentialStore(IAppPaths paths) : ICredentialStore
{
    public string Backend => "file";

    private string FileFor(string name)
    {
        var safe = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(Encoding.UTF8.GetBytes(name)))[..32];
        return Path.Combine(paths.ConfigDir, "secrets", safe + ".json");
    }

    public async Task<string?> GetAsync(string name, CancellationToken ct = default)
    {
        var file = FileFor(name);
        if (!File.Exists(file)) return null;
        var json = await File.ReadAllTextAsync(file, ct).ConfigureAwait(false);
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.TryGetProperty("secret", out var value) ? value.GetString() : null;
    }

    public Task SetAsync(string name, string secret, CancellationToken ct = default)
    {
        ConfigService.WritePrivateFile(FileFor(name), JsonSerializer.Serialize(new { secret }));
        return Task.CompletedTask;
    }

    public Task DeleteAsync(string name, CancellationToken ct = default)
    {
        var file = FileFor(name);
        if (File.Exists(file)) File.Delete(file);
        return Task.CompletedTask;
    }
}

/// <summary>Windows Credential Manager (DPAPI-protected, per user).</summary>
public sealed class WindowsCredentialStore : ICredentialStore
{
    private const uint CredTypeGeneric = 1;
    private const uint PersistLocalMachine = 2;

    public string Backend => "keyring";

    private static string Target(string name) => CredentialStore.Service + "/" + name;

    public Task<string?> GetAsync(string name, CancellationToken ct = default)
    {
        if (!OperatingSystem.IsWindows()) return Task.FromResult<string?>(null);
        if (!CredReadW(Target(name), CredTypeGeneric, 0, out var pointer)) return Task.FromResult<string?>(null);
        try
        {
            var credential = Marshal.PtrToStructure<NativeCredential>(pointer);
            if (credential.CredentialBlob == IntPtr.Zero || credential.CredentialBlobSize < 2)
                return Task.FromResult<string?>(null);
            var raw = Marshal.PtrToStringUni(credential.CredentialBlob, (int)(credential.CredentialBlobSize / 2));
            return Task.FromResult<string?>(raw?.TrimEnd('\0'));
        }
        finally { CredFree(pointer); }
    }

    public Task SetAsync(string name, string secret, CancellationToken ct = default)
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException();
        var target = Marshal.StringToHGlobalUni(Target(name));
        var blob = Marshal.StringToHGlobalUni(secret);
        try
        {
            var credential = new NativeCredential
            {
                Type = CredTypeGeneric,
                TargetName = target,
                CredentialBlob = blob,
                CredentialBlobSize = (uint)((secret.Length + 1) * 2),
                Persist = PersistLocalMachine,
                UserName = Marshal.StringToHGlobalUni(Environment.UserName)
            };
            if (!CredWriteW(ref credential, 0)) throw new InvalidOperationException("credential write failed");
            return Task.CompletedTask;
        }
        finally
        {
            Marshal.FreeHGlobal(target);
            Marshal.FreeHGlobal(blob);
        }
    }

    public Task DeleteAsync(string name, CancellationToken ct = default)
    {
        if (OperatingSystem.IsWindows()) CredDeleteW(Target(name), CredTypeGeneric, 0);
        return Task.CompletedTask;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct NativeCredential
    {
        public uint Flags;
        public uint Type;
        public IntPtr TargetName;
        public IntPtr Comment;
        public FILETIME LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist;
        public uint AttributeCount;
        public IntPtr Attributes;
        public IntPtr TargetAlias;
        public IntPtr UserName;
    }

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredReadW(string target, uint type, uint flags, out IntPtr credential);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredWriteW(ref NativeCredential credential, uint flags);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredDeleteW(string target, uint type, uint flags);

    [DllImport("advapi32.dll")]
    private static extern void CredFree(IntPtr credential);
}

/// <summary>
/// macOS Keychain / Linux Secret Service via their command line clients.
/// On macOS the secret is passed as an argv element (Keychain has no stdin
/// mode); on Linux it goes over stdin. This limitation is documented rather
/// than hidden. Both fall back to the private file when the client is absent.
/// </summary>
public sealed class UnixCommandCredentialStore(string platform) : ICredentialStore
{
    public string Backend => platform == "macos" ? "keychain" : "secret-service";

    public async Task<string?> GetAsync(string name, CancellationToken ct = default)
    {
        var (file, args) = platform == "macos"
            ? ("security", new[] { "find-generic-password", "-a", CredentialStore.Service, "-s", ServiceFor(name), "-w" })
            : ("secret-tool", new[] { "lookup", "service", CredentialStore.Service, "name", name });
        return (await RunAsync(file, args, null, ct).ConfigureAwait(false))?.TrimEnd('\r', '\n');
    }

    public async Task SetAsync(string name, string secret, CancellationToken ct = default)
    {
        var (file, args, stdin) = platform == "macos"
            ? ("security", new[] { "add-generic-password", "-a", CredentialStore.Service, "-s", ServiceFor(name), "-w", secret, "-U" }, (string?)null)
            : ("secret-tool", new[] { "store", "--label=agentbuddy", "service", CredentialStore.Service, "name", name }, secret);
        await RunAsync(file, args, stdin, ct).ConfigureAwait(false);
    }

    public Task DeleteAsync(string name, CancellationToken ct = default) => Task.CompletedTask;

    private static string ServiceFor(string name) => CredentialStore.Service + "." + name;

    /// <summary>
    /// A locked or prompting keychain answers slowly or not at all; without a budget
    /// the whole gateway request would wait with it. The helper is killed on timeout.
    /// </summary>
    private static async Task<string?> RunAsync(string file, string[] args, string? stdin, CancellationToken ct)
    {
        var psi = new ProcessStartInfo(file)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardInput = stdin is not null,
            RedirectStandardError = true
        };
        foreach (var arg in args) psi.ArgumentList.Add(arg);
        using var process = Process.Start(psi) ?? throw new InvalidOperationException("credential client unavailable");
        using var budget = CancellationTokenSource.CreateLinkedTokenSource(ct);
        budget.CancelAfter(TimeSpan.FromSeconds(Limits.CredentialTimeoutSeconds));
        try
        {
            if (stdin is not null)
            {
                await process.StandardInput.WriteAsync(stdin.AsMemory(), budget.Token).ConfigureAwait(false);
                process.StandardInput.Close();
            }
            var output = await process.StandardOutput.ReadToEndAsync(budget.Token).ConfigureAwait(false);
            await process.WaitForExitAsync(budget.Token).ConfigureAwait(false);
            return process.ExitCode == 0 ? output : null;
        }
        catch (OperationCanceledException)
        {
            try { if (!process.HasExited) process.Kill(entireProcessTree: true); } catch (Exception) { /* gone */ }
            throw new TimeoutException("credential helper timed out");
        }
    }
}
