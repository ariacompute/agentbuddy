using System.Net;
using System.Net.Sockets;
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
using Microsoft.AspNetCore.Http;
using Xunit;

namespace AgentBuddy.Shell.Tests;

/// <summary>
/// Drives every /__shell/* route and every rejection branch through the real
/// handler with a DefaultHttpContext, so the whole local control plane is covered
/// without opening a socket.
/// </summary>
public class ShellRouteTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "ab-" + Guid.NewGuid().ToString("N"));
    private readonly MemoryCredentials _credentials = new();
    private readonly RecordingNotifier _notifier = new();
    private readonly List<string> _hidden = [];
    private readonly ShellServices _services;
    private readonly TrayService _tray;

    public ShellRouteTests()
    {
        var paths = new AppPaths(_root);
        var config = new ConfigService(paths);
        var copy = new LocalizationService();
        _tray = new TrayService(copy);
        _services = new ShellServices
        {
            Config = config,
            Copy = copy,
            Credentials = _credentials,
            Tray = _tray,
            Notifier = _notifier,
            DeepLinks = new DeepLinkQueue(),
            Executor = new ExecutorService(_credentials),
            Upgrade = new UpgradeService(
                new StaticSource(new ReleaseProbe("github", Manifest("9.9.9"), 1)),
                new StaticDownloader([1, 2, 3]),
                new StubVerifier(false),
                new StubInstaller(false),
                config, "0.1.0", "", "windows-x86_64"),
            Paths = paths,
            Version = "1.2.3",
            Commit = "abc123",
            HideWindow = () => { _hidden.Add("hide"); return Task.CompletedTask; }
        };
    }

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, true);
    }

    private async Task<(int Status, string Body)> CallAsync(string method, string path, string? body = null,
        long? contentLength = null, ShellServices? services = null)
    {
        var context = new DefaultHttpContext();
        var stream = new MemoryStream();
        context.Response.Body = stream;
        context.Request.Method = method;
        context.Request.Path = path;
        if (body is not null)
        {
            var bytes = Encoding.UTF8.GetBytes(body);
            context.Request.Body = new MemoryStream(bytes);
            context.Request.ContentLength = contentLength ?? bytes.Length;
        }
        await ShellRoutes.HandleAsync(context, services ?? _services, CancellationToken.None);
        stream.Position = 0;
        return (context.Response.StatusCode, Encoding.UTF8.GetString(stream.ToArray()));
    }

    private static string Manifest(string version, string signature = "sig") => JsonSerializer.Serialize(new
    {
        version,
        notes = "notes",
        pub_date = "2026-01-01T00:00:00Z",
        platforms = new Dictionary<string, object>
        {
            ["windows-x86_64"] = new
            {
                url = "https://github.com/ariacompute/agentbuddy/releases/download/v9/agentbuddy-9.9.9.msi",
                signature
            }
        },
        signatures = new Dictionary<string, string> { ["agentbuddy-9.9.9.msi"] = signature }
    });

    private ShellServices WithUpgrade(string pubkey, string manifest, IUpgradeInstaller? installer = null) =>
        new()
        {
            Config = _services.Config,
            Copy = _services.Copy,
            Credentials = _credentials,
            Tray = _tray,
            Notifier = _notifier,
            DeepLinks = _services.DeepLinks,
            Executor = _services.Executor,
            Upgrade = new UpgradeService(new StaticSource(new ReleaseProbe("github", manifest, 1)),
                new StaticDownloader([1, 2, 3]), new StubVerifier(false), installer ?? new StubInstaller(false),
                _services.Config, "0.1.0", pubkey, "windows-x86_64"),
            Paths = _services.Paths
        };

    [Theory]
    [InlineData("/__shell/connect")]
    [InlineData("/__shell")]
    [InlineData("/__shell/")]
    public async Task ConnectRoutesAnswerWithTheShellIdentity(string path)
    {
        var (status, body) = await CallAsync("GET", path);
        Assert.Equal(200, status);
        Assert.Contains("\"page\":\"connect\"", body);
        Assert.Contains("avalonia", body);
    }

    [Fact]
    public async Task AboutReportsVersionAndCommit()
    {
        var (status, body) = await CallAsync("GET", ShellEndpoints.About);
        Assert.Equal(200, status);
        Assert.Contains("1.2.3", body);
        Assert.Contains("abc123", body);
    }

    [Fact]
    public async Task ConfigRoundTripsWithoutEverEchoingTheKey()
    {
        var (status, body) = await CallAsync("GET", ShellEndpoints.Config);
        Assert.Equal(200, status);
        Assert.Contains("\"executorHasApiKey\":false", body);
        Assert.Contains("\"sessionBackend\":\"memory\"", body);

        _credentials.Values["executor_api_key"] = "secret";
        _credentials.Backend = "keyring";
        body = (await CallAsync("GET", ShellEndpoints.Config)).Body;
        Assert.Contains("\"executorHasApiKey\":true", body);
        Assert.Contains("keyring", body);
        Assert.DoesNotContain("secret", body);
    }

    [Fact]
    public async Task ConfigPatchValidatesTypesAndValues()
    {
        Assert.Equal(400, (await CallAsync("POST", ShellEndpoints.Config)).Status);                    // no body
        Assert.Equal(400, (await CallAsync("POST", ShellEndpoints.Config, "")).Status);                // empty body
        Assert.Equal(400, (await CallAsync("POST", ShellEndpoints.Config, "{")).Status);               // broken JSON
        Assert.Equal(400, (await CallAsync("POST", ShellEndpoints.Config, "not json")).Status);
        Assert.Equal(400, (await CallAsync("POST", ShellEndpoints.Config, "null")).Status);
        // A chunked request has no Content-Length and is capped on bytes read.
        Assert.Equal(400, (await CallAsync("POST", ShellEndpoints.Config, new string('x', Limits.MaxShellBody + 1),
            contentLength: null)).Status);
    }

    [Fact]
    public async Task ConfigPatchStoresTheApiKeyInTheCredentialStoreOnly()
    {
        var (status, body) = await CallAsync("POST", ShellEndpoints.Config,
            """{"executorApiKey":"k-123","lang":"ar","notifyQuietMinutes":15}""");
        Assert.Equal(200, status);
        Assert.Contains("\"ok\":true", body);
        Assert.Equal("k-123", _credentials.Values["executor_api_key"]);
        Assert.DoesNotContain("k-123", await File.ReadAllTextAsync(_services.Paths.ConfigFile));
        Assert.True(_services.QuietUntil > DateTimeOffset.UtcNow);
        Assert.Equal("ar", _services.Copy.Lang); // the tray refresh followed the language patch
    }

    [Fact]
    public async Task ConfigPatchRejectsBadSecretsAndBadValues()
    {
        Assert.Equal(ErrorCodes.Invalid, Code(await CallAsync("POST", ShellEndpoints.Config, """{"executorApiKey":5}""")));
        Assert.Equal(ErrorCodes.Invalid, Code(await CallAsync("POST", ShellEndpoints.Config,
            "{\"executorApiKey\":\"" + new string('k', Limits.MaxSecretChars + 1) + "\"}")));
        Assert.Equal(ErrorCodes.Invalid, Code(await CallAsync("POST", ShellEndpoints.Config, """{"serverUrl":5}""")));
        Assert.Contains(ErrorCodes.Invalid, Code(await CallAsync("POST", ShellEndpoints.Config, """{"serverUrl":"ftp://x"}""")));
        Assert.Equal(ErrorCodes.Empty, Code(await CallAsync("POST", ShellEndpoints.Config, """{"serverUrl":"  "}""")));
        Assert.Equal(ErrorCodes.Invalid, Code(await CallAsync("POST", ShellEndpoints.Config, """{"serverUrl":"http://u:p@h"}""")));
        Assert.Equal(ErrorCodes.Invalid, Code(await CallAsync("POST", ShellEndpoints.Config, """{"serverUrl":"http://h/#f"}""")));
        Assert.Equal(ErrorCodes.Invalid, Code(await CallAsync("POST", ShellEndpoints.Config, """{"serverUrl":"http://h/ with space"}""")));
        Assert.Equal(ErrorCodes.Invalid, Code(await CallAsync("POST", ShellEndpoints.Config,
            "{\"serverUrl\":\"http://h/" + new string('a', 2048) + "\"}")));
        Assert.Equal(ErrorCodes.Invalid, Code(await CallAsync("POST", ShellEndpoints.Config, """{"notifyQuietMinutes":"soon"}""")));
        Assert.Equal(ErrorCodes.Invalid, Code(await CallAsync("POST", ShellEndpoints.Config, """{"executorMaxConcurrency":"many"}""")));
    }

    [Fact]
    public async Task ConfigPatchFailurePathsAreMachineCodes()
    {
        // A store that refuses the secret is a 500, not a silently dropped key.
        var refusing = new MemoryCredentials { FailSet = true };
        var services = new ShellServices
        {
            Config = _services.Config, Copy = _services.Copy, Credentials = refusing, Tray = _tray,
            Notifier = _notifier, DeepLinks = _services.DeepLinks, Executor = _services.Executor,
            Upgrade = _services.Upgrade, Paths = _services.Paths
        };
        Assert.Equal(ErrorCodes.NotSaved, Code(await CallAsync("POST", ShellEndpoints.Config,
            """{"executorApiKey":"k"}""", services: services)));

        // A config.json that cannot be written surfaces as not_saved rather than a crash.
        Directory.CreateDirectory(_services.Paths.ConfigFile);
        Assert.Equal(ErrorCodes.NotSaved, Code(await CallAsync("POST", ShellEndpoints.Config, """{"lang":"de"}""")));
    }

    [Fact]
    public async Task ExecutorStatusAndToggleAreExposedWithTheSameValidation()
    {
        var (status, body) = await CallAsync("GET", ShellEndpoints.Executor);
        Assert.Equal(200, status);
        Assert.Contains("\"status\":\"disabled\"", body);
        Assert.Contains("shellsRefused", body);
        Assert.Contains("maxOutputBytes", body);

        Assert.Equal(400, (await CallAsync("POST", ShellEndpoints.Executor)).Status);                  // no body
        Assert.Equal(400, (await CallAsync("POST", ShellEndpoints.Executor, "{")).Status);             // broken JSON

        // Enabling without explicit confirmation is refused by the service itself.
        var unconfirmed = await CallAsync("POST", ShellEndpoints.Executor, """{"enabled":true,"userConfirmed":false}""");
        Assert.Equal(400, unconfirmed.Status);
        Assert.Contains(ErrorCodes.Forbidden, unconfirmed.Body);
        Assert.False(_services.Executor.Enabled);

        var enabled = await CallAsync("POST", ShellEndpoints.Executor, """{"enabled":true,"userConfirmed":true}""");
        Assert.Equal(200, enabled.Status);
        Assert.Contains("\"status\":\"running\"", enabled.Body);
        Assert.True(_services.Executor.Enabled);

        var disabled = await CallAsync("POST", ShellEndpoints.Executor, """{"enabled":false}""");
        Assert.Equal(200, disabled.Status);
        Assert.False(_services.Executor.Enabled);
    }

    [Fact]
    public async Task ExecutorRouteValidatesRootAllowlistAndKeyBeforeApplying()
    {
        Assert.Equal(ErrorCodes.Invalid, Code(await CallAsync("POST", ShellEndpoints.Executor, """{"executorApiKey":5}""")));
        Assert.Equal(ExecutorReject.RootUnusable,
            Code(await CallAsync("POST", ShellEndpoints.Executor, """{"executorRoot":5}""")));
        Assert.Equal(ExecutorReject.RootUnusable,
            Code(await CallAsync("POST", ShellEndpoints.Executor, """{"executorRoot":"relative/path"}""")));
        Assert.Equal(ExecutorReject.CommandNotAllowed,
            Code(await CallAsync("POST", ShellEndpoints.Executor, """{"executorAllowlist":"node"}""")));
        Assert.Equal(ExecutorReject.CommandNotAllowed,
            Code(await CallAsync("POST", ShellEndpoints.Executor, """{"executorAllowlist":[5]}""")));
        Assert.Equal(ExecutorReject.CommandNotAllowed,
            Code(await CallAsync("POST", ShellEndpoints.Executor, """{"executorAllowlist":["bash"]}""")));

        // An absolute, existing root plus a plain command name is accepted and persisted.
        var root = Path.Combine(Path.GetTempPath(), "ab-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            var (status, body) = await CallAsync("POST", ShellEndpoints.Executor,
                JsonSerializer.Serialize(new { executorRoot = root, executorAllowlist = new[] { "node" }, executorApiKey = "k" }));
            Assert.Equal(200, status);
            Assert.Contains("\"ok\":true", body);
            Assert.Equal(root, _services.Config.Current.ExecutorRoot);
            Assert.Equal(new[] { "node" }, _services.Config.Current.ExecutorAllowlist);
            Assert.Equal("k", _credentials.Values["executor_api_key"]);
        }
        finally { Directory.Delete(root, true); }
    }

    [Fact]
    public async Task ExecutorRouteReportsAStoreFailureAsNotSaved()
    {
        var refusing = new MemoryCredentials { FailSet = true };
        var services = new ShellServices
        {
            Config = _services.Config, Copy = _services.Copy, Credentials = refusing, Tray = _tray,
            Notifier = _notifier, DeepLinks = _services.DeepLinks, Executor = _services.Executor,
            Upgrade = _services.Upgrade, Paths = _services.Paths
        };
        Assert.Equal(ErrorCodes.NotSaved, Code(await CallAsync("POST", ShellEndpoints.Executor,
            """{"executorApiKey":"k"}""", services: services)));
    }

    [Fact]
    public async Task TestConnectionProbesHealthWithoutFollowingRedirects()
    {
        Assert.Equal(400, (await CallAsync("POST", ShellEndpoints.Test)).Status);
        Assert.Equal(400, (await CallAsync("POST", ShellEndpoints.Test, "{")).Status);
        Assert.Equal(ErrorCodes.Invalid, Code(await CallAsync("POST", ShellEndpoints.Test, """{"serverUrl":"nope"}""")));

        using var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        _ = Task.Run(async () =>
        {
            using var socket = await listener.AcceptTcpClientAsync();
            await using var stream = socket.GetStream();
            var buffer = new byte[2048];
            _ = await stream.ReadAtLeastAsync(buffer, 1, throwOnEndOfStream: false);
            await stream.WriteAsync(Encoding.ASCII.GetBytes(
                "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}"));
        });
        var ok = await CallAsync("POST", ShellEndpoints.Test, $$"""{"serverUrl":"http://127.0.0.1:{{port}}"}""");
        Assert.Equal(200, ok.Status);
        Assert.Contains("\"ok\":true", ok.Body);
        Assert.Contains("\"status\":200", ok.Body);

        // A closed port is reported as a machine reason, not as a thrown error.
        var refused = await CallAsync("POST", ShellEndpoints.Test, """{"serverUrl":"http://127.0.0.1:1"}""");
        Assert.Equal(200, refused.Status);
        Assert.Contains("\"ok\":false", refused.Body);
        Assert.Contains("unreachable", refused.Body);
    }

    [Fact]
    public async Task NotifyHonoursEnablementQuietHoursAndFieldRules()
    {
        Assert.Equal(400, (await CallAsync("POST", ShellEndpoints.Notify)).Status);
        Assert.Equal(400, (await CallAsync("POST", ShellEndpoints.Notify, "{")).Status);

        var missing = await CallAsync("POST", ShellEndpoints.Notify, """{"title":" ","body":"b"}""");
        Assert.Contains("missing_fields", missing.Body);

        await _services.Config.SaveAsync(_services.Config.Current with { NotifyEnabled = false });
        Assert.Contains("disabled", (await CallAsync("POST", ShellEndpoints.Notify,
            """{"title":"t","body":"b"}""")).Body);

        await _services.Config.SaveAsync(_services.Config.Current with { NotifyEnabled = true });
        _services.QuietUntil = DateTimeOffset.UtcNow.AddMinutes(5);
        Assert.Contains("disabled", (await CallAsync("POST", ShellEndpoints.Notify,
            """{"title":"t","body":"b"}""")).Body);

        _services.QuietUntil = default;
        var ok = await CallAsync("POST", ShellEndpoints.Notify,
            """{"title":"line1\nline2","body":"body","link":"/threads/42"}""");
        Assert.Contains("\"ok\":true", ok.Body);
        var seen = Assert.Single(_notifier.Seen);
        Assert.DoesNotContain('\n', seen.Title);
        Assert.Equal("/threads/42", seen.Link);
        Assert.Equal(1, _services.DeepLinks.Count);

        // An invalid deep link is dropped while the toast still shows.
        var badLink = await CallAsync("POST", ShellEndpoints.Notify,
            """{"title":"t","body":"b","link":"//evil.example"}""");
        Assert.Contains("\"ok\":true", badLink.Body);
        Assert.Equal(1, _services.DeepLinks.Count);

        _notifier.Reason = "no_app";
        var refused = await CallAsync("POST", ShellEndpoints.Notify, """{"title":"t","body":"b"}""");
        Assert.Contains("\"ok\":false", refused.Body);
        Assert.Contains("no_app", refused.Body);
    }

    [Fact]
    public async Task BadgeIsClampedAndRejectsNonsense()
    {
        Assert.Equal(400, (await CallAsync("POST", ShellEndpoints.Badge)).Status);
        Assert.Equal(400, (await CallAsync("POST", ShellEndpoints.Badge, "{")).Status);
        Assert.Equal(ErrorCodes.InvalidCount, Code(await CallAsync("POST", ShellEndpoints.Badge, "{}")));
        Assert.Equal(ErrorCodes.InvalidCount, Code(await CallAsync("POST", ShellEndpoints.Badge, """{"count":-1}""")));
        Assert.Equal(ErrorCodes.InvalidCount, Code(await CallAsync("POST", ShellEndpoints.Badge, """{"count":"9"}""")));

        var (status, body) = await CallAsync("POST", ShellEndpoints.Badge, """{"count":5000}""");
        Assert.Equal(200, status);
        Assert.Contains($"\"count\":{Limits.MaxBadge}", body);
        Assert.Equal(Limits.MaxBadge, _tray.Unread);
    }

    [Fact]
    public async Task HideCallsTheWindowCallbackWhenOneIsWired()
    {
        var (status, _) = await CallAsync("POST", ShellEndpoints.Hide, "{}");
        Assert.Equal(200, status);
        Assert.Single(_hidden);

        var bare = new ShellServices
        {
            Config = _services.Config, Copy = _services.Copy, Credentials = _credentials, Tray = _tray,
            Notifier = _notifier, DeepLinks = _services.DeepLinks, Executor = _services.Executor,
            Upgrade = _services.Upgrade, Paths = _services.Paths
        };
        Assert.Equal(200, (await CallAsync("POST", ShellEndpoints.Hide, "{}", services: bare)).Status);
        Assert.Single(_hidden);
    }

    [Fact]
    public async Task UpgradeRoutesReportNotConfiguredAvailableAndInstalledStates()
    {
        // Before the first check the state is idle; with no public key it is inert.
        var idle = await CallAsync("GET", ShellEndpoints.Upgrade);
        Assert.Equal(200, idle.Status);
        Assert.Contains("\"status\":\"idle\"", idle.Body);
        Assert.Equal(404, (await CallAsync("POST", ShellEndpoints.UpgradeCheck, "")).Status);
        Assert.Equal(404, (await CallAsync("GET", ShellEndpoints.Upgrade)).Status);
        Assert.Equal(ErrorCodes.NotConfigured, Code(await CallAsync("POST", ShellEndpoints.UpgradeInstall, "")));

        var configured = WithUpgrade("pubkey", Manifest("9.9.9"));
        var available = await CallAsync("POST", ShellEndpoints.UpgradeCheck, "", services: configured);
        Assert.Equal(200, available.Status);
        Assert.Contains("\"status\":\"available\"", available.Body);

        Assert.Equal(200, (await CallAsync("GET", ShellEndpoints.Upgrade, services: configured)).Status);

        // A signature that does not verify leaves the install route at a 400 with the code.
        var refused = await CallAsync("POST", ShellEndpoints.UpgradeInstall, "", services: configured);
        Assert.Equal(400, refused.Status);
        Assert.Contains("signature_failed", refused.Body);
    }

    [Fact]
    public async Task UnknownRoutesAndMethodsAreNotFound()
    {
        Assert.Equal(404, (await CallAsync("GET", "/__shell/nope")).Status);
        Assert.Equal(404, (await CallAsync("DELETE", ShellEndpoints.Config)).Status);
        Assert.Equal(ErrorCodes.NotFound, Code(await CallAsync("GET", "/__shell/nope")));
    }

    [Fact]
    public void ValidatePatchAcceptsOnlyTheDocumentedTypes()
    {
        Assert.Null(ShellRoutes.ValidatePatch([]));
        Assert.Null(ShellRoutes.ValidatePatch(JsonObject("""{"serverUrl":"https://hub.example.com"}""")));
        Assert.Equal(ExecutorReject.RootUnusable,
            ShellRoutes.ValidatePatch(JsonObject("""{"executorRoot":"./x"}""")));
        Assert.Null(ShellRoutes.ValidatePatch(JsonObject("""{"executorRoot":""}""")));
        Assert.Null(ShellRoutes.ValidatePatch(JsonObject("""{"executorAllowlist":["node","python3"]}""")));
        Assert.Equal(ExecutorReject.CommandNotAllowed,
            ShellRoutes.ValidatePatch(JsonObject("""{"executorAllowlist":["../bash"]}""")));
        Assert.Null(ShellRoutes.ValidatePatch(JsonObject("""{"executorMaxConcurrency":4,"notifyQuietMinutes":10}""")));
    }

    [Theory]
    [InlineData("", ErrorCodes.Empty)]
    [InlineData("   ", ErrorCodes.Empty)]
    [InlineData("http://h/ with space", ErrorCodes.Invalid)]
    [InlineData("http://h/a\tb", ErrorCodes.Invalid)]
    [InlineData("http://h/\t", null)] // trailing whitespace is trimmed, not rejected
    [InlineData("http://h/#frag", ErrorCodes.Invalid)]
    [InlineData("http://user:pw@h", ErrorCodes.Invalid)]
    [InlineData("ws://h", ErrorCodes.Invalid)]
    [InlineData("http://", ErrorCodes.Invalid)]
    [InlineData("http://hub.example.com", null)]
    [InlineData("https://hub.example.com:8443/base", null)]
    public void ServerUrlValidationIsAnOriginAndNothingElse(string value, string? expected) =>
        Assert.Equal(expected, ShellRoutes.ValidateServerUrl(value));

    private static string Code((int Status, string Body) result)
    {
        using var doc = JsonDocument.Parse(result.Body);
        return doc.RootElement.TryGetProperty("code", out var code) ? code.GetString() ?? "" : "";
    }

    private static System.Text.Json.Nodes.JsonObject JsonObject(string json) =>
        System.Text.Json.Nodes.JsonNode.Parse(json)!.AsObject();

    private sealed class MemoryCredentials : ICredentialStore
    {
        public Dictionary<string, string> Values { get; } = new(StringComparer.Ordinal);
        public string Backend { get; set; } = "memory";
        public bool FailSet { get; set; }

        public Task<string?> GetAsync(string name, CancellationToken ct = default) =>
            Task.FromResult(Values.TryGetValue(name, out var value) ? value : null);

        public Task SetAsync(string name, string secret, CancellationToken ct = default)
        {
            if (FailSet) throw new InvalidOperationException("store unavailable");
            Values[name] = secret;
            return Task.CompletedTask;
        }

        public Task DeleteAsync(string name, CancellationToken ct = default)
        {
            Values.Remove(name);
            return Task.CompletedTask;
        }
    }

    private sealed class RecordingNotifier : ISystemNotifier
    {
        public List<(string Title, string Body, string? Link)> Seen { get; } = [];
        public string? Reason { get; set; }

        public Task<string?> NotifyAsync(string title, string body, string? link, CancellationToken ct = default)
        {
            Seen.Add((title, body, link));
            return Task.FromResult(Reason);
        }
    }

    private sealed class StaticSource(ReleaseProbe probe) : IReleaseSource
    {
        public Task<ReleaseProbe> ProbeAsync(CancellationToken ct) => Task.FromResult(probe);
    }

    private sealed class StaticDownloader(byte[] bytes) : IReleaseDownloader
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
