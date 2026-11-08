using System.Text.Json;
using AgentBuddy.App.ViewModels;
using AgentBuddy.Core.Contracts;
using AgentBuddy.Core.Gateway;
using AgentBuddy.Core.Services;
using Xunit;

namespace AgentBuddy.App.Tests;

public class NavigationTests
{
    private static (NavigationService Nav, StubClient Client, StubShell Shell, ILocalizationService Copy) Build()
    {
        var client = new StubClient();
        var shell = new StubShell();
        var copy = new LocalizationService();
        var nav = new NavigationService();
        nav.Register("/login", new LoginViewModel(client, shell, copy, nav));
        nav.Register("/", new WorkspaceViewModel(client, shell, copy));
        nav.Register("/threads", new ThreadListViewModel(client, shell, copy));
        nav.Register("/threads/:id", new ThreadViewModel(client, shell, copy));
        nav.Register("/tasks", new TaskListViewModel(client, shell, copy));
        nav.Register("/tasks/:id", new TaskTraceViewModel(client, shell, copy));
        nav.Register("/org", new OrgViewModel(client, shell, copy));
        nav.Register("/channels", new ChannelsViewModel(client, shell, copy));
        nav.Register("/connectors", new ConnectorsViewModel(client, shell, copy));
        nav.Register("/settings", new SettingsViewModel(client, shell, copy));
        nav.Register("/computers", new ComputersViewModel(client, shell, copy));
        nav.Register("/schedules", new SchedulesViewModel(client, shell, copy));
        nav.Register("/persona", new PersonaViewModel(client, shell, copy));
        nav.Register("/knowledge", new KnowledgeViewModel(client, shell, copy));
        nav.Register("/files", new FilesViewModel(client, shell, copy));
        nav.Register("/__shell/connect", new ConnectViewModel(client, shell, copy));
        nav.Register("/__shell/about", new AboutViewModel(client, shell, copy));
        return (nav, client, shell, copy);
    }

    [Fact]
    public async Task UnauthenticatedUsersAreSentToLoginAndReturnAfterwards()
    {
        var (nav, _, _, _) = Build();
        Assert.Equal("/login", await nav.NavigateAsync("/threads"));
        Assert.Equal("/threads", nav.ReturnRoute);
        nav.SetAuthenticated(true);
        Assert.Equal("/threads", await nav.NavigateAsync("/login"));
        Assert.IsType<ThreadListViewModel>(nav.Current);
    }

    [Theory]
    [InlineData("/threads/42", "/threads/:id")]
    [InlineData("/tasks/7", "/tasks/:id")]
    [InlineData("/login?next=/files", "/login")]
    [InlineData("#/channels", "/")]
    [InlineData("/unknown", "/unknown")]
    public void RouteNormalization(string route, string expected) =>
        Assert.Equal(expected, NavigationService.Normalize(route));

    [Fact]
    public void AllSeventeenRoutesAreRegistered()
    {
        var (nav, _, _, _) = Build();
        Assert.Equal(17, nav.Routes.Count); // 15 screen views (login + 14 workbench) + connect + about
        foreach (var screen in nav.Routes.Values)
        {
            Assert.False(string.IsNullOrEmpty(screen.Title));
            Assert.NotEmpty(screen.EndpointsUsed);
        }
    }

    [Fact]
    public async Task EveryScreenLoadsAndReportsErrorsAsMachineCodes()
    {
        var (nav, client, _, _) = Build();
        nav.SetAuthenticated(true);
        client.Payload = JsonDocument.Parse("""[{"id":"t1"},{"id":"t2"}]""").RootElement.Clone();
        foreach (var route in nav.Routes.Keys)
        {
            await nav.NavigateAsync(route);
            Assert.NotNull(nav.Current);
            Assert.Equal(2, nav.Current!.Items.Count);
            Assert.Equal("", nav.Current.ErrorCode);
        }
        client.Throw = true;
        await nav.NavigateAsync("/files");
        Assert.Equal(ErrorCodes.NetworkError, nav.Current!.ErrorCode);
        Assert.Contains(ErrorCodes.NetworkError, nav.Current.ErrorText);
    }

    [Fact]
    public async Task SignInMarksAuthenticatedAndFailsWithAnErrorCode()
    {
        var (nav, client, _, _) = Build();
        var login = (LoginViewModel)nav.Routes["/login"];
        login.Email = "a@b.c";
        login.Password = "secret";
        await login.LoginCommand.ExecuteAsync(null);
        Assert.True(nav.IsAuthenticated);
        nav.SetAuthenticated(false);
        client.FailCode = ErrorCodes.Forbidden;
        await login.LoginCommand.ExecuteAsync(null);
        Assert.False(nav.IsAuthenticated);
        Assert.Equal(ErrorCodes.Forbidden, login.ErrorCode);
    }
}

public class ScreenCapabilityTests
{
    [Fact]
    public async Task NumberedDetailRoutesCarryTheirEntityId()
    {
        var (nav, _, _, _) = Build();
        nav.SetAuthenticated(true);
        await nav.NavigateAsync("/threads/42");
        Assert.Equal(42, ((ThreadViewModel)nav.Routes["/threads/:id"]).EntityId);
        await nav.NavigateAsync("/tasks/7");
        Assert.Equal(7, ((TaskTraceViewModel)nav.Routes["/tasks/:id"]).EntityId);
        await nav.NavigateAsync("/threads");
        Assert.Equal(42, ((ThreadViewModel)nav.Routes["/threads/:id"]).EntityId);
    }

    [Fact]
    public async Task FileTransferCommandsCoverNormalAndErrorPaths()
    {
        var (_, client, shell, copy) = Build();
        var files = new FilesViewModel(client, shell, copy);
        Assert.Equal(ErrorCodes.NotConfigured, await WithoutPicker(files));
        files.PickFileAsync = () => Task.FromResult<(Stream, string)?>((new MemoryStream([1, 2, 3]), "clip.bin"));
        files.SaveFileAsync = (_, _) => Task.CompletedTask;

        await files.UploadCommand.ExecuteAsync(null);
        Assert.Equal(100, files.Progress);
        Assert.Equal("", files.ErrorCode);

        files.SelectedItem = """{"id":"f1","name":"clip.bin"}""";
        Assert.Equal("f1", files.SelectedId);
        await files.DownloadCommand.ExecuteAsync(null);
        Assert.Equal("", files.ErrorCode);

        files.SelectedItem = null;
        await files.DownloadCommand.ExecuteAsync(null);
        Assert.Equal(ErrorCodes.NotFound, files.ErrorCode);

        files.SelectedItem = """{"id":"f2"}""";
        client.Throw = true;
        await files.DeleteCommand.ExecuteAsync(null);
        Assert.Equal(ErrorCodes.NetworkError, files.ErrorCode);
    }

    private static async Task<string> WithoutPicker(FilesViewModel files)
    {
        await files.UploadCommand.ExecuteAsync(null);
        return files.ErrorCode;
    }

    [Fact]
    public async Task VoiceAndTaskActionsCoverNormalAndErrorPaths()
    {
        var (_, client, shell, copy) = Build();
        var thread = new ThreadViewModel(client, shell, copy);
        await thread.RecordCommand.ExecuteAsync(null);
        Assert.Equal(ErrorCodes.SpeechDisabled, thread.ErrorCode); // no audio backend

        var audio = new StubAudio();
        thread.Audio = audio;
        await thread.PlayCommand.ExecuteAsync(null);
        Assert.Equal(ErrorCodes.SpeechDisabled, thread.ErrorCode); // nothing recorded yet

        thread.EntityId = 5;
        await thread.RecordCommand.ExecuteAsync(null);
        Assert.Equal("", thread.ErrorCode);
        Assert.Equal(1, audio.Recordings);
        Assert.Equal(5, client.LastAudioThreadId);
        await thread.PlayCommand.ExecuteAsync(null);
        Assert.Equal(1, audio.Playbacks);
        Assert.Equal("", thread.ErrorCode);

        var trace = new TaskTraceViewModel(client, shell, copy) { EntityId = 9 };
        await trace.CancelCommand.ExecuteAsync(null);
        await trace.ResumeCommand.ExecuteAsync(null);
        Assert.Equal("", trace.ErrorCode);
        client.Throw = true;
        await trace.ResumeCommand.ExecuteAsync(null);
        Assert.Equal(ErrorCodes.NetworkError, trace.ErrorCode);
    }

    private sealed class StubAudio : IAudioService
    {
        public int Recordings { get; private set; }
        public int Playbacks { get; private set; }
        public Task<byte[]> RecordAsync(TimeSpan duration, CancellationToken ct = default)
        {
            Recordings++;
            return Task.FromResult(new byte[] { 1, 2 });
        }
        public Task PlayAsync(Stream audio, CancellationToken ct = default)
        {
            Playbacks++;
            return Task.CompletedTask;
        }
    }

    private static (NavigationService Nav, StubClient Client, StubShell Shell, ILocalizationService Copy) Build()
    {
        var client = new StubClient();
        var shell = new StubShell();
        var copy = new LocalizationService();
        var nav = new NavigationService();
        nav.Register("/login", new LoginViewModel(client, shell, copy, nav));
        nav.Register("/", new WorkspaceViewModel(client, shell, copy));
        nav.Register("/threads", new ThreadListViewModel(client, shell, copy));
        nav.Register("/threads/:id", new ThreadViewModel(client, shell, copy));
        nav.Register("/tasks/:id", new TaskTraceViewModel(client, shell, copy));
        return (nav, client, shell, copy);
    }
}

public class ShellViewModelTests
{
    [Fact]
    public void LanguageSwitchIsLocalizedAndPushedToTheShellControlPlane()
    {
        var (nav, _, shell, copy) = Build();
        var vm = new ShellViewModel(nav, copy, shell, "0.1.0");
        vm.Lang = "ar";
        Assert.True(copy.IsRtl);
        Assert.Equal("ar", vm.Lang);
        Assert.Contains("lang", shell.LastPatch!.ToString());
        Assert.Equal(13, vm.Languages.Count);
    }

    [Fact]
    public void NotificationsTrackUnreadAndDeepLinksAreConsumedOnce()
    {
        var (nav, _, shell, copy) = Build();
        var consumed = 0;
        var vm = new ShellViewModel(nav, copy, shell, "0.1.0")
        {
            ConsumeDeepLink = () => consumed++ == 0 ? "/settings" : null
        };
        vm.AddNotification("title", "body", "/settings");
        vm.AddNotification("title", "body2", "/settings");
        Assert.Equal(2, vm.Unread);
        Assert.Equal(2, shell.Badge);
        vm.OpenNotificationCommand.Execute(null);
        Assert.Equal("/settings", nav.ReturnRoute);
        vm.MarkAllRead();
        Assert.Equal(0, vm.Unread);
        Assert.Equal(0, shell.Badge);
        Assert.Equal(1, consumed);
        vm.ToggleThemeCommand.Execute(null); // no Application in headless tests: must not throw
        Assert.Equal("v0.1.0", vm.VersionText);
    }

    private static (NavigationService Nav, StubClient Client, StubShell Shell, ILocalizationService Copy) Build()
    {
        var client = new StubClient();
        var shell = new StubShell();
        var copy = new LocalizationService();
        var nav = new NavigationService();
        nav.Register("/login", new LoginViewModel(client, shell, copy, nav));
        nav.Register("/", new WorkspaceViewModel(client, shell, copy));
        nav.Register("/settings", new SettingsViewModel(client, shell, copy));
        return (nav, client, shell, copy);
    }
}

internal sealed class StubClient : IAgentHubClient
{
    public JsonElement? Payload { get; set; }
    public bool Throw { get; set; }
    public string FailCode { get; set; } = ErrorCodes.Unauthenticated;
    public long LastAudioThreadId { get; private set; }

    public Task<JsonElement?> SendAsync(string path, HttpMethod method, object? body = null, CancellationToken ct = default)
    {
        if (Throw) throw new HubApiException(ErrorCodes.NetworkError);
        if (method == HttpMethod.Post && FailCode != ErrorCodes.Unauthenticated && path == Endpoints.Login)
            throw new HubApiException(FailCode);
        return Task.FromResult(Payload);
    }
    public IAsyncEnumerable<HubEvent> SubscribeAsync(string path, long? since = null, CancellationToken ct = default) => Empty();
    public Task<Stream> DownloadAsync(string path, CancellationToken ct = default) => Task.FromResult<Stream>(new MemoryStream());
    public Task<JsonElement?> UploadAsync(string path, Stream content, string field, string fileName, IProgress<int>? progress = null, CancellationToken ct = default) => Task.FromResult<JsonElement?>(null);
    public Task<JsonElement?> PostAudioAsync(long id, Stream audio, CancellationToken ct = default)
    {
        LastAudioThreadId = id;
        return Task.FromResult<JsonElement?>(null);
    }
    private static async IAsyncEnumerable<HubEvent> Empty() { await Task.CompletedTask; yield break; }
}

internal sealed class StubShell : IShellControl
{
    public int Badge { get; private set; }
    public object? LastPatch { get; private set; }
    public Task<ShellConfigView> GetConfigAsync(CancellationToken ct = default) => Task.FromResult(new ShellConfigView());
    public Task<ShellConfigView> SetConfigAsync(object patch, CancellationToken ct = default)
    {
        LastPatch = patch;
        return Task.FromResult(new ShellConfigView());
    }
    public Task<JsonElement?> GetExecutorAsync(CancellationToken ct = default) => Task.FromResult<JsonElement?>(null);
    public Task<JsonElement?> SetExecutorAsync(object patch, CancellationToken ct = default) => Task.FromResult<JsonElement?>(null);
    public Task<JsonElement?> TestConnectionAsync(string url, CancellationToken ct = default) =>
        Task.FromResult<JsonElement?>(JsonDocument.Parse("""{"ok":true}""").RootElement.Clone());
    public Task<JsonElement?> HideAsync(CancellationToken ct = default) => Task.FromResult<JsonElement?>(null);
    public Task NotifyAsync(string title, string body, string? link, CancellationToken ct = default) => Task.CompletedTask;
    public Task<int> SetBadgeAsync(int count, CancellationToken ct = default) { Badge = count; return Task.FromResult(count); }
    public Task<UpgradeState> GetUpgradeAsync(CancellationToken ct = default) => Task.FromResult(new UpgradeState());
    public Task<UpgradeState> CheckUpgradeAsync(CancellationToken ct = default) => Task.FromResult(new UpgradeState());
    public Task<UpgradeState> InstallUpgradeAsync(CancellationToken ct = default) => Task.FromResult(new UpgradeState());
}
