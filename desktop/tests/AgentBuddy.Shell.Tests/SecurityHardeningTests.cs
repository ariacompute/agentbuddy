using System.Security.Cryptography;
using System.Text.Json.Nodes;
using AgentBuddy.Core.Contracts;
using AgentBuddy.Core.Services;
using AgentBuddy.Shell.Credentials;
using AgentBuddy.Shell.Executor;
using AgentBuddy.Shell.Loopback;
using AgentBuddy.Shell.Notifications;
using AgentBuddy.Shell.Tray;
using AgentBuddy.Shell.Upgrade;
using Org.BouncyCastle.Crypto.Parameters;
using Org.BouncyCastle.Crypto.Signers;
using Xunit;

namespace AgentBuddy.Shell.Tests;

/// <summary>
/// Guards for the 2026-11 hardening pass. Each case is either the escape that was
/// closed or the legitimate path that must keep working next to it.
/// </summary>
public class ProxyHardeningTests
{
    [Theory]
    [InlineData("ab_proxy=planted; Path=/; HttpOnly")]
    [InlineData("AB_PROXY=planted; Path=/")]
    [InlineData("__Host-session=x; Path=/; Secure")]
    [InlineData("__Secure-token=x; Path=/; Secure")]
    public void UpstreamCannotSetTheGatewayCookieOrAHostLockedOne(string raw) =>
        Assert.Equal("", ForwardHandler.RewriteSetCookie(raw));

    [Fact]
    public void OrdinaryUpstreamCookiesStillSurvive()
    {
        Assert.Equal("agenthub_session=v; HttpOnly; SameSite=Lax; Path=/",
            ForwardHandler.RewriteSetCookie("agenthub_session=v; Path=/api; Secure; HttpOnly; SameSite=None"));
        Assert.Equal("oauth_state=s; Max-Age=600; Path=/",
            ForwardHandler.RewriteSetCookie("oauth_state=s; Max-Age=600"));
    }

    [Theory]
    [InlineData("ab_proxy=secret; agenthub_session=v", "agenthub_session=v")]
    [InlineData("AB_PROXY=secret", "")]
    [InlineData("Ab_Proxy=secret; lang=en", "lang=en")]
    [InlineData("", "")]
    public void TheGatewayTokenNeverReachesUpstream(string raw, string expected) =>
        Assert.Equal(expected, ForwardHandler.FilterProxyCookie(raw));

    [Fact]
    public void LocationRewriteComparesTheOriginNotAStringPrefix()
    {
        const string upstream = "https://hub.example.com";
        const string self = "http://127.0.0.1:1";
        // Same host, different port and a look-alike host are both "external".
        Assert.Equal("https://hub.example.com.evil.test/x",
            ForwardHandler.RewriteLocation("https://hub.example.com.evil.test/x", upstream, self));
        Assert.Equal("https://hub.example.com:8443/x",
            ForwardHandler.RewriteLocation("https://hub.example.com:8443/x", upstream, self));
        Assert.Equal("http://hub.example.com/x",
            ForwardHandler.RewriteLocation("http://hub.example.com/x", upstream, self));
        // The server's own redirect, including path, query and fragment, is rewritten.
        Assert.Equal("http://127.0.0.1:1/settings?tab=1#top",
            ForwardHandler.RewriteLocation("https://hub.example.com/settings?tab=1#top", upstream, self));
        // A relative Location stays relative.
        Assert.Equal("/login", ForwardHandler.RewriteLocation("/login", upstream, self));
    }

    [Theory]
    [InlineData("/api/workspace", true)]
    [InlineData("/api/tasks/1/events", true)]
    [InlineData("/api/../admin", false)]
    [InlineData("/api//evil.example/x", false)]
    [InlineData("/api%5c..%5cx", false)] // Kestrel decodes before we look, so this is caught too
    [InlineData("/api\\x", false)]
    [InlineData("/a2a/..", false)]
    public void ForwardedPathsMayNotEscapeThePrefix(string path, bool expected) =>
        Assert.Equal(expected, LoopbackGateway.IsForwardablePath(path));

    [Theory]
    [InlineData("http://user:pass@hub.example.com", "invalid")]
    [InlineData("http://hub.example.com/#frag", "invalid")]
    [InlineData("http://hub.example.com/a b", "invalid")]
    [InlineData("http://hub.example.com/\u0001", "invalid")]
    [InlineData("file:///etc/passwd", "invalid")]
    [InlineData("http://hub.example.com", null)]
    [InlineData("http://192.168.1.5:3500/", null)]
    public void ServerUrlRejectsUserInfoAndControlCharacters(string value, string? expected) =>
        Assert.Equal(expected, ShellRoutes.ValidateServerUrl(value));
}

public class ExecutorHardeningTests
{
    [Theory]
    [InlineData("../evil/node")]
    [InlineData("/usr/local/bin/node")]
    [InlineData("bin/node")]
    [InlineData("C:\\Windows\\System32\\node.exe")]
    [InlineData("./node")]
    [InlineData("..")]
    [InlineData("node --inspect")]
    [InlineData(" node")]
    [InlineData("node\n")]
    [InlineData("sh")]
    [InlineData("sh.exe")]
    [InlineData("powershell")]
    [InlineData("env")]
    [InlineData("sudo")]
    [InlineData("xargs")]
    [InlineData("docker")]
    [InlineData("ssh")]
    public void OnlyABareAllowlistedNameIsExecutable(string command) =>
        Assert.Equal(ExecutorReject.CommandNotAllowed,
            ExecutorPolicy.ValidateCommand(command, new[] { "node", "tar", "env", "sudo", "sh" }));

    [Fact]
    public void PlainAllowlistedNamesStillPass()
    {
        Assert.Null(ExecutorPolicy.ValidateCommand("node", new[] { "node" }));
        Assert.Null(ExecutorPolicy.ValidateCommand("tar", new[] { "tar" }));
        Assert.Equal(ExecutorReject.CommandNotAllowed,
            ExecutorPolicy.ValidateCommand("nodejs", new[] { "node" })); // exact name, not a prefix
    }

    [Theory]
    [InlineData("../node")]
    [InlineData("/bin/node")]
    [InlineData("node.exe ")]
    [InlineData("node --flag")]
    [InlineData("bash")]
    [InlineData("env")]
    [InlineData("")]
    public void AllowlistEntriesAreCommandNamesNotCommandLines(string entry) =>
        Assert.Equal(ExecutorReject.CommandNotAllowed, ExecutorPolicy.ValidateAllowlistEntry(entry));

    [Fact]
    public void PlainAllowlistEntriesAreAccepted()
    {
        Assert.Null(ExecutorPolicy.ValidateAllowlistEntry("node"));
        Assert.Null(ExecutorPolicy.ValidateAllowlistEntry("git"));
    }

    [Fact]
    public void WorkDirMayNotUseASiblingPrefixOrLeaveTheRoot()
    {
        var dir = NewTempDir();
        try
        {
            var root = Path.Combine(dir, "root");
            Directory.CreateDirectory(root);
            var sibling = root + "-evil";
            Directory.CreateDirectory(sibling);
            Assert.Null(ExecutorPolicy.ValidateWorkDir(root, root));
            Assert.Null(ExecutorPolicy.ValidateWorkDir(root, Path.Combine(root, "sub")));
            Assert.Equal(ExecutorReject.DirOutsideRoot, ExecutorPolicy.ValidateWorkDir(root, sibling));
            Assert.Equal(ExecutorReject.DirOutsideRoot, ExecutorPolicy.ValidateWorkDir(root, dir));
        }
        finally { TryDelete(dir); }
    }

    [Fact]
    public void ASymlinkedSubdirectoryOutsideTheRootIsRejected()
    {
        var dir = NewTempDir();
        try
        {
            var root = Path.Combine(dir, "root");
            var outside = Path.Combine(dir, "outside");
            Directory.CreateDirectory(root);
            Directory.CreateDirectory(outside);
            var link = Path.Combine(root, "escape");
            try { Directory.CreateSymbolicLink(link, outside); }
            catch (Exception) { return; } // unprivileged Windows: the link cannot be created to test
            Assert.Equal(ExecutorReject.DirOutsideRoot, ExecutorPolicy.ValidateWorkDir(root, link));
            Assert.Equal(ExecutorReject.DirOutsideRoot,
                ExecutorPolicy.ValidateWorkDir(root, Path.Combine(link, "nested")));
        }
        finally { TryDelete(dir); }
    }

    [Fact]
    public void TheFilesystemRootIsNeverAUsableRoot()
    {
        var filesystemRoot = Path.GetPathRoot(Path.GetFullPath(Path.GetTempPath()))!;
        Assert.Equal(ExecutorReject.RootUnusable, ExecutorPolicy.ValidateRoot(filesystemRoot));
        Assert.Equal(ExecutorReject.RootUnusable, ExecutorPolicy.ValidateRoot(""));
        Assert.Equal(ExecutorReject.RootUnusable, ExecutorPolicy.ValidateRoot("relative/dir"));
        var dir = NewTempDir();
        try
        {
            var root = Path.Combine(dir, "work");
            Directory.CreateDirectory(root);
            Assert.Null(ExecutorPolicy.ValidateRoot(root));
        }
        finally { TryDelete(dir); }
    }

    private static string NewTempDir() => Path.Combine(Path.GetTempPath(), "ab-" + Guid.NewGuid().ToString("N"));

    private static void TryDelete(string dir)
    {
        try { if (Directory.Exists(dir)) Directory.Delete(dir, true); } catch (Exception) { }
    }
}

public class ConfigPatchHardeningTests
{
    [Fact]
    public void ExecutorPatchValidationMatchesTheConfigRoute()
    {
        // Both routes go through ValidatePatch, so an unusable root is refused.
        var bad = JsonNode.Parse("{\"executorRoot\":\"relative\"}")!.AsObject();
        Assert.Equal(ExecutorReject.RootUnusable, ShellRoutes.ValidatePatch(bad));

        var rooted = JsonNode.Parse("{\"executorRoot\":\"/\"}")!.AsObject();
        Assert.Equal(ExecutorReject.RootUnusable, ShellRoutes.ValidatePatch(rooted));

        var shell = JsonNode.Parse("{\"executorAllowlist\":[\"node\",\"bash\"]}")!.AsObject();
        Assert.Equal(ExecutorReject.CommandNotAllowed, ShellRoutes.ValidatePatch(shell));

        var traversal = JsonNode.Parse("{\"executorAllowlist\":[\"../evil\"]}")!.AsObject();
        Assert.Equal(ExecutorReject.CommandNotAllowed, ShellRoutes.ValidatePatch(traversal));

        var ok = JsonNode.Parse("{\"executorAllowlist\":[\"node\"],\"executorMaxConcurrency\":2}")!.AsObject();
        Assert.Null(ShellRoutes.ValidatePatch(ok));
    }

    [Theory]
    [InlineData("{\"executorRoot\":42}")]
    [InlineData("{\"serverUrl\":123}")]
    [InlineData("{\"executorAllowlist\":[7]}")]
    [InlineData("{\"executorAllowlist\":\"node\"}")]
    [InlineData("{\"executorMaxConcurrency\":\"lots\"}")]
    [InlineData("{\"notifyQuietMinutes\":true}")]
    public void MistypedFieldsAreFourHundredsNotFiveHundreds(string json)
    {
        var patch = JsonNode.Parse(json)!.AsObject();
        Assert.NotNull(ShellRoutes.ValidatePatch(patch));
    }

    [Fact]
    public void AnUnknownFieldIsIgnoredRatherThanStored()
    {
        var patch = JsonNode.Parse("{\"totallyUnknown\":\"x\"}")!.AsObject();
        Assert.Null(ShellRoutes.ValidatePatch(patch));
    }

    [Fact]
    public async Task CorruptConfigFallsBackToDefaultsInsteadOfBlockingStartup()
    {
        var dir = Path.Combine(Path.GetTempPath(), "ab-" + Guid.NewGuid().ToString("N"));
        try
        {
            var paths = new AppPaths(dir);
            Directory.CreateDirectory(paths.ConfigDir);
            await File.WriteAllTextAsync(paths.ConfigFile, "{ this is not json");
            var config = new ConfigService(paths);
            var loaded = await config.LoadAsync();
            Assert.Equal("", loaded.ServerUrl);
            Assert.True(loaded.Background); // the documented default, not a crash
            // The next save repairs the file.
            await config.SaveAsync(loaded with { Lang = "de" });
            Assert.Equal("de", (await new ConfigService(paths).LoadAsync()).Lang);
        }
        finally { TryDelete(dir); }
    }

    [Fact]
    public async Task PrivateWritesReplaceAndNeverLeaveATempFileBehind()
    {
        var dir = Path.Combine(Path.GetTempPath(), "ab-" + Guid.NewGuid().ToString("N"));
        try
        {
            Directory.CreateDirectory(dir);
            var file = Path.Combine(dir, "config.json");
            ConfigService.WritePrivateFile(file, "{\"a\":1}");
            ConfigService.WritePrivateFile(file, "{\"a\":2}");
            Assert.Equal("{\"a\":2}", await File.ReadAllTextAsync(file));
            Assert.Empty(Directory.GetFiles(dir, "*.tmp"));
            if (!OperatingSystem.IsWindows())
            {
                var mode = File.GetUnixFileMode(file);
                Assert.Equal(UnixFileMode.UserRead | UnixFileMode.UserWrite, mode);
            }
        }
        finally { TryDelete(dir); }
    }

    private static void TryDelete(string dir)
    {
        try { if (Directory.Exists(dir)) Directory.Delete(dir, true); } catch (Exception) { }
    }
}

public class UpgradeHardeningTests
{
    [Fact]
    public void SignatureBoxesMustBeExactMinisignShapes()
    {
        var verifier = new MinisignVerifier();
        var seed = RandomNumberGenerator.GetBytes(32);
        var keyId = RandomNumberGenerator.GetBytes(8);
        var privateKey = new Ed25519PrivateKeyParameters(seed, 0);
        var publicKey = privateKey.GeneratePublicKey();
        var publicBox = new byte[42];
        publicBox[0] = (byte)'E'; publicBox[1] = (byte)'d';
        keyId.CopyTo(publicBox, 2);
        publicKey.GetEncoded().CopyTo(publicBox, 10);

        var payload = System.Text.Encoding.UTF8.GetBytes("agentbuddy");

        byte[] Sign(byte[] marker, byte[] id)
        {
            var signer = new Ed25519Signer();
            signer.Init(true, privateKey);
            signer.BlockUpdate(payload, 0, payload.Length);
            var signature = signer.GenerateSignature();
            var box = new byte[74];
            marker.CopyTo(box, 0);
            id.CopyTo(box, 2);
            signature.CopyTo(box, 10);
            return box;
        }

        // The wire format is the minisign text box (untrusted comment + base64 box),
        // optionally wrapped as base64 of that text — both must decode identically.
        static string TextBox(byte[] box) =>
            "untrusted comment: agentbuddy release signature\n" + Convert.ToBase64String(box) +
            "\ntrusted comment: file:x\n";

        var keyBox = "untrusted comment: test public key\n" + Convert.ToBase64String(publicBox) + "\n";
        var goodBox = TextBox(Sign("Ed"u8.ToArray(), keyId));
        Assert.True(verifier.Verify(payload, goodBox, keyBox));
        Assert.True(verifier.Verify(payload,
            Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(goodBox)), keyBox));

        // "ED" is the prehashed algorithm: refused rather than silently mismatched.
        Assert.False(verifier.Verify(payload, TextBox(Sign("ED"u8.ToArray(), keyId)), keyBox));

        // A signature issued under a different key id is refused before the curve math.
        Assert.False(verifier.Verify(payload, TextBox(Sign("Ed"u8.ToArray(), RandomNumberGenerator.GetBytes(8))), keyBox));

        // Tampered payload, truncated box, empty payload and empty key all fail closed.
        Assert.False(verifier.Verify("other"u8.ToArray(), goodBox, keyBox));
        Assert.False(verifier.Verify(payload, TextBox(Sign("Ed"u8.ToArray(), keyId)[..40]), keyBox));
        Assert.False(verifier.Verify([], goodBox, keyBox));
        Assert.False(verifier.Verify(payload, goodBox, ""));
        Assert.False(verifier.Verify(payload, "not base64 at all", keyBox));
    }

    [Fact]
    public async Task InstallerRefusesANameThatIsNotAPlainFileName()
    {
        var installer = new PlatformUpgradeInstaller();
        foreach (var name in new[] { "../escape.msi", "sub/dir.msi", "sub\\dir.msi", "", "." })
            Assert.False(await installer.InstallAsync([1, 2, 3], name, CancellationToken.None));
    }

    [Fact]
    public async Task UpgradeWithoutAPubkeyStillRefusesToInstall()
    {
        var dir = Path.Combine(Path.GetTempPath(), "ab-" + Guid.NewGuid().ToString("N"));
        try
        {
            var config = new ConfigService(new AppPaths(dir));
            var service = new UpgradeService(new StubSource(), new StubDownloader(), new MinisignVerifier(),
                new StubInstaller(), config, "0.1.0", pubkey: "");
            Assert.Equal("not_configured", (await service.InstallAsync()).Status);
        }
        finally { try { if (Directory.Exists(dir)) Directory.Delete(dir, true); } catch (Exception) { } }
    }

    private sealed class StubSource : IReleaseSource
    {
        public Task<ReleaseProbe> ProbeAsync(CancellationToken ct) =>
            Task.FromResult(new ReleaseProbe("github", "", 1, "network_failed"));
    }

    private sealed class StubDownloader : IReleaseDownloader
    {
        public Task<byte[]> DownloadAsync(string url, CancellationToken ct) => Task.FromResult(Array.Empty<byte>());
    }

    private sealed class StubInstaller : IUpgradeInstaller
    {
        public Task<bool> InstallAsync(byte[] package, string fileName, CancellationToken ct) => Task.FromResult(true);
    }
}

public class NotificationHardeningTests
{
    [Fact]
    public void TheDeepLinkQueueIsBoundedAndDropsWhatItCannotUse()
    {
        var queue = new DeepLinkQueue();
        for (var i = 0; i < 25; i++) Assert.True(queue.Enqueue("/threads/" + i));
        Assert.Equal(20, queue.Count); // oldest entries fall out, memory stays bounded
        Assert.False(queue.Enqueue("/threads/" + new string('9', 600)));
        Assert.False(queue.Enqueue("//evil.example/x"));
        Assert.False(queue.Enqueue("javascript:alert(1)"));
        Assert.True(queue.Enqueue("/settings"));
        Assert.Equal("/threads/6", queue.Consume()); // FIFO: the six oldest fell out
        Assert.Equal(19, queue.Count);
    }

    [Fact]
    public void NotificationTextIsClippedToASingleLine()
    {
        // Mirrors the cap applied by POST /__shell/notify before the OS sees it.
        var body = new string('x', Limits.MaxNotifyBodyChars + 50);
        Assert.True(body.Length > Limits.MaxNotifyBodyChars);
        Assert.Equal(200, Limits.MaxNotifyTitleChars);
        Assert.Equal(1000, Limits.MaxNotifyBodyChars);
    }
}

public class CredentialHardeningTests
{
    [Fact]
    public async Task ACorruptSecretFileReadsAsSignedOutInsteadOfThrowing()
    {
        var dir = Path.Combine(Path.GetTempPath(), "ab-" + Guid.NewGuid().ToString("N"));
        try
        {
            var paths = new AppPaths(dir);
            Directory.CreateDirectory(Path.Combine(paths.ConfigDir, "secrets"));
            var store = new FileCredentialStore(paths);
            await store.SetAsync("session", "value");
            var file = Directory.GetFiles(Path.Combine(paths.ConfigDir, "secrets")).Single();
            await File.WriteAllTextAsync(file, "not json");
            var wrapper = new CredentialStore(paths);
            Assert.Null(await wrapper.GetAsync("session"));
            Assert.Equal("memory", wrapper.Backend);
        }
        finally { try { if (Directory.Exists(dir)) Directory.Delete(dir, true); } catch (Exception) { } }
    }
}

public class TrayHardeningTests
{
    [Fact]
    public void BadgeInputIsClampedBeforeItReachesTheTray()
    {
        var tray = new TrayService(new LocalizationService());
        tray.SetUnread(-5);
        Assert.Equal(0, tray.Unread);
        tray.SetUnread(int.MaxValue);
        Assert.Equal(Limits.MaxBadge, tray.Unread);
    }
}
