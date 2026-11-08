using System.Diagnostics;
using System.Text;
using System.Text.Json;
using AgentBuddy.Core.Contracts;
using AgentBuddy.Core.Services;
using AgentBuddy.Shell;
using AgentBuddy.Shell.Credentials;
using AgentBuddy.Shell.Executor;
using AgentBuddy.Shell.Upgrade;
using Xunit;

namespace AgentBuddy.Shell.Tests;

/// <summary>The last few branches: installer outcome, gitee assets, store selection and the timeout kill.</summary>
public class ResidualShellTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "ab-" + Guid.NewGuid().ToString("N"));

    public ResidualShellTests() => Directory.CreateDirectory(_root);

    public void Dispose()
    {
        try { Directory.Delete(_root, true); } catch (Exception) { /* best effort */ }
    }

    private static string Manifest(string url) => JsonSerializer.Serialize(new
    {
        version = "9.9.9",
        notes = "n",
        platforms = new Dictionary<string, object> { ["windows-x86_64"] = new { url, signature = "sig" } },
        signatures = new Dictionary<string, string> { [Path.GetFileName(new Uri(url).AbsolutePath)] = "sig" }
    });

    [Fact]
    public async Task AVerifiedPackageIsHandedToTheInstallerAndItsExitCodeDecides()
    {
        var original = PlatformUpgradeInstaller.StartProcess;
        try
        {
            PlatformUpgradeInstaller.StartProcess = _ => Start("where", "where");
            Assert.True(await new PlatformUpgradeInstaller().InstallAsync([1, 2], "agentbuddy.msi", CancellationToken.None));

            PlatformUpgradeInstaller.StartProcess = _ => Start("where", "definitely-not-a-program-" + Guid.NewGuid().ToString("N"));
            Assert.False(await new PlatformUpgradeInstaller().InstallAsync([1], "agentbuddy.msi", CancellationToken.None));

            PlatformUpgradeInstaller.StartProcess = _ => null;
            Assert.False(await new PlatformUpgradeInstaller().InstallAsync([1], "agentbuddy.msi", CancellationToken.None));

            PlatformUpgradeInstaller.StartProcess = _ => throw new InvalidOperationException("no installer");
            Assert.False(await new PlatformUpgradeInstaller().InstallAsync([1], "agentbuddy.msi", CancellationToken.None));
        }
        finally { PlatformUpgradeInstaller.StartProcess = original; }
    }

    [Fact]
    public async Task AnUnexpectedSourceFailureBecomesNetworkFailed()
    {
        var config = new ConfigService(new AppPaths(Path.Combine(_root, "cfg")));
        var service = new UpgradeService(new ThrowingSource(), new NoDownloader(), new NoVerifier(), new NoInstaller(),
            config, "0.1.0", "k", "windows-x86_64");
        Assert.Equal("network_failed", (await service.CheckAsync()).Status);
    }

    [Fact]
    public async Task GiteeAssetsMustLiveOnGiteeAndCarryASignature()
    {
        var config = new ConfigService(new AppPaths(Path.Combine(_root, "cfg2")));
        var gitee = new UpgradeService(
            new StaticSource(new ReleaseProbe("gitee",
                Manifest("https://gitee.com/ariacompute/agentbuddy/releases/download/v9/agentbuddy-9.9.9.msi"), 1)),
            new NoDownloader(), new NoVerifier(), new NoInstaller(), config, "0.1.0", "k", "windows-x86_64");
        Assert.Equal("available", (await gitee.CheckAsync(manual: true)).Status);

        // The same asset served by another host is refused: only the source's own host counts.
        var impostor = new UpgradeService(
            new StaticSource(new ReleaseProbe("github",
                Manifest("https://gitee.com/ariacompute/agentbuddy/releases/download/v9/agentbuddy-9.9.9.msi"), 1)),
            new NoDownloader(), new NoVerifier(), new NoInstaller(), config, "0.1.0", "k", "windows-x86_64");
        Assert.Equal("unsupported_platform", (await impostor.CheckAsync(manual: true)).Status);
    }

    [Fact]
    public void TheBestStoreForEachPlatformIsChosen()
    {
        Assert.IsType<WindowsCredentialStore>(CredentialStore.CreatePrimary("windows", _ => false));
        Assert.IsType<UnixCommandCredentialStore>(CredentialStore.CreatePrimary("macos", name => name == "security"));
        Assert.IsType<UnixCommandCredentialStore>(CredentialStore.CreatePrimary("linux", name => name == "secret-tool"));
        // A missing helper means "no keychain", never a crash on startup.
        Assert.IsType<NoopCredentialStore>(CredentialStore.CreatePrimary("macos", _ => false));
        Assert.IsType<NoopCredentialStore>(CredentialStore.CreatePrimary("linux", _ => false));
        Assert.IsType<NoopCredentialStore>(CredentialStore.CreatePrimary("plan9", _ => true));
        Assert.NotNull(CredentialStore.CreatePrimary()); // the real platform
    }

    [Fact]
    public async Task AnUnreadableFallbackStillSignsOutCleanly()
    {
        var ladder = new CredentialStore(new AlwaysFails("keyring"), new AlwaysFails("file"));
        Assert.Null(await ladder.GetAsync("session"));
        Assert.Equal("memory", ladder.Backend);
        await ladder.DeleteAsync("session"); // both deletes fail, neither throws
        Assert.Equal("memory", ladder.Backend);
    }

    [Fact]
    public void AMalformedPathEntryIsSkippedInsteadOfThrown()
    {
        var previous = Environment.GetEnvironmentVariable("PATH");
        try
        {
            Environment.SetEnvironmentVariable("PATH", "bad\0entry" + Path.PathSeparator + Path.GetTempPath());
            Assert.False(CredentialStore.Exists("definitely-not-a-program-" + Guid.NewGuid().ToString("N")));
        }
        finally { Environment.SetEnvironmentVariable("PATH", previous); }
    }

    [Fact]
    public async Task ACommandThatOutlivesItsBudgetIsKilledAndReportedAsTimedOut()
    {
        if (!OperatingSystem.IsWindows()) return;
        var executor = new ExecutorService(new NullStore());
        executor.SetEnabled(true, true);
        var config = new ShellConfig { ExecutorRoot = _root, ExecutorAllowlist = ["ping"] };
        var result = await executor.ExecuteAsync(config,
            new ExecRequest("ping", ["-n", "30", "127.0.0.1"], _root), TimeSpan.FromMilliseconds(250));
        Assert.True(result.TimedOut);
        Assert.Equal(-1, result.ExitCode);
    }

    private static Process? Start(string file, string arg) => Process.Start(new ProcessStartInfo(file)
    {
        ArgumentList = { arg },
        UseShellExecute = false,
        CreateNoWindow = true,
        RedirectStandardOutput = true
    });

    private sealed class NullStore : ICredentialStore
    {
        public string Backend => "memory";
        public Task<string?> GetAsync(string name, CancellationToken ct = default) => Task.FromResult<string?>(null);
        public Task SetAsync(string name, string secret, CancellationToken ct = default) => Task.CompletedTask;
        public Task DeleteAsync(string name, CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class AlwaysFails(string backend) : ICredentialStore
    {
        public string Backend => backend;
        public Task<string?> GetAsync(string name, CancellationToken ct = default) =>
            throw new InvalidOperationException("locked");
        public Task SetAsync(string name, string secret, CancellationToken ct = default) =>
            throw new InvalidOperationException("locked");
        public Task DeleteAsync(string name, CancellationToken ct = default) =>
            throw new InvalidOperationException("locked");
    }

    private sealed class ThrowingSource : IReleaseSource
    {
        public Task<ReleaseProbe> ProbeAsync(CancellationToken ct) =>
            throw new InvalidOperationException("source exploded");
    }

    private sealed class StaticSource(ReleaseProbe probe) : IReleaseSource
    {
        public Task<ReleaseProbe> ProbeAsync(CancellationToken ct) => Task.FromResult(probe);
    }

    private sealed class NoDownloader : IReleaseDownloader
    {
        public Task<byte[]> DownloadAsync(string url, CancellationToken ct) => Task.FromResult(Array.Empty<byte>());
    }

    private sealed class NoVerifier : IUpgradeVerifier
    {
        public bool Verify(byte[] payload, string signatureBox, string publicKeyBox) => false;
    }

    private sealed class NoInstaller : IUpgradeInstaller
    {
        public Task<bool> InstallAsync(byte[] package, string fileName, CancellationToken ct) => Task.FromResult(false);
    }
}
