using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using AgentBuddy.Core.Contracts;
using AgentBuddy.Core.Services;
using AgentBuddy.Shell;
using AgentBuddy.Shell.Credentials;
using AgentBuddy.Shell.Executor;
using AgentBuddy.Shell.Loopback;
using AgentBuddy.Shell.Notifications;
using AgentBuddy.Shell.Tray;
using AgentBuddy.Shell.Upgrade;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using Org.BouncyCastle.Crypto.Generators;
using Org.BouncyCastle.Crypto.Parameters;
using Org.BouncyCastle.Crypto.Signers;
using Org.BouncyCastle.Security;
using Xunit;
using GatewayContract = AgentBuddy.Core.Contracts.Gateway;

namespace AgentBuddy.Shell.Tests;

public class ProxyContractTests
{
    [Theory]
    [InlineData("sid=abc; Path=/api; Domain=hub.example.com; Secure; HttpOnly; SameSite=None", "sid=abc; HttpOnly; SameSite=Lax; Path=/")]
    [InlineData("sid=abc", "sid=abc; Path=/")]
    [InlineData("sid=abc; Max-Age=600; HttpOnly", "sid=abc; Max-Age=600; HttpOnly; Path=/")]
    [InlineData("sid=abc; SameSite=Strict", "sid=abc; SameSite=Strict; Path=/")]
    [InlineData("sid=abc; SameSite=Lax", "sid=abc; SameSite=Lax; Path=/")]
    public void CookieRewriteMatchesTheRustImplementation(string raw, string expected) =>
        Assert.Equal(expected, ForwardHandler.RewriteSetCookie(raw));

    [Fact]
    public void LocationRewriteOnlyTouchesTheConfiguredServer()
    {
        Assert.Equal("http://127.0.0.1:1/",
            ForwardHandler.RewriteLocation("https://hub.example.com/", "https://hub.example.com", "http://127.0.0.1:1"));
        const string external = "https://github.com/login/oauth/authorize?x=1";
        Assert.Equal(external,
            ForwardHandler.RewriteLocation(external, "https://hub.example.com", "http://127.0.0.1:1"));
    }

    [Fact]
    public void ProxyCookieNeverGoesUpstream()
    {
        Assert.Equal("sid=abc", ForwardHandler.FilterProxyCookie("ab_proxy=tok; sid=abc"));
        Assert.Equal("", ForwardHandler.FilterProxyCookie("ab_proxy=tok"));
    }

    [Fact]
    public void FailuresAreClassifiedAsMachineCodes()
    {
        Assert.Equal("timeout", ForwardHandler.Classify(new TimeoutException()));
        Assert.Equal("unreachable", ForwardHandler.Classify(new HttpRequestException("down")));
        Assert.Equal("unexpected", ForwardHandler.Classify(new InvalidOperationException()));
    }

    [Theory]
    [InlineData("", "empty")]
    [InlineData("ftp://host", "invalid")]
    [InlineData("not a url", "invalid")]
    [InlineData("http://localhost:3500", null)]
    [InlineData("https://hub.example.com/", null)]
    public void ServerUrlValidation(string value, string? expected) =>
        Assert.Equal(expected, ShellRoutes.ValidateServerUrl(value));
}

public class SecuritySurfaceTests
{
    [Fact]
    public void DeepLinksAcceptOnlySingleSlashInAppPaths()
    {
        var queue = new DeepLinkQueue();
        Assert.True(DeepLinkQueue.IsValid("/threads/42"));
        Assert.False(DeepLinkQueue.IsValid("//evil.example"));
        Assert.False(DeepLinkQueue.IsValid("javascript:alert(1)"));
        Assert.False(DeepLinkQueue.IsValid("/threads\\42"));
        Assert.False(DeepLinkQueue.IsValid("/threads/1\n2"));
        Assert.False(DeepLinkQueue.IsValid("threads/42"));
        Assert.False(DeepLinkQueue.IsValid(""));
        Assert.True(queue.Enqueue("/threads/42"));
        Assert.Equal(1, queue.Count);
        Assert.Equal("/threads/42", queue.Consume());
        Assert.Null(queue.Consume()); // consumed exactly once
    }

    [Fact]
    public void ShellNamesAndEnvAreRejectedByConstruction()
    {
        Assert.Equal(ExecutorReject.CommandNotAllowed,
            ExecutorPolicy.ValidateCommand("bash", new[] { "bash", "node" }));
        Assert.Null(ExecutorPolicy.ValidateCommand("node", new[] { "node" }));
        Assert.Equal(ExecutorReject.EnvNotAllowed,
            ExecutorPolicy.ValidateEnvironment(new Dictionary<string, string> { ["AWS_SECRET"] = "x" }));
        Assert.Null(ExecutorPolicy.ValidateEnvironment(new Dictionary<string, string> { ["PATH"] = "/usr/bin" }));
        Assert.Equal(ExecutorReject.RootUnusable, ExecutorPolicy.ValidateRoot("relative/path"));
        Assert.Contains("[truncated]", ExecutorPolicy.Truncate(new string('x', Limits.MaxOutputBytes + 10)));
    }

    [Fact]
    public void ExecutorRequiresExplicitConfirmationAndStaysOffByDefault()
    {
        var paths = new AppPaths(Path.Combine(Path.GetTempPath(), "ab-" + Guid.NewGuid().ToString("N")));
        var executor = new ExecutorService(new FileCredentialStore(paths));
        Assert.False(executor.Enabled);
        Assert.Throws<ExecutorRejectException>(() => executor.SetEnabled(true, false));
        executor.SetEnabled(true, true);
        Assert.True(executor.Enabled);
        Assert.Equal("running", executor.Status);
        Assert.True(executor.Limits.ShellsRefused);
    }

    [Fact]
    public async Task SecretsNeverLandInConfigJson()
    {
        var dir = Path.Combine(Path.GetTempPath(), "ab-" + Guid.NewGuid().ToString("N"));
        try
        {
            var paths = new AppPaths(dir);
            var config = new ConfigService(paths);
            await config.SaveAsync(new ShellConfig { Lang = "en" });
            var store = new FileCredentialStore(paths);
            await store.SetAsync("session", "super-secret-value");
            Assert.Equal("super-secret-value", await store.GetAsync("session"));
            Assert.DoesNotContain("super-secret-value", await File.ReadAllTextAsync(paths.ConfigFile));
            await store.DeleteAsync("session");
            Assert.Null(await store.GetAsync("session"));
        }
        finally { if (Directory.Exists(dir)) Directory.Delete(dir, true); }
    }

    [Fact]
    public void TrayBadgeUsesThirteenLanguagesAndSurvivesRefresh()
    {
        var copy = new LocalizationService();
        var tray = new TrayService(copy);
        var changes = new List<int>();
        tray.BadgeChanged += n => changes.Add(n);
        tray.SetUnread(5000);
        Assert.Equal(Limits.MaxBadge, tray.Unread);
        Assert.Equal("99+", TrayService.BadgeNumber(tray.Unread));
        Assert.Equal("", TrayService.BadgeNumber(0));
        Assert.Contains("99+", tray.BadgeText(tray.Unread));
        Assert.Equal(4, tray.MenuLabels().Count);
        Assert.Equal("/", TrayService.PathFor(TrayService.IdOpen));
        Assert.Equal("", TrayService.PathFor(TrayService.IdQuit));
        tray.Refresh("ar");
        Assert.True(copy.IsRtl);
        Assert.Equal(Limits.MaxBadge, tray.Unread); // language switch must not clear the badge
        Assert.Equal(new[] { 999, 999 }, changes);
    }

    [Fact]
    public void BootstrapNonceIsSingleUseAndOriginIsCheckedFirst()
    {
        var auth = new BootstrapAuth();
        Assert.Equal(64, auth.Token.Length);
        Assert.StartsWith("ab_proxy=", auth.CookieHeader);
        Assert.Contains("HttpOnly", auth.CookieHeader);
        Assert.Contains("SameSite=Strict", auth.CookieHeader);
        Assert.False(auth.TryConsumeNonce("wrong"));
        Assert.True(auth.TryConsumeNonce(auth.Nonce));
        Assert.False(auth.TryConsumeNonce(auth.Nonce));
    }
}

public class UpgradeTests
{
    [Theory]
    [InlineData("0.10.0", "0.9.0", 1)]
    [InlineData("1.0.0", "1.0.0", 0)]
    [InlineData("1.0.0-beta", "1.0.0", -1)]
    [InlineData("1.2.3", "1.2.4", -1)]
    public void SemverComparison(string left, string right, int expected) =>
        Assert.Equal(Math.Sign(expected), Math.Sign(SemverComparer.Compare(left, right)));

    [Fact]
    public void CheckIsDueAfter24hAndOnClockRollback()
    {
        Assert.True(UpgradeSchedule.Due(0, 1000));
        Assert.False(UpgradeSchedule.Due(1000, 1000 + 3600));
        Assert.True(UpgradeSchedule.Due(1000, 1000 + Limits.CheckIntervalSeconds));
        Assert.True(UpgradeSchedule.Due(10_000, 5_000));
    }

    [Fact]
    public void Ed25519SignatureVerificationRejectsTampering()
    {
        var generator = new Ed25519KeyPairGenerator();
        generator.Init(new Ed25519KeyGenerationParameters(new SecureRandom()));
        var pair = generator.GenerateKeyPair();
        var pub = ((Ed25519PublicKeyParameters)pair.Public).GetEncoded();
        var payload = Encoding.UTF8.GetBytes("agentbuddy release package");
        var signer = new Ed25519Signer();
        signer.Init(true, pair.Private);
        signer.BlockUpdate(payload, 0, payload.Length);
        var signature = signer.GenerateSignature();

        var pubBytes = new byte[42];
        pubBytes[0] = (byte)'E'; pubBytes[1] = (byte)'d';
        pub.CopyTo(pubBytes, 10);
        var sigBytes = new byte[74];
        sigBytes[0] = (byte)'E'; sigBytes[1] = (byte)'d';
        signature.CopyTo(sigBytes, 10);
        var keyBox = "untrusted comment: test public key\n" + Convert.ToBase64String(pubBytes) + "\n";
        var sigBox = "untrusted comment: signature\n" + Convert.ToBase64String(sigBytes) + "\ntrusted comment: test\n";

        var verifier = new MinisignVerifier();
        Assert.True(verifier.Verify(payload, sigBox, keyBox));
        Assert.False(verifier.Verify(Encoding.UTF8.GetBytes("tampered"), sigBox, keyBox));
        Assert.False(verifier.Verify(payload, sigBox, ""));
    }

    [Fact]
    public async Task MissingPubkeyNeverInstallsAnything()
    {
        var service = Build("0.1.0", "");
        var state = await service.CheckAsync();
        Assert.Equal("not_configured", state.Status);
        Assert.Equal("not_configured", (await service.InstallAsync()).Status);
    }

    [Fact]
    public async Task AvailableUpdateRequiresAValidSignature()
    {
        var manifest = Manifest("9.9.9", "sig-box");
        var downloader = new StubDownloader([1, 2, 3]);
        var verifier = new StubVerifier(false);
        var service = Build("0.1.0", "pubkey", new StubSource(new ReleaseProbe("github", manifest, 5)), downloader, verifier, new StubInstaller(true));
        var state = await service.CheckAsync(true);
        Assert.Equal("available", state.Status);
        Assert.Equal("9.9.9", state.LatestVersion);
        Assert.Equal("signature_failed", (await service.InstallAsync()).Status);
    }

    [Fact]
    public async Task FailurePathsAreMachineCodes()
    {
        Assert.Equal("network_failed", (await Build("0.1.0", "k", new StubSource(new ReleaseProbe("github", "", 1, "network_failed"))).CheckAsync()).Status);
        Assert.Equal("manifest_invalid", (await Build("0.1.0", "k", new StubSource(new ReleaseProbe("github", "not json", 1))).CheckAsync()).Status);
        Assert.Equal("unsupported_platform", (await Build("0.1.0", "k", platformKey: "plan9-x86_64").CheckAsync()).Status);
        var older = Build("2.0.0", "k", new StubSource(new ReleaseProbe("github", Manifest("1.0.0", "sig"), 1)));
        Assert.Equal("up_to_date", (await older.CheckAsync()).Status);
    }

    private static string Manifest(string version, string signature) => JsonSerializer.Serialize(new
    {
        version,
        notes = "notes",
        pub_date = "2026-01-01T00:00:00Z",
        platforms = new Dictionary<string, object>
        {
            ["windows-x86_64"] = new { url = "https://github.com/ariacompute/agentbuddy/releases/download/v9/agentbuddy-x64-9.9.9.msi", signature }
        },
        signatures = new Dictionary<string, string> { ["agentbuddy-x64-9.9.9.msi"] = signature }
    });

    private static UpgradeService Build(string currentVersion, string pubkey,
        IReleaseSource? source = null, IReleaseDownloader? downloader = null,
        IUpgradeVerifier? verifier = null, IUpgradeInstaller? installer = null,
        string? platformKey = null)
    {
        var dir = Path.Combine(Path.GetTempPath(), "ab-" + Guid.NewGuid().ToString("N"));
        var config = new ConfigService(new AppPaths(dir));
        return new UpgradeService(
            source ?? new StubSource(new ReleaseProbe("github", "", 1, "network_failed")),
            downloader ?? new StubDownloader([]),
            verifier ?? new StubVerifier(true),
            installer ?? new StubInstaller(true),
            config, currentVersion, pubkey, platformKey ?? "windows-x86_64");
    }

    private sealed class StubSource(ReleaseProbe probe) : IReleaseSource
    {
        public Task<ReleaseProbe> ProbeAsync(CancellationToken ct) => Task.FromResult(probe);
    }
    private sealed class StubDownloader(byte[] bytes) : IReleaseDownloader
    {
        public Task<byte[]> DownloadAsync(string url, CancellationToken ct) => Task.FromResult(bytes);
    }
    private sealed class StubVerifier(bool result) : IUpgradeVerifier
    {
        public bool Verify(byte[] payload, string signatureBox, string publicKeyBox) => result;
    }
    private sealed class StubInstaller(bool result) : IUpgradeInstaller
    {
        public Task<bool> InstallAsync(byte[] package, string fileName, CancellationToken ct) => Task.FromResult(result);
    }
}

/// <summary>Real sockets: bootstrap → cookie → streaming forward → shell routes.</summary>
public class GatewaySmokeTests
{
    [Fact]
    public async Task WholeShellSessionOverRealSockets()
    {
        await using var upstream = new UpstreamStub();
        var dir = Path.Combine(Path.GetTempPath(), "ab-" + Guid.NewGuid().ToString("N"));
        try
        {
            var paths = new AppPaths(dir);
            var config = new ConfigService(paths);
            await config.SaveAsync(new ShellConfig { ServerUrl = upstream.Url, Lang = "en" });
            var copy = new LocalizationService();
            var credentials = new FileCredentialStore(paths);
            var tray = new TrayService(copy);
            var notifier = new StubNotifier();
            var services = new ShellServices
            {
                Config = config,
                Copy = copy,
                Credentials = credentials,
                Tray = tray,
                Notifier = notifier,
                DeepLinks = new DeepLinkQueue(),
                Executor = new ExecutorService(credentials),
                Upgrade = new UpgradeService(new StubSource(), new StubDownloader(), new StubVerifier(), new StubInstaller(),
                    config, "0.1.0", ""),
                Paths = paths,
                Version = "0.1.0"
            };
            await using var gateway = new LoopbackGateway(services);
            var baseAddress = await gateway.StartAsync();

            using var noRedirect = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false });
            var forged = new HttpRequestMessage(HttpMethod.Get, gateway.BootstrapUri);
            forged.Headers.TryAddWithoutValidation("Origin", "http://evil.example");
            var refused = await noRedirect.SendAsync(forged);
            Assert.Equal(HttpStatusCode.Forbidden, refused.StatusCode);
            Assert.Contains("proxy_origin_refused", await refused.Content.ReadAsStringAsync());

            var boot = await noRedirect.GetAsync(gateway.BootstrapUri);
            Assert.Equal(HttpStatusCode.SeeOther, boot.StatusCode);
            var cookie = boot.Headers.GetValues("Set-Cookie").Single();
            Assert.StartsWith("ab_proxy=", cookie);
            Assert.Contains("HttpOnly", cookie);

            Assert.Equal(HttpStatusCode.Unauthorized,
                (await noRedirect.GetAsync(new Uri(baseAddress, "/api/workspace"))).StatusCode);

            using var client = new HttpClient { BaseAddress = baseAddress };
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", gateway.Token);
            var workspace = await client.GetStringAsync("/api/workspace");
            Assert.Contains("upstream", workspace);
            // Only the agenthub session cookie is kept; transient ones stay transient.
            Assert.Equal("agenthub_session=sess-token-123", await credentials.GetAsync("session"));

            var viaCookie = new HttpRequestMessage(HttpMethod.Get, new Uri(baseAddress, "/api/workspace"));
            viaCookie.Headers.TryAddWithoutValidation("Cookie", cookie.Split(';')[0]);
            var cookieResponse = await noRedirect.SendAsync(viaCookie);
            Assert.Equal(HttpStatusCode.OK, cookieResponse.StatusCode);
            var forwarded = cookieResponse.Headers.GetValues("Set-Cookie").ToArray();
            var sessionCookie = Assert.Single(forwarded, c => c.StartsWith("agenthub_session=", StringComparison.Ordinal));
            Assert.Contains("Path=/", sessionCookie);
            Assert.DoesNotContain("Secure", sessionCookie);
            Assert.DoesNotContain("Domain=", sessionCookie);
            Assert.Contains(forwarded, c => c.StartsWith("oauth_state=", StringComparison.Ordinal));
            // A hostile upstream cannot plant the gateway's own auth cookie.
            Assert.DoesNotContain(forwarded, c => c.StartsWith("ab_proxy=", StringComparison.Ordinal));

            using var sse = await client.GetAsync("/api/tasks/1/events", HttpCompletionOption.ResponseHeadersRead);
            Assert.Contains("text/event-stream", sse.Content.Headers.ContentType!.MediaType!);
            await using (var stream = await sse.Content.ReadAsStreamAsync())
            using (var reader = new StreamReader(stream))
            using (var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10)))
            {
                var first = await reader.ReadLineAsync(timeout.Token);
                Assert.Equal("event: task_status_update", first);
            }

            var badge = await client.PostAsJsonAsync(ShellEndpoints.Badge, new { count = 5000 });
            Assert.Equal(HttpStatusCode.OK, badge.StatusCode);
            Assert.Equal(Limits.MaxBadge, tray.Unread);
            var notify = await client.PostAsJsonAsync(ShellEndpoints.Notify,
                new { title = "t", body = "b", link = "/threads/42" });
            Assert.Contains("\"ok\":true", await notify.Content.ReadAsStringAsync());
            Assert.Single(notifier.Seen);
            Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/__shell/nope")).StatusCode);
        }
        finally { if (Directory.Exists(dir)) Directory.Delete(dir, true); }
    }

    private sealed class StubNotifier : ISystemNotifier
    {
        public List<string> Seen { get; } = [];
        public Task<string?> NotifyAsync(string title, string body, string? link, CancellationToken ct = default)
        {
            Seen.Add(title);
            return Task.FromResult<string?>(null);
        }
    }
    private sealed class StubSource : IReleaseSource
    {
        public Task<ReleaseProbe> ProbeAsync(CancellationToken ct) => Task.FromResult(new ReleaseProbe("github", "", 1, "network_failed"));
    }
    private sealed class StubDownloader : IReleaseDownloader
    {
        public Task<byte[]> DownloadAsync(string url, CancellationToken ct) => Task.FromResult(Array.Empty<byte>());
    }
    private sealed class StubVerifier : IUpgradeVerifier
    {
        public bool Verify(byte[] payload, string signatureBox, string publicKeyBox) => true;
    }
    private sealed class StubInstaller : IUpgradeInstaller
    {
        public Task<bool> InstallAsync(byte[] package, string fileName, CancellationToken ct) => Task.FromResult(true);
    }

    private sealed class UpstreamStub : IAsyncDisposable
    {
        private readonly WebApplication _app;
        public string Url { get; }

        public UpstreamStub()
        {
            var listener = new TcpListener(IPAddress.Loopback, 0);
            listener.Start();
            var port = ((IPEndPoint)listener.LocalEndpoint).Port;
            listener.Stop();
            Url = $"http://127.0.0.1:{port}";
            var builder = WebApplication.CreateBuilder();
            builder.Logging.ClearProviders();
            builder.WebHost.UseUrls(Url);
            var app = builder.Build();
            app.Run(async ctx =>
            {
                var path = ctx.Request.Path.Value ?? "";
                if (path.EndsWith("/events", StringComparison.Ordinal))
                {
                    ctx.Response.ContentType = "text/event-stream";
                    ctx.Response.Headers.CacheControl = "no-cache";
                    await ctx.Response.WriteAsync("event: task_status_update\ndata: {\"state\":\"working\"}\n\n");
                    await ctx.Response.Body.FlushAsync();
                    return;
                }
                ctx.Response.Headers.Append("Set-Cookie", "agenthub_session=sess-token-123; Path=/api; Domain=hub.example.com; Secure; HttpOnly; SameSite=None");
                ctx.Response.Headers.Append("Set-Cookie", "oauth_state=transient; Path=/; HttpOnly; Max-Age=600");
                // A hostile upstream trying to overwrite the gateway's own auth cookie.
                ctx.Response.Headers.Append("Set-Cookie", "ab_proxy=planted; Path=/; HttpOnly");
                ctx.Response.ContentType = "application/json";
                await ctx.Response.WriteAsync("{\"source\":\"upstream\",\"path\":" + JsonSerializer.Serialize(path) + "}");
            });
            app.StartAsync().GetAwaiter().GetResult();
            _app = app;
        }

        public async ValueTask DisposeAsync()
        {
            await _app.StopAsync();
            await _app.DisposeAsync();
        }
    }
}
