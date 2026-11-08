using System.Net;
using System.Net.Http.Json;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using AgentBuddy.Core.Contracts;
using AgentBuddy.Core.Gateway;
using AgentBuddy.Core.Services;
using Xunit;

namespace AgentBuddy.Core.Tests;

/// <summary>
/// The remaining Core branches: bounded streams and their ownership, a non-JSON
/// success body, the shell control constructor, the atomic config write's cleanup
/// path, and the poller's cancellation/pruning edges.
/// </summary>
public class GatewaySurfaceTests
{
    private sealed class Handler(Func<HttpRequestMessage, HttpResponseMessage> factory) : HttpMessageHandler
    {
        public List<HttpRequestMessage> Seen { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Seen.Add(request);
            if (request.Content is not null) await request.Content.ReadAsByteArrayAsync(ct);
            return factory(request);
        }
    }

    private static AgentHubClient Client(Handler handler) =>
        new(new HttpClient(handler) { BaseAddress = new Uri("http://127.0.0.1:1/") });

    [Fact]
    public void EveryProcessArchitectureHasAReleaseSpelling()
    {
        Assert.Equal("x86_64", PlatformKeys.ArchName(System.Runtime.InteropServices.Architecture.X64));
        Assert.Equal("aarch64", PlatformKeys.ArchName(System.Runtime.InteropServices.Architecture.Arm64));
        Assert.Equal("x86", PlatformKeys.ArchName(System.Runtime.InteropServices.Architecture.X86));
        Assert.Equal("arm", PlatformKeys.ArchName(System.Runtime.InteropServices.Architecture.Arm));
        Assert.Equal("unknown", PlatformKeys.ArchName(System.Runtime.InteropServices.Architecture.Wasm));
        Assert.Contains("-", PlatformKeys.Current());
        Assert.Null(PlatformKeys.Key("plan9", "x86_64"));
        Assert.Null(PlatformKeys.Key("linux", "mips"));
    }

    [Fact]
    public async Task UploadWithANonJsonSuccessBodyReturnsNull()
    {
        using var client = Client(new Handler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent("<html>not json</html>", Encoding.UTF8, "text/html")
        }));
        using var payload = new MemoryStream([1, 2, 3, 4]);
        Assert.Null(await client.UploadAsync("/api/files", payload, "file", "clip.bin"));
    }

    [Fact]
    public async Task AFailedUploadSurfacesTheMachineCodeRatherThanAStatusCode()
    {
        using var client = Client(new Handler(_ => new HttpResponseMessage(HttpStatusCode.RequestEntityTooLarge)
        {
            Content = new StringContent("{\"code\":\"payload_too_large\"}", Encoding.UTF8, "application/json")
        }));
        using var payload = new MemoryStream([1, 2, 3, 4]);
        var error = await Assert.ThrowsAsync<HubApiException>(() =>
            client.UploadAsync("/api/files", payload, "file", "clip.bin"));
        Assert.Equal("payload_too_large", error.Code);
        Assert.Equal(413, error.Status);
    }

    [Fact]
    public async Task ABareDataLineCarriesAnEmptyPayloadAndNeverFiresAnEvent()
    {
        // "data" with no colon is a legal field line; its value is empty, and an
        // event whose data is empty must not be dispatched.
        await using var stream = new MemoryStream(Encoding.UTF8.GetBytes("data\n\n"));
        var events = new List<HubEvent>();
        await foreach (var item in SseParser.ParseAsync(stream)) events.Add(item);
        Assert.Empty(events);
    }

    [Fact]
    public async Task AnOversizedEventAndAnOversizedLineAreDroppedWithoutLosingFraming()
    {
        // Three data lines past the event cap: the event is dropped whole, not truncated.
        var chunk = new string('x', 512 * 1024);
        var eventOverflow = $"data: {chunk}\ndata: {chunk}\ndata: {chunk}\n\n";
        // One line past the line cap: it spans several reads and is dropped whole.
        var lineOverflow = "data: " + new string('y', Limits.MaxEventBytes + 1024) + "\n\n";
        var payload = eventOverflow + lineOverflow + "event: task_status_update\ndata: after\n\n";

        await using var stream = new MemoryStream(Encoding.UTF8.GetBytes(payload));
        var events = new List<HubEvent>();
        await foreach (var item in SseParser.ParseAsync(stream)) events.Add(item);

        var only = Assert.Single(events);
        Assert.Equal("task_status_update", only.Name);
        Assert.Equal("after", only.Data);
    }

    [Fact]
    public void ProgressStreamReportsEachPercentageOnceAndRefusesMutation()
    {
        var reported = new List<int>();
        using var inner = new MemoryStream(new byte[8]);
        var tracked = new ProgressStream(inner, 4, new Collecting(reported));

        var buffer = new byte[4];
        Assert.Equal(4, tracked.Read(buffer, 0, 4));      // 100% once
        Assert.Equal(4, tracked.Read(buffer, 0, 4));      // still 100%: de-duplicated
        Assert.Equal(new[] { 100 }, reported);

        Assert.True(tracked.CanRead);
        Assert.False(tracked.CanSeek);
        Assert.False(tracked.CanWrite);
        Assert.Equal(4, tracked.Length);
        tracked.Flush();
        Assert.Throws<NotSupportedException>(() => tracked.Position = 1);
        Assert.Throws<NotSupportedException>(() => tracked.Seek(0, SeekOrigin.Begin));
        Assert.Throws<NotSupportedException>(() => tracked.SetLength(1));
        Assert.Throws<NotSupportedException>(() => tracked.Write([0], 0, 1));

        // A zero-length source is reported as complete; no sink and no bytes are silent.
        using var empty = new MemoryStream([]);
        var zero = new ProgressStream(empty, 0, new Collecting(reported));
        Assert.Equal(0, zero.Read(buffer, 0, buffer.Length));
        Assert.Equal(0, zero.Position);
        var silent = new ProgressStream(new MemoryStream(new byte[2]), 2, null);
        Assert.Equal(2, silent.Read(buffer, 0, 2));
    }

    [Fact]
    public async Task OwnedStreamIsReadOnlyAndDisposesItsOwners()
    {
        var response = new HttpResponseMessage(HttpStatusCode.OK);
        var request = new HttpRequestMessage(HttpMethod.Get, "/api/files/1/content");
        var owned = new OwnedStream(new MemoryStream(Encoding.UTF8.GetBytes("payload")), response, request);

        Assert.True(owned.CanRead);
        Assert.False(owned.CanSeek);
        Assert.False(owned.CanWrite);
        Assert.Throws<NotSupportedException>(() => owned.Length);
        Assert.Throws<NotSupportedException>(() => owned.Position);
        Assert.Throws<NotSupportedException>(() => owned.Position = 0);
        Assert.Throws<NotSupportedException>(() => owned.Seek(0, SeekOrigin.Begin));
        Assert.Throws<NotSupportedException>(() => owned.SetLength(1));
        Assert.Throws<NotSupportedException>(() => owned.Write([0], 0, 1));
        owned.Flush();

        var buffer = new byte[7];
        Assert.Equal(7, owned.Read(buffer, 0, 7));
        Assert.Equal("payload", Encoding.UTF8.GetString(buffer));

        using var copy = new MemoryStream();
        var second = new OwnedStream(new MemoryStream(Encoding.UTF8.GetBytes("again")), new HttpResponseMessage(), new HttpRequestMessage());
        await second.CopyToAsync(copy);
        Assert.Equal("again", Encoding.UTF8.GetString(copy.ToArray()));

        await owned.DisposeAsync();
        Assert.Throws<ObjectDisposedException>(() => owned.Read(buffer, 0, 1)); // the inner stream is gone
        await second.DisposeAsync();
    }

    private sealed class Collecting(List<int> seen) : IProgress<int>
    {
        public void Report(int value) => seen.Add(value);
    }
}

public class ShellControlSurfaceTests
{
    private sealed class Handler(Func<HttpRequestMessage, HttpResponseMessage> factory) : HttpMessageHandler
    {
        public List<HttpRequestMessage> Seen { get; } = [];

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Seen.Add(request);
            return Task.FromResult(factory(request));
        }
    }

    [Fact]
    public async Task TheBearerConstructorIsUsedAndNonJsonBodiesReadAsNull()
    {
        var handler = new Handler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent("not json", Encoding.UTF8, "text/plain")
        });
        var control = new ShellControlClient(new HttpClient(handler) { BaseAddress = new Uri("http://127.0.0.1:1/") });
        Assert.Null(await control.SetExecutorAsync(new { enabled = false }));

        // The real constructor takes the gateway origin and mirrors the bearer token.
        var seen = new TaskCompletionSource<string?>();
        using var listener = new System.Net.Sockets.TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        _ = Task.Run(async () =>
        {
            using var socket = await listener.AcceptTcpClientAsync();
            await using var stream = socket.GetStream();
            var buffer = new byte[4096];
            var read = await stream.ReadAsync(buffer);
            var text = Encoding.ASCII.GetString(buffer, 0, read);
            seen.TrySetResult(text.Split("\r\n").FirstOrDefault(l =>
                l.StartsWith("Authorization:", StringComparison.OrdinalIgnoreCase)));
            var body = Encoding.ASCII.GetBytes(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}");
            await stream.WriteAsync(body);
        });
        var live = new ShellControlClient(new Uri($"http://127.0.0.1:{port}/"), "tok");
        await live.GetConfigAsync();
        Assert.Equal("Authorization: Bearer tok", await seen.Task.WaitAsync(TimeSpan.FromSeconds(10)));
    }

    [Fact]
    public async Task BadgeFallsBackToTheLocalClampWhenTheBodyHasNoCount()
    {
        var handler = new Handler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent("{}", Encoding.UTF8, "application/json")
        });
        var control = new ShellControlClient(new HttpClient(handler) { BaseAddress = new Uri("http://127.0.0.1:1/") });
        Assert.Equal(Limits.MaxBadge, await control.SetBadgeAsync(5000));
    }
}

public class ConfigWriteSurfaceTests
{
    [Fact]
    public void AFailedRenameCleansUpTheTempFileAndRethrows()
    {
        var root = Path.Combine(Path.GetTempPath(), "ab-" + Guid.NewGuid().ToString("N"));
        try
        {
            var paths = new AppPaths(root);
            Directory.CreateDirectory(paths.ConfigDir);
            // A directory where the file belongs makes File.Move fail after the write.
            Directory.CreateDirectory(paths.ConfigFile);
            Assert.ThrowsAny<Exception>(() => ConfigService.WritePrivateFile(paths.ConfigFile, "{}"));
            Assert.Empty(Directory.GetFiles(paths.ConfigDir, ".*.tmp"));
        }
        finally { if (Directory.Exists(root)) Directory.Delete(root, true); }
    }

    [Fact]
    public void AnUnknownLanguageFallsBackToEnglish()
    {
        var copy = new LocalizationService();
        Assert.Equal(copy.Get("en", "nav.workspace"), copy.Get("zz", "nav.workspace"));
        Assert.Equal("en", copy.Lang);
    }
}

public class PollerEdgeTests
{
    [Fact]
    public async Task StopSwallowsACancelledPollAndTheDelayExitsOnCancel()
    {
        await using var stuck = new MonitorService(new BlockingClient(), new RecordingShell(), new LocalizationService());
        await stuck.StartAsync();
        await Task.Delay(50);
        await stuck.StopAsync(); // the loop was cancelled inside a poll
        Assert.Equal(0, stuck.FailureCount);

        await using var fast = new MonitorService(new FailingClient(), new RecordingShell(), new LocalizationService());
        await fast.StartAsync();
        await Task.Delay(50);
        await fast.StopAsync(); // the loop was cancelled inside the backoff delay
        Assert.True(fast.FailureCount >= 1);
    }

    [Fact]
    public async Task SeenEntriesForVanishedTasksArePruned()
    {
        var client = new MutableClient();
        await using var monitor = new MonitorService(client, new RecordingShell(), new LocalizationService());
        client.Tasks = Json("""[{"id":"t1","state":"completed"}]""");
        await monitor.PollOnceAsync();

        var seen = (Dictionary<string, DateTimeOffset>)typeof(MonitorService)
            .GetField("_seen", BindingFlags.NonPublic | BindingFlags.Instance)!.GetValue(monitor)!;
        Assert.Contains("t1:completed", seen.Keys);
        seen["t1:completed"] = DateTimeOffset.UtcNow.AddHours(-2);
        client.Tasks = Json("[]");
        Assert.True(await monitor.PollOnceAsync());
        Assert.Empty(seen);
    }

    [Fact]
    public async Task AMalformedTaskListNeverFailsThePoll()
    {
        var client = new MutableClient();
        await using var monitor = new MonitorService(client, new RecordingShell(), new LocalizationService());

        // No task payload at all: nothing to count, but the poll still succeeds.
        Assert.True(await monitor.PollOnceAsync());
        Assert.Empty(monitor.ActiveTaskIds);

        // A missing or null state is not a working task, and neither throws.
        client.Tasks = Json("""[{"id":"1"},{"id":"2","state":null},{"id":"3","state":"working"}]""");
        Assert.True(await monitor.PollOnceAsync());
        Assert.Equal(new[] { "3" }, monitor.ActiveTaskIds.ToArray());
        Assert.Equal(1, monitor.UnreadCount);
    }

    private static JsonElement Json(string json) => JsonDocument.Parse(json).RootElement.Clone();

    private sealed class BlockingClient : IAgentHubClient
    {
        public async Task<JsonElement?> SendAsync(string path, HttpMethod method, object? body = null, CancellationToken ct = default)
        {
            await Task.Delay(Timeout.Infinite, ct);
            return null;
        }
        public IAsyncEnumerable<HubEvent> SubscribeAsync(string path, long? since = null, CancellationToken ct = default)
            => Empty();
        private static async IAsyncEnumerable<HubEvent> Empty()
        {
            await Task.Yield();
            yield break;
        }
        public Task<Stream> DownloadAsync(string path, CancellationToken ct = default) => Task.FromResult<Stream>(new MemoryStream());
        public Task<JsonElement?> UploadAsync(string path, Stream content, string field, string fileName,
            IProgress<int>? progress = null, CancellationToken ct = default) => Task.FromResult<JsonElement?>(null);
        public Task<JsonElement?> PostAudioAsync(long threadId, Stream audio, CancellationToken ct = default)
            => Task.FromResult<JsonElement?>(null);
    }

    private sealed class FailingClient : IAgentHubClient
    {
        public Task<JsonElement?> SendAsync(string path, HttpMethod method, object? body = null, CancellationToken ct = default)
            => throw new HubApiException(ErrorCodes.NetworkError);
        public IAsyncEnumerable<HubEvent> SubscribeAsync(string path, long? since = null, CancellationToken ct = default)
            => new BlockingClient().SubscribeAsync(path, since, ct);
        public Task<Stream> DownloadAsync(string path, CancellationToken ct = default) => Task.FromResult<Stream>(new MemoryStream());
        public Task<JsonElement?> UploadAsync(string path, Stream content, string field, string fileName,
            IProgress<int>? progress = null, CancellationToken ct = default) => Task.FromResult<JsonElement?>(null);
        public Task<JsonElement?> PostAudioAsync(long threadId, Stream audio, CancellationToken ct = default)
            => Task.FromResult<JsonElement?>(null);
    }

    private sealed class MutableClient : IAgentHubClient
    {
        public JsonElement? Tasks { get; set; }
        public Task<JsonElement?> SendAsync(string path, HttpMethod method, object? body = null, CancellationToken ct = default) =>
            Task.FromResult(path == Endpoints.Tasks ? Tasks : JsonDocument.Parse("{}").RootElement.Clone());
        public IAsyncEnumerable<HubEvent> SubscribeAsync(string path, long? since = null, CancellationToken ct = default)
            => new BlockingClient().SubscribeAsync(path, since, ct);
        public Task<Stream> DownloadAsync(string path, CancellationToken ct = default) => Task.FromResult<Stream>(new MemoryStream());
        public Task<JsonElement?> UploadAsync(string path, Stream content, string field, string fileName,
            IProgress<int>? progress = null, CancellationToken ct = default) => Task.FromResult<JsonElement?>(null);
        public Task<JsonElement?> PostAudioAsync(long threadId, Stream audio, CancellationToken ct = default)
            => Task.FromResult<JsonElement?>(null);
    }

    private sealed class RecordingShell : IShellControl
    {
        public Task<ShellConfigView> GetConfigAsync(CancellationToken ct = default) => Task.FromResult(new ShellConfigView());
        public Task<ShellConfigView> SetConfigAsync(object patch, CancellationToken ct = default) => GetConfigAsync(ct);
        public Task<JsonElement?> GetExecutorAsync(CancellationToken ct = default) => Task.FromResult<JsonElement?>(null);
        public Task<JsonElement?> SetExecutorAsync(object patch, CancellationToken ct = default) => Task.FromResult<JsonElement?>(null);
        public Task<JsonElement?> TestConnectionAsync(string serverUrl, CancellationToken ct = default) => Task.FromResult<JsonElement?>(null);
        public Task<JsonElement?> HideAsync(CancellationToken ct = default) => Task.FromResult<JsonElement?>(null);
        public Task NotifyAsync(string title, string body, string? link, CancellationToken ct = default) => Task.CompletedTask;
        public Task<int> SetBadgeAsync(int count, CancellationToken ct = default) => Task.FromResult(count);
        public Task<UpgradeState> GetUpgradeAsync(CancellationToken ct = default) => Task.FromResult(new UpgradeState());
        public Task<UpgradeState> CheckUpgradeAsync(CancellationToken ct = default) => Task.FromResult(new UpgradeState());
        public Task<UpgradeState> InstallUpgradeAsync(CancellationToken ct = default) => Task.FromResult(new UpgradeState());
    }
}

public class RealtimeShutdownTests
{
    private sealed class CancellingClient : IAgentHubClient
    {
        public async IAsyncEnumerable<HubEvent> SubscribeAsync(string path, long? since = null,
            [EnumeratorCancellation] CancellationToken ct = default)
        {
            await Task.Delay(Timeout.Infinite, ct);
            yield break;
        }
        public Task<JsonElement?> SendAsync(string path, HttpMethod method, object? body = null, CancellationToken ct = default)
            => Task.FromResult<JsonElement?>(null);
        public Task<Stream> DownloadAsync(string path, CancellationToken ct = default) => Task.FromResult<Stream>(new MemoryStream());
        public Task<JsonElement?> UploadAsync(string path, Stream content, string field, string fileName,
            IProgress<int>? progress = null, CancellationToken ct = default) => Task.FromResult<JsonElement?>(null);
        public Task<JsonElement?> PostAudioAsync(long threadId, Stream audio, CancellationToken ct = default)
            => Task.FromResult<JsonElement?>(null);
    }

    [Fact]
    public async Task StopCancelsGlobalAndEntityPumpsWithoutCountingAFailure()
    {
        await using var realtime = new RealtimeService(new CancellingClient());
        await realtime.StartAsync();
        realtime.Track("/api/tasks/7/events");
        await Task.Delay(50);
        await realtime.StopAsync();
        Assert.Empty(realtime.EntityStreams);
        Assert.Equal(0, realtime.FailureCount);
        await realtime.StopAsync(); // idempotent
    }

    [Fact]
    public async Task ConcurrentTrackingOfTheSameStreamOpensItOnce()
    {
        await using var realtime = new RealtimeService(new CancellingClient());
        // Dedicated threads behind a start gate, so every caller enters Track in the
        // same instant: whoever loses the TryAdd must report success and open nothing.
        var accepted = new bool[16];
        using var start = new ManualResetEventSlim();
        var callers = Enumerable.Range(0, accepted.Length).Select(i => new Thread(() =>
        {
            start.Wait();
            accepted[i] = realtime.Track("/api/tasks/3/events");
        })).ToArray();
        foreach (var caller in callers) caller.Start();
        start.Set();
        foreach (var caller in callers) caller.Join();

        Assert.All(accepted, Assert.True);
        Assert.Single(realtime.EntityStreams);
        await realtime.UntrackAsync("/api/tasks/3/events");
    }

    [Fact]
    public async Task APathClaimedButNotYetPublishedReportsSuccessAndOpensNothing()
    {
        await using var realtime = new RealtimeService(new CancellingClient());
        // The window Track leaves open between claiming the path and publishing the
        // pump: a second caller must lose the claim, still answer true, and open
        // nothing — otherwise the same entity would pump twice.
        var stops = (System.Collections.Concurrent.ConcurrentDictionary<string, CancellationTokenSource>)typeof(RealtimeService)
            .GetField("_entityStops", BindingFlags.NonPublic | BindingFlags.Instance)!.GetValue(realtime)!;
        Assert.True(stops.TryAdd("/api/tasks/9/events", new CancellationTokenSource()));

        Assert.True(realtime.Track("/api/tasks/9/events"));
        Assert.Empty(realtime.EntityStreams);

        await realtime.UntrackAsync("/api/tasks/9/events");
    }

    [Fact]
    public async Task UntrackingAPumpCancelledMidStreamDoesNotThrow()
    {
        await using var realtime = new RealtimeService(new CancellingClient());
        Assert.True(realtime.Track("/api/threads/1/events"));
        await Task.Delay(50);
        await realtime.UntrackAsync("/api/threads/1/events");
        Assert.Empty(realtime.EntityStreams);
        await realtime.UntrackAsync("/api/threads/1/events"); // already gone
    }
}

/// <summary>
/// Contract and config branches that no other test reaches: the armv7 release
/// spelling, copy keys with empty segments, an unknown copy key, a task that was
/// never notified, and the config write path that must raise Changed.
/// </summary>
public class ContractAndConfigBranchTests
{
    [Fact]
    public void TheArmArchitectureMapsToTheArmv7ReleaseSpelling()
    {
        Assert.Equal("linux-armv7", PlatformKeys.Key("linux", "arm"));
        Assert.Contains("linux-armv7", PlatformKeys.All);
    }

    [Fact]
    public void CopyKeysSkipEmptySegments()
    {
        Assert.Equal("errors.notFound", ErrorCodes.CopyKey("not__found"));
    }

    [Fact]
    public void AnUnknownCopyKeyFallsBackToTheKeyItself()
    {
        var copy = new LocalizationService();
        Assert.Equal("no.such.key", copy.Get("no.such.key"));
        Assert.Equal("no.such.key", copy.Get("ar", "no.such.key"));
    }

    [Fact]
    public void ANeverNotifiedTaskIsOutsideTheIdempotentWindow()
    {
        Assert.False(NotificationDecider.IsWithinIdempotentWindow(DateTimeOffset.UtcNow, default));
    }

    [Fact]
    public void NormalizeRepairsAMissingAllowlistAndClampsConcurrency()
    {
        var normalized = new ShellConfig { ExecutorAllowlist = null!, ExecutorMaxConcurrency = 99 }.Normalize();
        Assert.Empty(normalized.ExecutorAllowlist);
        Assert.Equal(8, normalized.ExecutorMaxConcurrency);
        Assert.Equal(1, new ShellConfig { ExecutorMaxConcurrency = 0 }.Normalize().ExecutorMaxConcurrency);
    }

    [Fact]
    public async Task SavingRaisesChangedWithTheNormalizedConfig()
    {
        var root = Path.Combine(Path.GetTempPath(), "ab-" + Guid.NewGuid().ToString("N"));
        try
        {
            var service = new ConfigService(new AppPaths(root));
            ShellConfig? seen = null;
            service.Changed += config => seen = config;

            var saved = await service.SaveAsync(new ShellConfig { Lang = "zh", ExecutorMaxConcurrency = 99 });
            Assert.Same(saved, seen);
            Assert.Equal(8, seen!.ExecutorMaxConcurrency);
            Assert.True(File.Exists(new AppPaths(root).ConfigFile));

            // A null patch value is not a crash; a JSON null document is refused.
            await service.ApplyPatchAsync("""{"lang":null}""");
            await Assert.ThrowsAsync<FormatException>(() => service.ApplyPatchAsync("null"));
        }
        finally { try { if (Directory.Exists(root)) Directory.Delete(root, true); } catch (Exception) { } }
    }
}
