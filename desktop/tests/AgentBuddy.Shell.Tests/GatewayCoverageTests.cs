using System.Net;
using System.Net.Http.Headers;
using System.Net.Sockets;
using System.Text;
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
using Xunit;

namespace AgentBuddy.Shell.Tests;

/// <summary>Every dispatch branch of the loopback gateway, over real sockets.</summary>
public class LoopbackGatewayCoverageTests : IAsyncLifetime
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "ab-" + Guid.NewGuid().ToString("N"));
    private Upstream _upstream = null!;
    private LoopbackGateway _gateway = null!;
    private HttpClient _client = null!;

    public async Task InitializeAsync()
    {
        _upstream = new Upstream();
        var paths = new AppPaths(_root);
        var config = new ConfigService(paths);
        await config.SaveAsync(new ShellConfig { ServerUrl = _upstream.Url, Lang = "en" });
        var copy = new LocalizationService();
        var credentials = new FileCredentialStore(paths);
        var services = new ShellServices
        {
            Config = config,
            Copy = copy,
            Credentials = credentials,
            Tray = new TrayService(copy),
            Notifier = new SystemNotifier((_, _, _) => Task.FromResult(true)),
            DeepLinks = new DeepLinkQueue(),
            Executor = new ExecutorService(credentials),
            Upgrade = new UpgradeService(new NoSource(), new NoDownloader(), new NoVerifier(), new NoInstaller(),
                config, "0.1.0", ""),
            Paths = paths
        };
        _gateway = new LoopbackGateway(services);
        var baseAddress = await _gateway.StartAsync();
        Assert.Equal(baseAddress, await _gateway.StartAsync()); // starting twice is a no-op

        _client = new HttpClient { BaseAddress = baseAddress };
        _client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", _gateway.Token);
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _gateway.DisposeAsync();
        await _gateway.DisposeAsync(); // idempotent
        await _upstream.DisposeAsync();
        if (Directory.Exists(_root)) Directory.Delete(_root, true);
    }

    [Fact]
    public async Task TheRootPathAnswersWithTheShellIdentity()
    {
        var body = await _client.GetStringAsync("/");
        Assert.Contains("avalonia", body);
        Assert.Contains("agentbuddy", body);
    }

    [Fact]
    public async Task UnauthenticatedAndUnknownPathsAreRefusedWithMachineCodes()
    {
        using var anonymous = new HttpClient { BaseAddress = _gateway.BaseAddress };
        var unauthorized = await anonymous.GetAsync("/api/workspace");
        Assert.Equal(HttpStatusCode.Unauthorized, unauthorized.StatusCode);
        Assert.Contains(ErrorCodes.ProxyUnauthorized, await unauthorized.Content.ReadAsStringAsync());

        var unknown = await _client.GetAsync("/nope");
        Assert.Equal(HttpStatusCode.NotFound, unknown.StatusCode);
        Assert.Contains(ErrorCodes.NotFound, await unknown.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task BootstrapOnlyAnswersGetAndOnlyWithASingleUseNonce()
    {
        var post = await _client.PostAsync(ShellEndpoints.Bootstrap, null);
        Assert.Equal(HttpStatusCode.NotFound, post.StatusCode);

        var noNonce = await _client.GetAsync(ShellEndpoints.Bootstrap);
        Assert.Equal(HttpStatusCode.Forbidden, noNonce.StatusCode);
        Assert.Contains(ErrorCodes.ProxyNonceRefused, await noNonce.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task ForwardedPathsAreProxiedWithTheirBodiesAndHeaders()
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/echo?x=1")
        {
            Content = new StringContent("""{"hello":"world"}""", Encoding.UTF8, "application/json")
        };
        request.Headers.TryAddWithoutValidation("X-Trace", "abc");
        var response = await _client.SendAsync(request);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("world", body);
        Assert.Contains("/api/echo", body);
        // The custom request header reached upstream (it echoed it back).
        Assert.Equal("abc", response.Headers.GetValues("X-Trace").Single());
    }

    [Fact]
    public async Task ServerRedirectsAreRewrittenOntoTheLoopbackOrigin()
    {
        // Redirects are not followed: the Authorization header would be dropped and the
        // test would measure that, not the rewrite.
        using var noRedirect = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false })
        {
            BaseAddress = _gateway.BaseAddress
        };
        noRedirect.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", _gateway.Token);
        var response = await noRedirect.GetAsync("/api/redirect");
        Assert.Equal(HttpStatusCode.Redirect, response.StatusCode);
        var locations = response.Headers.GetValues("Location").ToArray();
        Assert.Equal(2, locations.Length); // every value is rewritten, not just the first
        Assert.StartsWith(_gateway.BaseAddress.ToString().TrimEnd('/'), locations[0]);
        Assert.Contains("/after", locations[0]);
        Assert.Equal("https://evil.test/after", locations[1]); // another origin is left alone
    }

    [Fact]
    public async Task ATraversalPathNeverReachesTheUpstream()
    {
        // The request line keeps the encoded segment; the gateway refuses it before forwarding.
        var raw = new RawRequest(_gateway.BaseAddress, _gateway.Token);
        var status = await raw.SendAsync("GET /api/..%2Fx HTTP/1.1");
        Assert.True(status is 400 or 404, $"got {status}");

        Assert.False(LoopbackGateway.IsForwardablePath("/api/../admin"));
        Assert.False(LoopbackGateway.IsForwardablePath("/api\\x"));
        Assert.False(LoopbackGateway.IsForwardablePath("//evil.test/api"));
        Assert.True(LoopbackGateway.IsForwardablePath("/api/workspace"));
    }

    [Fact]
    public async Task AnUnconfiguredOrUnreachableServerIsAMachineCode()
    {
        var unconfigured = await GatewayWith(new ShellConfig { ServerUrl = "" });
        var response = await unconfigured.Client.SendAsync(Get("/api/workspace", unconfigured.Token));
        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        Assert.Contains(ErrorCodes.ServerNotConfigured, await response.Content.ReadAsStringAsync());
        await unconfigured.DisposeAsync();

        var dead = await GatewayWith(new ShellConfig { ServerUrl = "http://127.0.0.1:1" });
        var refused = await dead.Client.SendAsync(Get("/api/workspace", dead.Token));
        Assert.Equal(HttpStatusCode.BadGateway, refused.StatusCode);
        Assert.Contains("unreachable", await refused.Content.ReadAsStringAsync());
        await dead.DisposeAsync();
    }

    [Fact]
    public async Task ADispatcherFailureIsAnInternalErrorNotACrash()
    {
        var pair = await GatewayWith(new ShellConfig { ServerUrl = _upstream.Url, Lang = "en" }, new ThrowingCredentials());
        var response = await pair.Client.SendAsync(Get(ShellEndpoints.Config, pair.Token));
        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
        Assert.Contains(ErrorCodes.InternalError, await response.Content.ReadAsStringAsync());
        await pair.DisposeAsync();
    }

    [Fact]
    public async Task TheUpstreamSessionCookieIsRememberedWhileTransientOnesAreOnlyForwarded()
    {
        var response = await _client.GetAsync("/api/session");
        var cookies = response.Headers.GetValues("Set-Cookie").ToArray();
        Assert.Contains(cookies, c => c.StartsWith("agenthub_session=", StringComparison.Ordinal));
        Assert.Contains(cookies, c => c.StartsWith("oauth_state=", StringComparison.Ordinal));
    }

    [Fact]
    public async Task ALockedCredentialStoreDoesNotTurnALoginIntoAFailure()
    {
        var pair = await GatewayWith(new ShellConfig { ServerUrl = _upstream.Url, Lang = "en" },
            new LockedCredentials());
        var response = await pair.Client.SendAsync(Get("/api/session", pair.Token));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode); // the 502 is never raised
        await pair.DisposeAsync();
    }

    private static HttpRequestMessage Get(string path, string token)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, path);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return request;
    }

    private async Task<Pair> GatewayWith(ShellConfig config, ICredentialStore? credentials = null)
    {
        var root = Path.Combine(_root, Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        var paths = new AppPaths(root);
        var service = new ConfigService(paths);
        await service.SaveAsync(config);
        var copy = new LocalizationService();
        var store = credentials ?? new FileCredentialStore(paths);
        var shell = new ShellServices
        {
            Config = service, Copy = copy, Credentials = store, Tray = new TrayService(copy),
            Notifier = new SystemNotifier((_, _, _) => Task.FromResult(true)), DeepLinks = new DeepLinkQueue(),
            Executor = new ExecutorService(store),
            Upgrade = new UpgradeService(new NoSource(), new NoDownloader(), new NoVerifier(), new NoInstaller(),
                service, "0.1.0", ""),
            Paths = paths
        };
        var gateway = new LoopbackGateway(shell);
        var address = await gateway.StartAsync();
        var client = new HttpClient { BaseAddress = address };
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", gateway.Token);
        return new Pair(client, gateway, gateway.Token);
    }

    private sealed record Pair(HttpClient Client, LoopbackGateway Gateway, string Token) : IAsyncDisposable
    {
        public ValueTask DisposeAsync()
        {
            Client.Dispose();
            return Gateway.DisposeAsync();
        }
    }

    /// <summary>A one-shot raw HTTP client: HttpClient would normalise the traversal path away.</summary>
    private sealed class RawRequest(Uri baseAddress, string token)
    {
        public async Task<int> SendAsync(string requestLine)
        {
            using var socket = new TcpClient();
            await socket.ConnectAsync(baseAddress.Host, baseAddress.Port);
            await using var stream = socket.GetStream();
            var text = requestLine + "\r\nHost: " + baseAddress.Authority +
                       "\r\nAuthorization: Bearer " + token + "\r\nConnection: close\r\n\r\n";
            await stream.WriteAsync(Encoding.ASCII.GetBytes(text));
            var buffer = new byte[512];
            var read = await stream.ReadAtLeastAsync(buffer, 1, throwOnEndOfStream: false);
            var response = Encoding.ASCII.GetString(buffer, 0, read);
            var status = response.Split(' ')[1];
            return int.Parse(status);
        }
    }

    private sealed class LockedCredentials : ICredentialStore
    {
        public string Backend => "keyring";
        public Task<string?> GetAsync(string name, CancellationToken ct = default) => Task.FromResult<string?>(null);
        public Task SetAsync(string name, string secret, CancellationToken ct = default) =>
            throw new InvalidOperationException("keychain locked");
        public Task DeleteAsync(string name, CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class ThrowingCredentials : ICredentialStore
    {
        public string Backend => "memory";
        public Task<string?> GetAsync(string name, CancellationToken ct = default) =>
            throw new InvalidOperationException("store down");
        public Task SetAsync(string name, string secret, CancellationToken ct = default) => Task.CompletedTask;
        public Task DeleteAsync(string name, CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class Upstream : IAsyncDisposable
    {
        private readonly WebApplication _app;
        public string Url { get; }

        public Upstream()
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
            app.Run(async context =>
            {
                var path = context.Request.Path.Value ?? "";
                if (path == "/api/redirect")
                {
                    context.Response.StatusCode = 302;
                    context.Response.Headers.Append("Location", Url + "/after?a=1");
                    context.Response.Headers.Append("Location", "https://evil.test/after");
                    return;
                }
                if (path == "/api/session")
                {
                    context.Response.Headers.Append("Set-Cookie",
                        "agenthub_session=abc; Path=/api; Domain=hub.example.com; Secure; HttpOnly; SameSite=None");
                    context.Response.Headers.Append("Set-Cookie", "oauth_state=t; Path=/; HttpOnly");
                }
                if (path.EndsWith("/events", StringComparison.Ordinal))
                {
                    context.Response.ContentType = "text/event-stream";
                    await context.Response.WriteAsync("event: task_status_update\ndata: {}\n\n");
                    return;
                }
                string body;
                using (var reader = new StreamReader(context.Request.Body))
                    body = await reader.ReadToEndAsync();
                if (context.Request.Headers.TryGetValue("X-Trace", out var trace))
                    context.Response.Headers.Append("X-Trace", trace.ToString());
                context.Response.ContentType = "application/json";
                await context.Response.WriteAsync(
                    "{\"path\":" + System.Text.Json.JsonSerializer.Serialize(path) + ",\"body\":" +
                    System.Text.Json.JsonSerializer.Serialize(body) + "}");
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

    private sealed class NoSource : IReleaseSource
    {
        public Task<ReleaseProbe> ProbeAsync(CancellationToken ct) =>
            Task.FromResult(new ReleaseProbe("github", "", 1, "network_failed"));
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
