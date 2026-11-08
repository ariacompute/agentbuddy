using System.Globalization;
using System.Net;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using AgentBuddy.Core.Contracts;
using AgentBuddy.Core.Gateway;
using AgentBuddy.Core.Services;
using Xunit;
using GatewayContract = AgentBuddy.Core.Contracts.Gateway;

namespace AgentBuddy.Core.Tests;

public class LocalizationTests
{
    [Fact]
    public void AllLanguagesResolveEveryKeyWithEnglishFallback()
    {
        var copy = new LocalizationService();
        Assert.Equal(13, LanguageCodes.All.Length);
        foreach (var lang in LanguageCodes.All)
        {
            foreach (var key in copy.Keys)
                Assert.False(string.IsNullOrEmpty(copy.Get(lang, key)), $"{lang}:{key}");
        }
        Assert.Equal("nonexistent.key", copy.Get("en", "nonexistent.key"));
    }

    [Fact]
    public void OnlyArabicIsRtlAndTraditionalChineseIsDistinct()
    {
        var copy = new LocalizationService();
        copy.SetLang("ar");
        Assert.True(copy.IsRtl);
        copy.SetLang("zh-TW");
        Assert.False(copy.IsRtl);
        Assert.NotEqual(copy.Get("zh", "nav.settings"), copy.Get("zh-TW", "nav.settings"));
        Assert.NotEqual(copy.Get("zh", "nav.files"), copy.Get("zh-TW", "nav.files"));
    }

    [Fact]
    public void SetLangNormalizesAndRaisesOneEvent()
    {
        var copy = new LocalizationService();
        var seen = new List<string>();
        copy.LanguageChanged += l => seen.Add(l);
        copy.SetLang("zh-Hant-TW");
        copy.SetLang("zh-Hant-TW");
        Assert.Equal(new[] { "zh-TW" }, seen);
    }

    [Fact]
    public void LanguageMatchingMirrorsTheOldWorkbench()
    {
        Assert.Equal("zh-TW", LanguageCodes.Match("zh-HK"));
        Assert.Equal("zh", LanguageCodes.Match("zh-CN"));
        Assert.Equal("ja", LanguageCodes.Match("ja-JP"));
        Assert.Equal("en", LanguageCodes.Match("xx-YY"));
    }
}

public class DeciderTests
{
    [Theory]
    [InlineData(0, true, 5000)]
    [InlineData(0, false, 20000)]
    [InlineData(1, true, 10000)]
    [InlineData(2, true, 20000)]
    [InlineData(9, true, 30000)]
    public void PollIntervalBacksOffWithinBounds(int failures, bool visible, int expected) =>
        Assert.Equal(expected, NotificationDecider.ComputePollInterval(failures, visible));

    [Fact]
    public void QuietWindowIsCappedAndRateIsLimited()
    {
        var now = DateTimeOffset.UnixEpoch;
        Assert.Equal(now.AddMinutes(240), NotificationDecider.QuietUntil(now, 10000));
        Assert.True(NotificationDecider.IsQuiet(now, now.AddMinutes(1)));
        Assert.False(NotificationDecider.IsQuiet(now, now.AddMinutes(-1)));
        Assert.False(NotificationDecider.AllowsRate(8));
        Assert.True(NotificationDecider.AllowsRate(7));
    }

    [Fact]
    public void AnnouncementsAreKeyedByStateAndIdempotentForOneHour()
    {
        Assert.Equal("notification.approval", NotificationDecider.AnnouncementKey("input-required"));
        Assert.Equal("notification.result", NotificationDecider.AnnouncementKey("completed"));
        Assert.Equal("notification.failure", NotificationDecider.AnnouncementKey("failed"));
        Assert.Null(NotificationDecider.AnnouncementKey("working"));
        var now = DateTimeOffset.UtcNow;
        Assert.True(NotificationDecider.IsWithinIdempotentWindow(now, now.AddMinutes(-30)));
        Assert.False(NotificationDecider.IsWithinIdempotentWindow(now, now.AddHours(-2)));
    }

    [Fact]
    public void BadgeIsClampedAndActiveStatesAreFrozen() =>
        Assert.Equal(Limits.MaxBadge, NotificationDecider.ClampBadge(int.MaxValue));
}

public class ContractTests
{
    [Theory]
    [InlineData("/api", true)]
    [InlineData("/api/threads", true)]
    [InlineData("/a2a", true)]
    [InlineData("/a2a/x", true)]
    [InlineData("/healthz", true)]
    [InlineData("/.well-known", true)]
    [InlineData("/.well-known/agent-card.json", true)]
    [InlineData("/apifoo", false)]
    [InlineData("/__shell/config", false)]
    [InlineData("/threads", false)]
    public void ForwardPrefixWhitelist(string path, bool expected) =>
        Assert.Equal(expected, GatewayContract.IsRemotePath(path));

    [Fact]
    public void PathFormattingEncodesPlaceholdersAndSince()
    {
        Assert.Equal("/api/threads/4%2F2", Endpoints.Format(Endpoints.ThreadById, ("id", "4/2")));
        Assert.Equal("/api/tasks/7/events?since=42", Endpoints.WithSince(Endpoints.Format(Endpoints.TaskEvents, ("id", 7)), 42));
        Assert.Equal("/api/resources", Endpoints.WithSince(Endpoints.Resources, null));
        Assert.Equal("/api/knowledge?agentId=a%20b", Endpoints.WithQuery(Endpoints.Knowledge, ("agentId", "a b"), ("empty", "")));
    }

    [Fact]
    public void PlatformKeyMappingAndPublishedMatrix()
    {
        Assert.Equal("darwin-aarch64", PlatformKeys.Key("macos", "aarch64"));
        Assert.Equal("windows-x86_64", PlatformKeys.Key("windows", "x86_64"));
        Assert.Equal("linux-i686", PlatformKeys.Key("linux", "x86"));
        Assert.Null(PlatformKeys.Key("plan9", "x86_64"));
        Assert.Equal(3, PlatformKeys.Published.Length);
        Assert.Equal(9, PlatformKeys.All.Length);
        Assert.Equal(8, SseEvents.All.Length);
        Assert.Equal(12, ShellEndpoints.All.Length);
    }

    [Fact]
    public void ReleaseContractIsExactlyNineAssets()
    {
        var assets = ReleaseContract.AllAssets("1.2.3");
        Assert.Equal(9, assets.Length);
        Assert.Equal("agentbuddy-amd64-1.2.3.deb", assets[0]);
        Assert.Equal("latest.json", assets[6]);
        Assert.Equal("SHA256SUMS", assets[8]);
        Assert.Equal("agentbuddy-macos-aarch64-1.2.3.tar.gz", ReleaseContract.InstallableAsset("1.2.3", "darwin-aarch64"));
        Assert.Equal("agentbuddy-x64-1.2.3.msi", ReleaseContract.InstallableAsset("1.2.3", "windows-x86_64"));
        Assert.Equal("agentbuddy-amd64-1.2.3.deb", ReleaseContract.InstallableAsset("1.2.3", "linux-x86_64"));
        Assert.Null(ReleaseContract.InstallableAsset("1.2.3", "linux-aarch64"));
        Assert.True(ReleaseContract.IsValidVersion("v1.2.3-beta.1"));
        Assert.False(ReleaseContract.IsValidVersion("1.2"));
    }

    [Fact]
    public void ErrorAndUpgradeCodeSetsAreComplete()
    {
        Assert.Equal(74, ErrorCodes.All.Length);
        Assert.Equal(74, ErrorCodes.All.Distinct().Count());
        Assert.Equal(13, UpgradeCodes.All.Length);
        Assert.Equal("unsupported_platform", UpgradeCodes.Machine(UpgradeCode.UnsupportedPlatform));
        Assert.True(ErrorCodes.IsAuth(ErrorCodes.Unauthenticated));
        Assert.False(ErrorCodes.IsAuth(ErrorCodes.NotFound));
        Assert.Equal("errors.fileNotFound", ErrorCodes.CopyKey("file_not_found"));
    }
}

public class ConfigTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "agentbuddy-tests-" + Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task DefaultsMatchTheOldConfigSchema()
    {
        var cfg = await new ConfigService(new AppPaths(_dir)).LoadAsync();
        Assert.Equal("", cfg.ServerUrl);
        Assert.True(cfg.Background);
        Assert.True(cfg.NotifyEnabled);
        Assert.True(cfg.UpgradeAutoCheck);
        Assert.False(cfg.ExecutorEnabled);
        Assert.Equal(1, cfg.ExecutorMaxConcurrency);
    }

    [Fact]
    public async Task PatchAppliesOnlyKnownCamelCaseKeysAndClamps()
    {
        var service = new ConfigService(new AppPaths(_dir));
        await service.LoadAsync();
        var changed = 0;
        service.Changed += _ => changed++;
        var result = await service.ApplyPatchAsync("""{"lang":"ar","notifyQuietMinutes":99999,"executorMaxConcurrency":99,"bogus":1}""");
        Assert.Equal("ar", result.Lang);
        Assert.Equal(Limits.ConfigQuietMinutesCap, result.NotifyQuietMinutes);
        Assert.Equal(8, result.ExecutorMaxConcurrency);
        Assert.Equal(1, changed);
        Assert.True(File.Exists(new AppPaths(_dir).ConfigFile));
        var reloaded = await new ConfigService(new AppPaths(_dir)).LoadAsync();
        Assert.Equal("ar", reloaded.Lang);
    }

    [Fact]
    public void ConfigViewNeverEchoesTheApiKey()
    {
        var view = ShellConfigView.From(new ShellConfig { ExecutorApiKey = "secret" }, true, "keyring");
        Assert.True(view.ExecutorHasApiKey);
        Assert.Equal("keyring", view.SessionBackend);
        Assert.DoesNotContain("secret", JsonSerializer.Serialize(view));
    }

    public void Dispose()
    {
        if (Directory.Exists(_dir)) Directory.Delete(_dir, recursive: true);
    }
}

public class TransportTests
{
    [Fact]
    public async Task SseParserFramesEventsAndNames()
    {
        const string payload = "event: task_status_update\nid: 7\ndata: {\"state\":\"working\"}\n\n: keepalive\nevent: task_artifact_update\ndata: first\ndata: second\n\n";
        await using var stream = new MemoryStream(Encoding.UTF8.GetBytes(payload));
        var events = new List<HubEvent>();
        await foreach (var e in SseParser.ParseAsync(stream)) events.Add(e);
        Assert.Equal(2, events.Count);
        Assert.Equal("task_status_update", events[0].Name);
        Assert.Equal("7", events[0].Id);
        Assert.Equal("first\nsecond", events[1].Data);
    }

    [Fact]
    public async Task ApiErrorsCarryOnlyTheMachineCode()
    {
        using var http = new HttpClient(new StubHandler(HttpStatusCode.BadRequest, """{"code":"file_too_large"}"""))
        { BaseAddress = new Uri("http://127.0.0.1:1") };
        using var client = new AgentHubClient(http);
        var error = await Assert.ThrowsAsync<HubApiException>(() =>
            client.SendAsync(Endpoints.Files, HttpMethod.Post, new { }));
        Assert.Equal("file_too_large", error.Code);
        Assert.Equal(400, error.Status);
    }

    [Fact]
    public async Task SuccessfulEmptyAndNoContentResponsesReturnNull()
    {
        using var http = new HttpClient(new StubHandler(HttpStatusCode.NoContent, ""))
        { BaseAddress = new Uri("http://127.0.0.1:1") };
        using var client = new AgentHubClient(http);
        Assert.Null(await client.SendAsync(Endpoints.Logout, HttpMethod.Post));
    }

    private sealed class StubHandler(HttpStatusCode status, string body) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) =>
            Task.FromResult(new HttpResponseMessage(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") });
    }
}

public class RealtimeTests
{
    [Fact]
    public void AllEightEventNamesAreClassifiedAndStreamMembershipIsStrict()
    {
        Assert.Equal(RealtimeChannel.Thread, RealtimeEvents.Classify(SseEvents.ThreadAgent));
        Assert.Equal(RealtimeChannel.Thread, RealtimeEvents.Classify(SseEvents.ThreadMessage));
        Assert.Equal(RealtimeChannel.Task, RealtimeEvents.Classify(SseEvents.TaskStatus));
        Assert.Equal(RealtimeChannel.Task, RealtimeEvents.Classify(SseEvents.TaskArtifact));
        Assert.Equal(RealtimeChannel.Task, RealtimeEvents.Classify(SseEvents.TaskSpan));
        Assert.Equal(RealtimeChannel.Task, RealtimeEvents.Classify(SseEvents.Message));
        Assert.Equal(RealtimeChannel.Sandbox, RealtimeEvents.Classify(SseEvents.Sandbox));
        Assert.Equal(RealtimeChannel.Router, RealtimeEvents.Classify(SseEvents.Router));
        Assert.Equal(RealtimeChannel.Unknown, RealtimeEvents.Classify("heartbeat"));
        Assert.False(RealtimeEvents.IsKnown("heartbeat"));

        Assert.True(RealtimeEvents.BelongsTo(Endpoints.ThreadEvents, SseEvents.ThreadAgent));
        Assert.True(RealtimeEvents.BelongsTo(Endpoints.TaskEvents, SseEvents.TaskSpan));
        Assert.True(RealtimeEvents.BelongsTo(Endpoints.SandboxEvents, SseEvents.Sandbox));
        Assert.True(RealtimeEvents.BelongsTo(Endpoints.RouterEvents, SseEvents.Router));
        Assert.False(RealtimeEvents.BelongsTo(Endpoints.ThreadEvents, SseEvents.Router));
        Assert.False(RealtimeEvents.BelongsTo("/api/unknown", SseEvents.Message));
    }

    [Fact]
    public async Task EventsAreBufferedAndReconnectReplaysFromLastSequence()
    {
        var client = new StreamClient
        {
            Events =
            [
                Event(SseEvents.ThreadAgent, "1"), Event("heartbeat", null),
                Event(SseEvents.ThreadMessage, "3")
            ]
        };
        await using var realtime = new RealtimeService(client);
        var seen = new List<string>();
        realtime.EventReceived += e => seen.Add(e.Name);

        Assert.True(await realtime.PumpOnceAsync(Endpoints.ThreadEvents));
        Assert.Equal(3, realtime.Cursor(Endpoints.ThreadEvents)); // keepalives do not become notifications
        Assert.Equal(new[] { SseEvents.ThreadAgent, SseEvents.ThreadMessage }, seen);
        Assert.Equal(2, realtime.ProcessedCount);
        Assert.Equal(SseEvents.ThreadMessage, realtime.Recent(Endpoints.ThreadEvents)[0].Name);
        Assert.Equal(0, realtime.FailureCount);

        Assert.True(await realtime.PumpOnceAsync(Endpoints.ThreadEvents));
        Assert.Equal(new[] { (Endpoints.ThreadEvents, (long?)null), (Endpoints.ThreadEvents, (long?)3) }, client.Calls);
    }

    [Fact]
    public async Task FailedSubscriptionReturnsFalseAndResetsBackoffOnRecovery()
    {
        var client = new StreamClient { Throw = true };
        await using var realtime = new RealtimeService(client);
        Assert.False(await realtime.PumpOnceAsync(Endpoints.TaskEvents));
        Assert.Equal(1, realtime.FailureCount);
        Assert.Empty(realtime.Recent(Endpoints.TaskEvents));
        Assert.Null(realtime.Cursor(Endpoints.TaskEvents));

        client.Throw = false;
        client.Events = [Event(SseEvents.TaskStatus, "9")];
        Assert.True(await realtime.PumpOnceAsync(Endpoints.TaskEvents));
        Assert.Equal(0, realtime.FailureCount);
        Assert.Equal(9, realtime.Cursor(Endpoints.TaskEvents));
    }

    [Fact]
    public async Task RecentRingIsBoundedAndStartStopDoesNotLeakTasks()
    {
        var events = Enumerable.Range(1, RealtimeService.RecentCapacity + 10)
            .Select(i => Event(SseEvents.TaskArtifact, i.ToString(CultureInfo.InvariantCulture))).ToArray();
        var client = new StreamClient { Events = events };
        await using var realtime = new RealtimeService(client);
        Assert.True(await realtime.PumpOnceAsync(Endpoints.TaskEvents));
        Assert.Equal(RealtimeService.RecentCapacity, realtime.Recent(Endpoints.TaskEvents).Count);
        Assert.Equal(RealtimeService.RecentCapacity + 10, realtime.ProcessedCount);

        await realtime.StartAsync();
        await realtime.StopAsync();
        Assert.Equal(0, realtime.FailureCount);
    }

    private static HubEvent Event(string name, string? id) => new() { Name = name, Data = "{}", Id = id };

    private sealed class StreamClient : IAgentHubClient
    {
        public List<(string Path, long? Since)> Calls { get; } = [];
        public HubEvent[] Events { get; set; } = [];
        public bool Throw { get; set; }

        public IAsyncEnumerable<HubEvent> SubscribeAsync(string path, long? since = null, CancellationToken ct = default)
        {
            lock (Calls) Calls.Add((path, since));
            return Sequence(ct);
        }

        private async IAsyncEnumerable<HubEvent> Sequence([EnumeratorCancellation] CancellationToken ct)
        {
            await Task.Yield();
            if (Throw) throw new HubApiException(ErrorCodes.NetworkError);
            foreach (var item in Events)
            {
                ct.ThrowIfCancellationRequested();
                yield return item;
            }
        }

        public Task<JsonElement?> SendAsync(string path, HttpMethod method, object? body = null, CancellationToken ct = default) => Task.FromResult<JsonElement?>(null);
        public Task<Stream> DownloadAsync(string path, CancellationToken ct = default) => Task.FromResult<Stream>(new MemoryStream());
        public Task<JsonElement?> UploadAsync(string path, Stream content, string field, string fileName, IProgress<int>? progress = null, CancellationToken ct = default) => Task.FromResult<JsonElement?>(null);
        public Task<JsonElement?> PostAudioAsync(long id, Stream audio, CancellationToken ct = default) => Task.FromResult<JsonElement?>(null);
    }
}

public class MonitorTests
{
    [Fact]
    public async Task SuccessfulPollTracksActiveTasksAndPushesBadge()
    {
        var tasks = JsonDocument.Parse("""[{"id":"t1","state":"working"},{"id":"t2","state":"completed"}]""").RootElement.Clone();
        var client = new StubClient { Workspace = JsonDocument.Parse("{}").RootElement.Clone(), Tasks = tasks };
        var shell = new StubShell();
        await using var monitor = new MonitorService(client, shell, new LocalizationService());
        Assert.True(await monitor.PollOnceAsync());
        Assert.Equal(new[] { "t1" }, monitor.ActiveTaskIds.ToArray());
        Assert.Equal(1, monitor.UnreadCount);
        Assert.Equal(1, shell.Badge);
        Assert.Single(shell.Notifications);
        Assert.Equal(0, monitor.FailureCount);
    }

    [Fact]
    public async Task FailedPollIncrementsBackoffWithoutThrowing()
    {
        var monitor = new MonitorService(new StubClient { Throw = true }, new StubShell(), new LocalizationService());
        Assert.False(await monitor.PollOnceAsync());
        Assert.False(await monitor.PollOnceAsync());
        Assert.Equal(2, monitor.FailureCount);
        Assert.Equal(20000, NotificationDecider.ComputePollInterval(monitor.FailureCount, true));
        await monitor.DisposeAsync();
    }

    private sealed class StubClient : IAgentHubClient
    {
        public JsonElement? Workspace { get; init; }
        public JsonElement? Tasks { get; init; }
        public bool Throw { get; init; }

        public Task<JsonElement?> SendAsync(string path, HttpMethod method, object? body = null, CancellationToken ct = default)
        {
            if (Throw) throw new HubApiException(ErrorCodes.NetworkError);
            return Task.FromResult(path == Endpoints.Workspace ? Workspace : Tasks);
        }
        public IAsyncEnumerable<HubEvent> SubscribeAsync(string path, long? since = null, CancellationToken ct = default) => Empty();
        public Task<Stream> DownloadAsync(string path, CancellationToken ct = default) => Task.FromResult<Stream>(new MemoryStream());
        public Task<JsonElement?> UploadAsync(string path, Stream content, string field, string fileName, IProgress<int>? progress = null, CancellationToken ct = default) => Task.FromResult<JsonElement?>(null);
        public Task<JsonElement?> PostAudioAsync(long id, Stream audio, CancellationToken ct = default) => Task.FromResult<JsonElement?>(null);

        private static async IAsyncEnumerable<HubEvent> Empty() { await Task.CompletedTask; yield break; }
    }

    private sealed class StubShell : IShellControl
    {
        public int Badge { get; private set; }
        public List<(string Title, string Body, string? Link)> Notifications { get; } = [];
        public Task<ShellConfigView> GetConfigAsync(CancellationToken ct = default) => Task.FromResult(new ShellConfigView());
        public Task<ShellConfigView> SetConfigAsync(object patch, CancellationToken ct = default) => Task.FromResult(new ShellConfigView());
        public Task<JsonElement?> GetExecutorAsync(CancellationToken ct = default) => Task.FromResult<JsonElement?>(null);
        public Task<JsonElement?> SetExecutorAsync(object patch, CancellationToken ct = default) => Task.FromResult<JsonElement?>(null);
        public Task<JsonElement?> TestConnectionAsync(string url, CancellationToken ct = default) => Task.FromResult<JsonElement?>(null);
        public Task<JsonElement?> HideAsync(CancellationToken ct = default) => Task.FromResult<JsonElement?>(null);
        public Task NotifyAsync(string title, string body, string? link, CancellationToken ct = default)
        {
            Notifications.Add((title, body, link));
            return Task.CompletedTask;
        }
        public Task<int> SetBadgeAsync(int count, CancellationToken ct = default) { Badge = count; return Task.FromResult(count); }
        public Task<UpgradeState> GetUpgradeAsync(CancellationToken ct = default) => Task.FromResult(new UpgradeState());
        public Task<UpgradeState> CheckUpgradeAsync(CancellationToken ct = default) => Task.FromResult(new UpgradeState());
        public Task<UpgradeState> InstallUpgradeAsync(CancellationToken ct = default) => Task.FromResult(new UpgradeState());
    }
}
