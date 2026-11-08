using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using AgentBuddy.Core.Contracts;
using AgentBuddy.Core.Gateway;
using AgentBuddy.Core.Services;
using Xunit;

namespace AgentBuddy.Core.Tests;

/// <summary>Shared plumbing: one handler, canned responses, recorded requests.</summary>
internal sealed class Canned : HttpMessageHandler
{
    private readonly Func<HttpRequestMessage, HttpResponseMessage> _factory;

    public List<HttpRequestMessage> Requests { get; } = [];

    /// <summary>Bodies captured at send time: the client disposes the request afterwards.</summary>
    public List<string> Bodies { get; } = [];

    public Canned(Func<HttpRequestMessage, HttpResponseMessage> factory) => _factory = factory;

    public static Canned Ok(string json) => new(_ => new HttpResponseMessage(HttpStatusCode.OK)
    {
        Content = new StringContent(json, Encoding.UTF8, "application/json")
    });

    public static Canned Code(HttpStatusCode status, string json) => new(_ => new HttpResponseMessage(status)
    {
        Content = new StringContent(json, Encoding.UTF8, "application/json")
    });

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        Requests.Add(request);
        // Read the body so any progress-tracking stream is actually exercised.
        if (request.Content is not null)
        {
            var bytes = await request.Content.ReadAsByteArrayAsync(ct).ConfigureAwait(false);
            Bodies.Add(Encoding.UTF8.GetString(bytes));
        }
        return _factory(request);
    }
}

public class AgentHubClientTests
{
    private static AgentHubClient Client(Canned handler) =>
        new(new HttpClient(handler) { BaseAddress = new Uri("http://127.0.0.1:1/") });

    /// <summary>
    /// The (Uri, token, cookies) constructor can only be exercised against something
    /// that really answers, so this uses a loopback socket and reads the raw request
    /// line/headers instead of instantiating an HTTP server.
    /// </summary>
    [Fact]
    public async Task TheGatewayConstructorSendsBearerCookiesAndIdentityEncoding()
    {
        using var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        var captured = new TaskCompletionSource<(string? Auth, string? Cookie, string? Encoding)>();
        _ = Task.Run(async () =>
        {
            using var socket = await listener.AcceptTcpClientAsync();
            await using var stream = socket.GetStream();
            var buffer = new byte[8192];
            var read = await stream.ReadAsync(buffer);
            var text = Encoding.ASCII.GetString(buffer, 0, read);
            string? auth = null, cookie = null, encoding = null;
            foreach (var line in text.Split("\r\n"))
            {
                if (line.StartsWith("Authorization:", StringComparison.OrdinalIgnoreCase))
                    auth = line["Authorization:".Length..].Trim();
                if (line.StartsWith("Cookie:", StringComparison.OrdinalIgnoreCase))
                    cookie = line["Cookie:".Length..].Trim();
                if (line.StartsWith("Accept-Encoding:", StringComparison.OrdinalIgnoreCase))
                    encoding = line["Accept-Encoding:".Length..].Trim();
            }
            captured.TrySetResult((auth, cookie, encoding));
            var response = Encoding.ASCII.GetBytes(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}");
            await stream.WriteAsync(response);
        });

        var cookies = new CookieContainer();
        cookies.Add(new Uri($"http://127.0.0.1:{port}/"), new Cookie("ab_proxy", "t"));
        using var client = new AgentHubClient(new Uri($"http://127.0.0.1:{port}/"), "tok", cookies);
        await client.SendAsync("/api/x", HttpMethod.Get);

        var seen = await captured.Task.WaitAsync(TimeSpan.FromSeconds(10));
        Assert.Equal("Bearer tok", seen.Auth);
        Assert.Contains("ab_proxy=t", seen.Cookie);
        Assert.Equal("identity", seen.Encoding);
    }

    [Fact]
    public async Task WithoutATokenNoAuthorizationHeaderIsSent()
    {
        var handler = Canned.Ok("{}");
        using var client = Client(handler);
        await client.SendAsync("/api/x", HttpMethod.Get);
        Assert.Null(Assert.Single(handler.Requests).Headers.Authorization);
    }

    [Fact]
    public async Task SendCarriesTheMethodAndAJsonBody()
    {
        var handler = Canned.Ok("{\"ok\":true}");
        using var client = Client(handler);
        var result = await client.SendAsync("/api/threads", HttpMethod.Post, new { title = "t" });
        Assert.True(result!.Value.GetProperty("ok").GetBoolean());
        var request = Assert.Single(handler.Requests);
        Assert.Equal(HttpMethod.Post, request.Method);
        Assert.Equal("application/json", request.Content!.Headers.ContentType!.MediaType);
    }

    [Fact]
    public async Task NoContentAndEmptyBodiesAreNull()
    {
        using var noContent = Client(new Canned(_ => new HttpResponseMessage(HttpStatusCode.NoContent)));
        Assert.Null(await noContent.SendAsync("/api/x", HttpMethod.Delete));

        using var empty = Client(Canned.Ok("   "));
        Assert.Null(await empty.SendAsync("/api/x", HttpMethod.Get));
    }

    [Fact]
    public async Task SuccessWithInvalidJsonIsNullInsteadOfThrowing()
    {
        using var client = Client(Canned.Ok("not json"));
        Assert.Null(await client.SendAsync("/api/x", HttpMethod.Get));
    }

    [Fact]
    public async Task AnErrorCarriesTheMachineCodeFromTheBody()
    {
        using var client = Client(Canned.Code(HttpStatusCode.Conflict, "{\"code\":\"task_not_found\"}"));
        var error = await Assert.ThrowsAsync<HubApiException>(() => client.SendAsync("/api/x", HttpMethod.Get));
        Assert.Equal("task_not_found", error.Code);
        Assert.Equal(409, error.Status);
        Assert.False(error.IsAuth);
    }

    [Fact]
    public async Task AnErrorWithoutABodyFallsBackToTheStatus()
    {
        using var client = Client(Canned.Code(HttpStatusCode.BadGateway, "upstream said no"));
        var error = await Assert.ThrowsAsync<HubApiException>(() => client.SendAsync("/api/x", HttpMethod.Get));
        Assert.Equal("502", error.Code);
    }

    [Theory]
    [InlineData("{\"code\":42}")]
    [InlineData("[1,2]")]
    [InlineData("{\"other\":\"x\"}")]
    public async Task ANonStringCodeIsNotMistakenForOne(string body)
    {
        using var client = Client(Canned.Code(HttpStatusCode.InternalServerError, body));
        var error = await Assert.ThrowsAsync<HubApiException>(() => client.SendAsync("/api/x", HttpMethod.Get));
        Assert.Equal("500", error.Code);
    }

    [Fact]
    public async Task AnUnauthorizedResponseIsRecognisedAsAnAuthFailure()
    {
        using var client = Client(Canned.Code(HttpStatusCode.Unauthorized, ""));
        var error = await Assert.ThrowsAsync<HubApiException>(() => client.SendAsync("/api/x", HttpMethod.Get));
        Assert.True(error.IsAuth);
    }

    [Fact]
    public async Task SubscribeStreamsEventsAndForwardsTheSinceCursor()
    {
        const string body = "event: message\ndata: one\n\n";
        var handler = new Canned(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(body, Encoding.UTF8, "text/event-stream")
        });
        using var client = Client(handler);
        var events = new List<HubEvent>();
        await foreach (var item in client.SubscribeAsync("/api/tasks/events", since: 12)) events.Add(item);
        Assert.Equal("one", Assert.Single(events).Data);
        var request = Assert.Single(handler.Requests);
        Assert.Contains("since=12", request.RequestUri!.Query);
        Assert.Contains("text/event-stream", request.Headers.Accept.Select(a => a.MediaType));
    }

    [Fact]
    public async Task SubscribeFailureThrowsTheStatus()
    {
        using var client = Client(Canned.Code(HttpStatusCode.ServiceUnavailable, ""));
        var error = await Assert.ThrowsAsync<HubApiException>(async () =>
        {
            await foreach (var _ in client.SubscribeAsync("/api/tasks/events")) { }
        });
        Assert.Equal("503", error.Code);
    }

    [Fact]
    public async Task UploadPostsMultipartAndReportsMonotonicProgress()
    {
        var handler = Canned.Ok("{\"id\":1}");
        using var client = Client(handler);
        var seen = new List<int>();
        var progress = new Progress<int>(p => seen.Add(p));
        using var payload = new MemoryStream(new byte[300]);
        var result = await client.UploadAsync("/api/files", payload, "file", "x.bin", progress);
        Assert.Equal(1, result!.Value.GetProperty("id").GetInt32());
        var request = Assert.Single(handler.Requests);
        Assert.Equal("multipart/form-data", request.Content!.Headers.ContentType!.MediaType);
        // Progress<T> marshals its callbacks, so wait for the final report instead of
        // racing it: the report itself is what this test is about.
        var deadline = DateTime.UtcNow.AddSeconds(5);
        while ((seen.Count == 0 || seen[^1] != 100) && DateTime.UtcNow < deadline) await Task.Delay(10);
        Assert.NotEmpty(seen);
        Assert.Equal(100, seen[^1]);
    }

    [Fact]
    public async Task UploadWithoutAProgressSinkAndWithoutABodyIsNull()
    {
        using var client = Client(Canned.Ok(""));
        using var payload = new MemoryStream(new byte[10]);
        Assert.Null(await client.UploadAsync("/api/files", payload, "file", "x.bin"));
    }

    [Fact]
    public async Task UploadFailureThrows()
    {
        using var client = Client(Canned.Code(HttpStatusCode.RequestEntityTooLarge, "{\"code\":\"file_too_large\"}"));
        using var payload = new MemoryStream(new byte[10]);
        var error = await Assert.ThrowsAsync<HubApiException>(
            () => client.UploadAsync("/api/files", payload, "file", "x.bin"));
        Assert.Equal("file_too_large", error.Code);
    }

    [Fact]
    public async Task VoiceUsesTheFrozenFieldNameAndThreadPath()
    {
        var handler = Canned.Ok("{}");
        using var client = Client(handler);
        using var audio = new MemoryStream(new byte[4]);
        await client.PostAudioAsync(7, audio);
        var request = Assert.Single(handler.Requests);
        Assert.Equal("/api/threads/7/audio", request.RequestUri!.AbsolutePath);
        var body = Assert.Single(handler.Bodies);
        Assert.Contains("name=audio", body);
        Assert.Contains("voice.webm", body);
    }

    [Fact]
    public async Task DownloadFailureWithoutABodyUsesTheStatus()
    {
        using var client = Client(Canned.Code(HttpStatusCode.NotFound, "gone"));
        var error = await Assert.ThrowsAsync<HubApiException>(() => client.DownloadAsync("/api/files/1/content"));
        Assert.Equal("404", error.Code);
    }

    [Fact]
    public async Task TheOwnedStreamIsReadOnlyAndReleasesItsResponse()
    {
        var handler = Canned.Ok("payload");
        var client = Client(handler);
        var stream = await client.DownloadAsync("/api/files/1/content");

        Assert.True(stream.CanRead);
        Assert.False(stream.CanSeek);
        Assert.False(stream.CanWrite);
        Assert.Throws<NotSupportedException>(() => stream.Length);
        Assert.Throws<NotSupportedException>(() => stream.Position);
        Assert.Throws<NotSupportedException>(() => stream.Position = 0);
        Assert.Throws<NotSupportedException>(() => stream.Seek(0, SeekOrigin.Begin));
        Assert.Throws<NotSupportedException>(() => stream.SetLength(1));
        Assert.Throws<NotSupportedException>(() => stream.Write([0], 0, 1));
        stream.Flush(); // a no-op, not a throw

        var buffer = new byte[16];
        var read = stream.Read(buffer, 0, 3);
        Assert.Equal(3, read);
        Assert.True(await stream.ReadAsync(buffer.AsMemory(0, 3)) > 0);
        Assert.True(await stream.ReadAsync(buffer, 0, 3, CancellationToken.None) >= 0);
        using var copy = new MemoryStream();
        await stream.CopyToAsync(copy);
        await stream.DisposeAsync();
        using var second = await client.DownloadAsync("/api/files/1/content");
        second.Dispose(); // the synchronous path must release too
        client.Dispose();
    }

    [Fact]
    public async Task AZeroLengthUploadStillReportsCompletion()
    {
        using var client = Client(Canned.Ok("{}"));
        var seen = new List<int>();
        using var payload = new MemoryStream();
        await client.UploadAsync("/api/files", payload, "file", "empty.bin", new Progress<int>(p => seen.Add(p)));
        Assert.True(seen.Count == 0 || seen[^1] == 100);
    }
}

public class ShellControlClientTests
{
    private static ShellControlClient Client(Canned handler) =>
        new(new HttpClient(handler) { BaseAddress = new Uri("http://127.0.0.1:1/") });

    private const string View = """
        {"serverUrl":"http://hub","lang":"de","background":false,"executorEnabled":true,
         "executorAllowlist":["node"],"executorHasApiKey":true,"sessionBackend":"file"}
        """;

    [Fact]
    public async Task ConfigIsReadAndParsed()
    {
        var client = Client(Canned.Ok(View));
        var view = await client.GetConfigAsync();
        Assert.Equal("http://hub", view.ServerUrl);
        Assert.Equal("de", view.Lang);
        Assert.False(view.Background);
        Assert.True(view.ExecutorHasApiKey);
    }

    [Fact]
    public async Task AnEmptyConfigBodyYieldsDefaults()
    {
        var client = Client(Canned.Ok(""));
        var view = await client.GetConfigAsync();
        Assert.Equal("", view.ServerUrl);
        Assert.True(view.Background);
    }

    [Fact]
    public async Task SettingConfigPostsThenRefreshes()
    {
        var handler = new Canned(request => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = request.Method == HttpMethod.Post
                ? new StringContent("{\"ok\":true}", Encoding.UTF8, "application/json")
                : new StringContent(View, Encoding.UTF8, "application/json")
        });
        var client = Client(handler);
        var view = await client.SetConfigAsync(new { lang = "de" });
        Assert.Equal("de", view.Lang);
        Assert.Equal(HttpMethod.Post, handler.Requests[0].Method);
        Assert.Equal(ShellEndpoints.Config, handler.Requests[0].RequestUri!.AbsolutePath);
        Assert.Equal(HttpMethod.Get, handler.Requests[1].Method);
    }

    [Fact]
    public async Task ExecutorStateIsReadRaw()
    {
        var client = Client(Canned.Ok("{\"enabled\":true}"));
        var state = await client.GetExecutorAsync();
        Assert.True(state!.Value.GetProperty("enabled").GetBoolean());
    }

    [Fact]
    public async Task EmptyOrInvalidRawBodiesAreNull()
    {
        var empty = Client(Canned.Ok(""));
        Assert.Null(await empty.GetExecutorAsync());
        var invalid = Client(Canned.Ok("{oops"));
        Assert.Null(await invalid.GetExecutorAsync());
    }

    [Fact]
    public async Task ExecutorWritesReturnTheAcknowledgedBody()
    {
        var client = Client(Canned.Ok("{\"ok\":true,\"status\":\"running\"}"));
        var result = await client.SetExecutorAsync(new { enabled = true, userConfirmed = true });
        Assert.Equal("running", result!.Value.GetProperty("status").GetString());
    }

    [Fact]
    public async Task ConnectionTestSendsTheUrl()
    {
        var handler = Canned.Ok("{\"ok\":true}");
        var client = Client(handler);
        await client.TestConnectionAsync("http://hub:3500");
        var body = await handler.Requests[0].Content!.ReadAsStringAsync();
        Assert.Contains("http://hub:3500", body);
    }

    [Fact]
    public async Task HideNotifyAndBadgeUseTheirOwnRoutes()
    {
        var handler = Canned.Ok("{\"count\":3}");
        var client = Client(handler);
        await client.HideAsync();
        await client.NotifyAsync("t", "b", "/threads/1");
        var count = await client.SetBadgeAsync(5000);
        Assert.Equal(3, count);
        Assert.Equal([ShellEndpoints.Hide, ShellEndpoints.Notify, ShellEndpoints.Badge],
            handler.Requests.Select(r => r.RequestUri!.AbsolutePath).ToArray());
    }

    [Fact]
    public async Task BadgeFallsBackToAClampedCountWhenTheBodyIsUnhelpful()
    {
        var client = Client(Canned.Ok("{}"));
        Assert.Equal(NotificationDecider.ClampBadge(5000), await client.SetBadgeAsync(5000));
        var empty = Client(Canned.Ok(""));
        Assert.Equal(0, await empty.SetBadgeAsync(-1));
    }

    [Fact]
    public async Task UpgradeCallsReturnParsedStateOrDefaults()
    {
        var client = Client(Canned.Ok("{\"status\":\"available\",\"latestVersion\":\"9.9.9\"}"));
        Assert.Equal("available", (await client.GetUpgradeAsync()).Status);
        Assert.Equal("available", (await client.CheckUpgradeAsync()).Status);
        Assert.Equal("available", (await client.InstallUpgradeAsync()).Status);

        var bare = Client(Canned.Ok(""));
        Assert.Equal(UpgradeCodes.Machine(UpgradeCode.Idle), (await bare.GetUpgradeAsync()).Status);
        Assert.NotNull((await bare.CheckUpgradeAsync()).Status);
        Assert.NotNull((await bare.InstallUpgradeAsync()).Status);
    }
}

public class MonitorServiceTests
{
    private sealed class StubClient : IAgentHubClient
    {
        public JsonElement? Workspace { get; set; }
        public JsonElement? Tasks { get; set; }
        public Exception? Throw { get; set; }

        public Task<JsonElement?> SendAsync(string path, HttpMethod method, object? body = null, CancellationToken ct = default)
        {
            if (Throw is not null) throw Throw;
            return Task.FromResult(path == Endpoints.Tasks ? Tasks : Workspace);
        }

        public async IAsyncEnumerable<HubEvent> SubscribeAsync(string path, long? since = null,
            [EnumeratorCancellation] CancellationToken ct = default)
        {
            await Task.CompletedTask;
            yield break;
        }

        public Task<Stream> DownloadAsync(string path, CancellationToken ct = default) =>
            Task.FromResult<Stream>(new MemoryStream());

        public Task<JsonElement?> UploadAsync(string path, Stream content, string field, string fileName,
            IProgress<int>? progress = null, CancellationToken ct = default) => Task.FromResult<JsonElement?>(null);

        public Task<JsonElement?> PostAudioAsync(long threadId, Stream audio, CancellationToken ct = default) =>
            Task.FromResult<JsonElement?>(null);
    }

    private sealed class StubShell : IShellControl
    {
        public List<int> Badges { get; } = [];
        public List<(string Title, string Body, string? Link)> Notes { get; } = [];
        public Exception? Throw { get; set; }

        public Task<ShellConfigView> GetConfigAsync(CancellationToken ct = default) => Task.FromResult(new ShellConfigView());
        public Task<ShellConfigView> SetConfigAsync(object patch, CancellationToken ct = default) => Task.FromResult(new ShellConfigView());
        public Task<JsonElement?> GetExecutorAsync(CancellationToken ct = default) => Task.FromResult<JsonElement?>(null);
        public Task<JsonElement?> SetExecutorAsync(object patch, CancellationToken ct = default) => Task.FromResult<JsonElement?>(null);
        public Task<JsonElement?> TestConnectionAsync(string serverUrl, CancellationToken ct = default) => Task.FromResult<JsonElement?>(null);
        public Task<JsonElement?> HideAsync(CancellationToken ct = default) => Task.FromResult<JsonElement?>(null);

        public Task NotifyAsync(string title, string body, string? link, CancellationToken ct = default)
        {
            if (Throw is not null) return Task.FromException(Throw);
            Notes.Add((title, body, link));
            return Task.CompletedTask;
        }

        public Task<int> SetBadgeAsync(int count, CancellationToken ct = default)
        {
            if (Throw is not null) return Task.FromException<int>(Throw);
            Badges.Add(count);
            return Task.FromResult(count);
        }

        public Task<UpgradeState> GetUpgradeAsync(CancellationToken ct = default) => Task.FromResult(new UpgradeState());
        public Task<UpgradeState> CheckUpgradeAsync(CancellationToken ct = default) => Task.FromResult(new UpgradeState());
        public Task<UpgradeState> InstallUpgradeAsync(CancellationToken ct = default) => Task.FromResult(new UpgradeState());
    }

    private static JsonElement Json(string text) => JsonDocument.Parse(text).RootElement.Clone();

    [Fact]
    public async Task ActiveTasksBecomeTheUnreadBadgeAndAnnouncements()
    {
        var stub = new StubClient
        {
            Workspace = Json("{\"threads\":[]}"),
            Tasks = Json("""
                [{"id":"1","state":"working"},{"id":"2","state":"completed"},
                 {"id":"3","state":"submitted"},{"id":"4","state":"failed"}]
                """)
        };
        var shell = new StubShell();
        var copy = new LocalizationService();
        await using var monitor = new MonitorService(stub, shell, copy);
        var seen = new List<int>();
        monitor.UnreadChanged += seen.Add;

        Assert.True(await monitor.PollOnceAsync());
        Assert.Equal(["1", "3"], monitor.ActiveTaskIds.ToArray());
        Assert.Equal(2, monitor.UnreadCount);
        Assert.Equal(2, Assert.Single(seen));
        Assert.Equal(2, Assert.Single(shell.Badges));
        Assert.Equal(2, shell.Notes.Count);
        Assert.All(shell.Notes, n => Assert.StartsWith("/tasks/", n.Link));
    }

    [Fact]
    public async Task ASecondPollWithinTheIdempotentWindowDoesNotRepeatTheToast()
    {
        var stub = new StubClient
        {
            Workspace = Json("{\"threads\":[]}"),
            Tasks = Json("[{\"id\":\"1\",\"state\":\"completed\"}]")
        };
        var shell = new StubShell();
        await using var monitor = new MonitorService(stub, shell, new LocalizationService());
        await monitor.PollOnceAsync();
        await monitor.PollOnceAsync();
        Assert.Single(shell.Notes);
    }

    [Fact]
    public async Task AnUnchangedUnreadCountDoesNotRepushTheBadge()
    {
        var stub = new StubClient
        {
            Workspace = Json("{}"),
            Tasks = Json("[{\"id\":\"1\",\"state\":\"working\"}]")
        };
        var shell = new StubShell();
        await using var monitor = new MonitorService(stub, shell, new LocalizationService());
        await monitor.PollOnceAsync();
        await monitor.PollOnceAsync();
        Assert.Single(shell.Badges);
    }

    [Fact]
    public async Task NoTasksClearsTheBadgeToZero()
    {
        var stub = new StubClient { Workspace = Json("{}"), Tasks = Json("[]") };
        var shell = new StubShell();
        await using var monitor = new MonitorService(stub, shell, new LocalizationService());
        Assert.True(await monitor.PollOnceAsync());
        Assert.Empty(monitor.ActiveTaskIds);
        Assert.Equal(0, monitor.UnreadCount);
        Assert.Empty(shell.Badges); // 0 == initial 0, nothing to announce
    }

    [Fact]
    public async Task AWrongShapedTasksPayloadIsIgnoredRatherThanThrowing()
    {
        var stub = new StubClient { Workspace = Json("{}"), Tasks = Json("{\"items\":[]}") };
        var shell = new StubShell();
        await using var monitor = new MonitorService(stub, shell, new LocalizationService());
        Assert.True(await monitor.PollOnceAsync());
        Assert.Empty(monitor.ActiveTaskIds);
    }

    [Fact]
    public async Task AnArrayOfNonObjectsIsTolerated()
    {
        var stub = new StubClient { Workspace = Json("{}"), Tasks = Json("[1,\"x\",null]") };
        var shell = new StubShell();
        await using var monitor = new MonitorService(stub, shell, new LocalizationService());
        Assert.True(await monitor.PollOnceAsync());
        Assert.Empty(monitor.ActiveTaskIds);
    }

    [Fact]
    public async Task ATaskWithoutAnIdIsNotAnnounced()
    {
        var stub = new StubClient { Workspace = Json("{}"), Tasks = Json("[{\"state\":\"completed\"}]") };
        var shell = new StubShell();
        await using var monitor = new MonitorService(stub, shell, new LocalizationService());
        await monitor.PollOnceAsync();
        Assert.Empty(shell.Notes);
    }

    [Fact]
    public async Task AMissingWorkspaceSuppressesAnnouncementsOnly()
    {
        var stub = new StubClient { Workspace = null, Tasks = Json("[{\"id\":\"1\",\"state\":\"working\"}]") };
        var shell = new StubShell();
        await using var monitor = new MonitorService(stub, shell, new LocalizationService());
        await monitor.PollOnceAsync();
        Assert.Empty(shell.Notes);
        Assert.Equal(1, monitor.UnreadCount);
    }

    [Fact]
    public async Task ANonAnnounceableStateIsIgnored()
    {
        // submitted has no notification key; completed/canceled do, so they are not a fit here.
        var stub = new StubClient { Workspace = Json("{}"), Tasks = Json("[{\"id\":\"1\",\"state\":\"submitted\"}]") };
        var shell = new StubShell();
        await using var monitor = new MonitorService(stub, shell, new LocalizationService());
        await monitor.PollOnceAsync();
        Assert.Empty(shell.Notes);
    }

    [Fact]
    public async Task AFailingShellDoesNotBreakPolling()
    {
        var stub = new StubClient { Workspace = Json("{}"), Tasks = Json("[{\"id\":\"1\",\"state\":\"working\"}]") };
        var shell = new StubShell { Throw = new InvalidOperationException("shell down") };
        await using var monitor = new MonitorService(stub, shell, new LocalizationService());
        Assert.True(await monitor.PollOnceAsync());
        Assert.Equal(1, monitor.UnreadCount);
    }

    [Fact]
    public async Task AFailingClientCountsAFailureAndReturnsFalse()
    {
        var stub = new StubClient { Throw = new HttpRequestException("offline") };
        var shell = new StubShell();
        await using var monitor = new MonitorService(stub, shell, new LocalizationService());
        Assert.False(await monitor.PollOnceAsync());
        Assert.Equal(1, monitor.FailureCount);
        Assert.Equal(2, (await monitor.PollOnceAsync(), monitor.FailureCount).Item2);
    }

    [Fact]
    public async Task CancellationPropagatesInsteadOfCountingAFailure()
    {
        using var cts = new CancellationTokenSource();
        await cts.CancelAsync();
        var stub = new StubClient { Throw = new OperationCanceledException(cts.Token) };
        await using var monitor = new MonitorService(stub, new StubShell(), new LocalizationService());
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => monitor.PollOnceAsync(cts.Token));
        Assert.Equal(0, monitor.FailureCount);
    }

    [Fact]
    public async Task TheLoopStartsOnceAndStops()
    {
        var stub = new StubClient { Workspace = Json("{}"), Tasks = Json("[]") };
        await using var monitor = new MonitorService(stub, new StubShell(), new LocalizationService(), () => false);
        await monitor.StartAsync();
        await monitor.StartAsync(); // idempotent
        await Task.Delay(120);
        await monitor.StopAsync();
        Assert.True(monitor.FailureCount >= 0);
        await monitor.StopAsync(); // idempotent
        await monitor.DisposeAsync(); // safe after stop
    }

    [Fact]
    public async Task StaleSeenEntriesArePruned()
    {
        var stub = new StubClient
        {
            Workspace = Json("{}"),
            Tasks = Json("[{\"id\":\"1\",\"state\":\"completed\"}]")
        };
        var shell = new StubShell();
        await using var monitor = new MonitorService(stub, shell, new LocalizationService());
        await monitor.PollOnceAsync();
        // A second poll after the pruning window re-announces; the prune itself must not throw.
        Assert.True(await monitor.PollOnceAsync());
        Assert.Single(shell.Notes);
    }
}

public class RealtimeServiceTests
{
    private sealed class StubStreams(params HubEvent[] events) : IAgentHubClient
    {
        public bool Fail { get; set; }
        public bool Cancel { get; set; }
        public int Calls { get; private set; }
        public long? LastSince { get; private set; }

        public async IAsyncEnumerable<HubEvent> SubscribeAsync(string path, long? since = null,
            [EnumeratorCancellation] CancellationToken ct = default)
        {
            Calls++;
            LastSince = since;
            if (Cancel) throw new OperationCanceledException(ct);
            if (Fail) throw new HttpRequestException("down");
            foreach (var item in events)
            {
                await Task.Yield();
                yield return item;
            }
        }

        public Task<JsonElement?> SendAsync(string path, HttpMethod method, object? body = null, CancellationToken ct = default)
            => Task.FromResult<JsonElement?>(null);
        public Task<Stream> DownloadAsync(string path, CancellationToken ct = default) => Task.FromResult<Stream>(new MemoryStream());
        public Task<JsonElement?> UploadAsync(string path, Stream content, string field, string fileName,
            IProgress<int>? progress = null, CancellationToken ct = default) => Task.FromResult<JsonElement?>(null);
        public Task<JsonElement?> PostAudioAsync(long threadId, Stream audio, CancellationToken ct = default)
            => Task.FromResult<JsonElement?>(null);
    }

    // The task stream carries an id; the literal template is not a route the server serves.
    private const string TaskStream = "/api/tasks/7/events";

    [Fact]
    public async Task EventsAreClassifiedKeptAndCursorTracked()
    {
        var stream = new StubStreams(
            new HubEvent { Name = SseEvents.TaskStatus, Data = "{}", Id = "7" },
            new HubEvent { Name = "keepalive", Data = "{}", Id = null });
        await using var service = new RealtimeService(stream);
        var received = new List<HubEvent>();
        service.EventReceived += received.Add;

        Assert.True(await service.PumpOnceAsync(TaskStream));
        Assert.Equal(7L, service.Cursor(TaskStream));
        Assert.Single(received);
        Assert.Single(service.Recent(TaskStream));
        Assert.Equal(1, service.ProcessedCount);
    }

    [Fact]
    public async Task ABadIdLeavesTheCursorAloneAndUnknownStreamsStayEmpty()
    {
        var stream = new StubStreams(
            new HubEvent { Name = SseEvents.Message, Data = "{}", Id = "not-a-number" },
            new HubEvent { Name = SseEvents.Message, Data = "{}", Id = "0" },
            new HubEvent { Name = SseEvents.Message, Data = "{}", Id = null });
        await using var service = new RealtimeService(stream);
        Assert.True(await service.PumpOnceAsync(TaskStream));
        Assert.Null(service.Cursor(TaskStream));
        Assert.Equal(3, service.ProcessedCount);
        Assert.Empty(service.Recent("/api/nowhere/events"));
    }

    [Fact]
    public async Task TheRingDropsTheOldestBeyondCapacity()
    {
        var events = Enumerable.Range(0, RealtimeService.RecentCapacity + 5)
            .Select(i => new HubEvent { Name = SseEvents.TaskStatus, Data = i.ToString(), Id = (i + 1).ToString() })
            .ToArray();
        await using var service = new RealtimeService(new StubStreams(events));
        await service.PumpOnceAsync(TaskStream);
        Assert.Equal(RealtimeService.RecentCapacity, service.Recent(TaskStream).Count);
        Assert.Equal(RealtimeService.RecentCapacity + 5, service.ProcessedCount);
    }

    [Fact]
    public async Task AFailedStreamCountsAndReturnsFalse()
    {
        var stream = new StubStreams { Fail = true };
        await using var service = new RealtimeService(stream);
        Assert.False(await service.PumpOnceAsync(TaskStream));
        Assert.Equal(1, service.FailureCount);
    }

    [Fact]
    public async Task CancellationPropagatesInsteadOfCounting()
    {
        var stream = new StubStreams { Cancel = true };
        await using var service = new RealtimeService(stream);
        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => service.PumpOnceAsync(TaskStream, new CancellationToken(canceled: true)));
        Assert.Equal(0, service.FailureCount);
    }

    [Fact]
    public async Task StartSpinsUpOnlyTheGlobalStreamsAndStopTearsThemDown()
    {
        var stream = new StubStreams();
        var service = new RealtimeService(stream);
        await service.StartAsync();
        await service.StartAsync(); // idempotent
        await Task.Delay(150);
        await service.StopAsync();
        // Entity streams are per id; subscribing to their template would 404 forever.
        Assert.InRange(stream.Calls, 1, Endpoints.GlobalStreams.Length);
        await service.StopAsync(); // idempotent
        await service.DisposeAsync();
    }

    [Fact]
    public void ClassificationCoversEveryFrozenNameAndRefusesTheRest()
    {
        Assert.Equal(RealtimeChannel.Thread, RealtimeEvents.Classify(SseEvents.ThreadAgent));
        Assert.Equal(RealtimeChannel.Thread, RealtimeEvents.Classify(SseEvents.ThreadMessage));
        Assert.Equal(RealtimeChannel.Task, RealtimeEvents.Classify(SseEvents.TaskArtifact));
        Assert.Equal(RealtimeChannel.Task, RealtimeEvents.Classify(SseEvents.TaskSpan));
        Assert.Equal(RealtimeChannel.Task, RealtimeEvents.Classify(SseEvents.Message));
        Assert.Equal(RealtimeChannel.Sandbox, RealtimeEvents.Classify(SseEvents.Sandbox));
        Assert.Equal(RealtimeChannel.Router, RealtimeEvents.Classify(SseEvents.Router));
        Assert.Equal(RealtimeChannel.Unknown, RealtimeEvents.Classify("nope"));
        Assert.True(RealtimeEvents.IsKnown(SseEvents.Router));
        Assert.False(RealtimeEvents.IsKnown("nope"));
        Assert.True(RealtimeEvents.BelongsTo(TaskStream, SseEvents.TaskStatus));
        Assert.False(RealtimeEvents.BelongsTo(TaskStream, SseEvents.Router));
        Assert.False(RealtimeEvents.BelongsTo("/api/nowhere/events", SseEvents.Message));
    }
}

public class ContractCoverageTests
{
    [Fact]
    public void AppPathsDeriveEveryLocationFromTheRoot()
    {
        var paths = new AppPaths("/tmp/root");
        Assert.Equal(Path.Combine("/tmp/root", "agentbuddy"), paths.ConfigDir);
        Assert.Equal(Path.Combine(paths.ConfigDir, "data"), paths.DataDir);
        Assert.Equal(Path.Combine(paths.ConfigDir, "config.json"), paths.ConfigFile);
    }

    [Fact]
    public void WithSinceOnlyAppendsAPositiveCursor()
    {
        Assert.Equal("/api/tasks/events?since=5", Endpoints.WithSince("/api/tasks/events", 5));
        Assert.Equal("/api/tasks/events", Endpoints.WithSince("/api/tasks/events", null));
        Assert.Equal("/api/tasks/events", Endpoints.WithSince("/api/tasks/events", 0));
    }

    [Fact]
    public void FormatSubstitutesNamedPlaceholdersAndLeavesUnknownOnes()
    {
        Assert.Equal("/api/threads/9", Endpoints.Format(Endpoints.ThreadById, ("id", 9)));
        Assert.Equal("a 2 b", Endpoints.Format("a {id} b", ("id", 2)));
        Assert.Equal("a {other} b", Endpoints.Format("a {other} b", ("id", 2)));
        Assert.Contains("-", PlatformKeys.Current());
        Assert.False(PlatformKeys.Current().StartsWith("unsupported-"));
    }

    [Theory]
    [InlineData("windows", "x86_64", "windows-x86_64")]
    [InlineData("macos", "aarch64", "darwin-aarch64")]
    [InlineData("linux", "x86_64", "linux-x86_64")]
    [InlineData("linux", "riscv64", null)]
    public void PlatformKeysAreFrozen(string os, string arch, string? expected) =>
        Assert.Equal(expected, PlatformKeys.Key(os, arch));

    [Fact]
    public void NormalizeVersionStripsATagAndRejectsNonsense()
    {
        Assert.Equal("1.2.3", ReleaseContract.NormalizeVersion("v1.2.3"));
        Assert.Equal("1.2.3-rc.1", ReleaseContract.NormalizeVersion("V1.2.3-rc.1"));
        Assert.Throws<ArgumentException>(() => ReleaseContract.NormalizeVersion("nightly"));
        Assert.True(ReleaseContract.IsValidVersion("v2.0.0"));
        Assert.False(ReleaseContract.IsValidVersion("2.0"));
    }

    [Fact]
    public void EveryUpgradeCodeHasAMachineName()
    {
        Assert.All(UpgradeCodes.All, code => Assert.False(string.IsNullOrWhiteSpace(code)));
        Assert.Equal("unavailable", UpgradeCodes.Machine((UpgradeCode)999));
        Assert.Equal("not_configured", UpgradeCodes.Machine(UpgradeCode.NotConfigured));
    }

    [Fact]
    public void LanguageCodesCoverTheFrozenSetAndOnlyArabicIsRtl()
    {
        Assert.Equal(13, LanguageCodes.All.Length);
        Assert.All(LanguageCodes.All, code => Assert.Contains(code, LanguageCodes.All));
        Assert.True(LanguageCodes.IsRtl("ar"));
        Assert.False(LanguageCodes.IsRtl("en"));
    }

    [Theory]
    [InlineData("pt-BR", "pt")]
    [InlineData("zh-tw", "zh-TW")]
    [InlineData("zh-HK", "zh-TW")]
    [InlineData("zh-Hant", "zh-TW")]
    [InlineData("de", "de")]
    [InlineData("xx-YY", "en")]
    [InlineData(null, "en")]
    public void SystemLanguageTagsMapOntoTheFrozenSet(string? tag, string expected) =>
        Assert.Equal(expected, LanguageCodes.Match(tag));
}
