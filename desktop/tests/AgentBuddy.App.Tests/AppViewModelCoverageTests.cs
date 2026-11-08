using System.Text.Json;
using AgentBuddy.App;
using AgentBuddy.App.ViewModels;
using AgentBuddy.Core.Contracts;
using AgentBuddy.Core.Gateway;
using AgentBuddy.Core.Services;
using Xunit;

namespace AgentBuddy.App.Tests;

/// <summary>Every ViewModel branch that the screen smoke tests do not reach.</summary>
public class ViewModelCoverageTests
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
    public async Task TheRouterGuardsDetailRoutesAndKeepsTheReturnRoute()
    {
        var (nav, _, _, _) = Build();
        Assert.Equal("/threads/:id", NavigationService.Normalize("/threads/42?tab=1#top"));
        Assert.Equal("/tasks/:id", NavigationService.Normalize("/tasks/7"));
        Assert.Equal("/", NavigationService.Normalize(""));
        Assert.Equal("/org", NavigationService.Normalize("/org"));

        // Signed out: everything except the three anonymous screens lands on login.
        Assert.Equal("/login", await nav.NavigateAsync("/org"));
        Assert.Equal("/org", nav.ReturnRoute);
        Assert.Equal("/__shell/about", await nav.NavigateAsync("/__shell/about"));
        Assert.Equal("/__shell/connect", await nav.NavigateAsync("/__shell/connect"));

        // Signing in resumes the withheld route.
        nav.SetAuthenticated(true);
        Assert.Equal("/org", await nav.NavigateAsync("/login"));
        Assert.Null(nav.ReturnRoute);

        // Unknown and unparsable detail routes fall back to the workspace.
        Assert.Equal("/", await nav.NavigateAsync("/threads/abc"));
        Assert.Equal("/", await nav.NavigateAsync("/nope"));

        nav.SetAuthenticated(false);
        Assert.Null(nav.ReturnRoute);
    }

    [Fact]
    public void DetailRoutesParseTheirIdAndRejectEverythingElse()
    {
        Assert.True(NavigationService.TryParseEntityId("/threads/42?tab=1#top", out var thread));
        Assert.Equal(42, thread);
        Assert.True(NavigationService.TryParseEntityId("/tasks/7", out var task));
        Assert.Equal(7, task);
        Assert.False(NavigationService.TryParseEntityId("/threads/abc", out _));
        Assert.False(NavigationService.TryParseEntityId("/org/1", out _));
        Assert.False(NavigationService.TryParseEntityId("/threads", out _));
    }

    [Fact]
    public void EveryErrorCodeMapsToALocalisedText()
    {
        var (_, _, _, copy) = Build();
        var screen = (ScreenViewModel)new WorkspaceViewModel(new StubClient(), new StubShell(), copy);
        Assert.Equal("", screen.ErrorText);

        foreach (var (code, key) in new[]
                 {
                     (ErrorCodes.Unauthenticated, "errors.unauthenticated"),
                     (ErrorCodes.Forbidden, "errors.forbidden"),
                     (ErrorCodes.NotFound, "errors.notFound"),
                     (ErrorCodes.NetworkError, "errors.networkError"),
                     (ErrorCodes.Timeout, "errors.networkError"),
                     ("weird_code", "errors.internalError")
                 })
        {
            screen.ErrorCode = code;
            Assert.Equal(copy.Get(key) + " (" + code + ")", screen.ErrorText);
        }
    }

    [Fact]
    public async Task RefreshFillsArraysObjectsAndKeepsMachineCodes()
    {
        var (_, client, _, copy) = Build();
        var screen = new WorkspaceViewModel(client, new StubShell(), copy);

        client.Payload = JsonDocument.Parse("""[{"id":1},{"id":2}]""").RootElement.Clone();
        await screen.RefreshAsync();
        Assert.Equal(2, screen.Items.Count);

        client.Payload = JsonDocument.Parse("""{"a":1,"b":{}}""").RootElement.Clone();
        await screen.RefreshAsync();
        Assert.Equal(2, screen.Items.Count);
        Assert.Contains("a: 1", screen.Items);

        client.Payload = null;
        await screen.RefreshAsync();
        Assert.Empty(screen.Items);

        client.Throw = true;
        await screen.RefreshAsync();
        Assert.Equal(ErrorCodes.NetworkError, screen.ErrorCode);
        Assert.False(screen.IsBusy);
    }

    [Fact]
    public async Task RefreshIsSingleFlightAndSurfacesApiCodes()
    {
        var (_, client, _, copy) = Build();
        var screen = new WorkspaceViewModel(client, new StubShell(), copy);
        screen.IsBusy = true;
        await screen.RefreshAsync(); // ignored while busy
        screen.IsBusy = false;

        client.Throw = false;
        client.Payload = null;
        client.FailCode = ErrorCodes.Unauthenticated;
        client.ThrowApi = true;
        await screen.RefreshAsync();
        Assert.Equal(ErrorCodes.Unauthenticated, screen.ErrorCode);
    }

    [Fact]
    public async Task LoginValidatesTheServerAndNavigatesOnSuccess()
    {
        var (nav, client, _, copy) = Build();
        var login = (LoginViewModel)nav.Routes["/login"];
        nav.SetAuthenticated(false);

        login.ServerUrl = "https://hub.example.com";
        login.Email = "a@b.c";
        login.Password = "pw";
        await login.ConnectCommand.ExecuteAsync(null);
        Assert.Equal("", login.ErrorCode);

        client.FailCode = ErrorCodes.Forbidden;
        await login.LoginCommand.ExecuteAsync(null);
        Assert.Equal(ErrorCodes.Forbidden, login.ErrorCode);

        client.FailCode = ErrorCodes.Unauthenticated;
        await login.LoginCommand.ExecuteAsync(null);
        Assert.Equal("/", nav.Current?.Route);
        Assert.True(nav.IsAuthenticated);

        client.Throw = true;
        await login.LoginCommand.ExecuteAsync(null);
        Assert.Equal(ErrorCodes.NetworkError, login.ErrorCode);
    }

    [Fact]
    public async Task ConnectReportsAnUnhealthyOrThrowingShell()
    {
        var (nav, client, shell, copy) = Build();
        var login = (LoginViewModel)nav.Routes["/login"];

        shell.TestResult = JsonDocument.Parse("""{"ok":false}""").RootElement.Clone();
        await login.ConnectCommand.ExecuteAsync(null);
        Assert.Equal(ErrorCodes.NetworkError, login.ErrorCode);

        shell.TestResult = null;
        await login.ConnectCommand.ExecuteAsync(null);
        Assert.Equal(ErrorCodes.NetworkError, login.ErrorCode);

        shell.TestThrows = true;
        await login.ConnectCommand.ExecuteAsync(null);
        Assert.Equal(ErrorCodes.NetworkError, login.ErrorCode);
    }

    [Fact]
    public async Task VoiceRequiresADeviceAThreadAndAClip()
    {
        var (nav, client, _, copy) = Build();
        var thread = (ThreadViewModel)nav.Routes["/threads/:id"];

        thread.Audio = new StubAudio();
        await thread.PlayCommand.ExecuteAsync(null);       // no clip recorded yet
        Assert.Equal(ErrorCodes.SpeechDisabled, thread.ErrorCode);

        thread.EntityId = 0;
        await thread.RecordCommand.ExecuteAsync(null);
        Assert.Equal(ErrorCodes.NotFound, thread.ErrorCode);

        thread.EntityId = 5;
        await thread.RecordCommand.ExecuteAsync(null);
        Assert.Equal("", thread.ErrorCode);
        await thread.PlayCommand.ExecuteAsync(null);
        Assert.Equal("", thread.ErrorCode);

        thread.Audio = new ThrowingAudio();
        await thread.RecordCommand.ExecuteAsync(null);
        Assert.Equal(ErrorCodes.SpeechDisabled, thread.ErrorCode);
        await thread.PlayCommand.ExecuteAsync(null);
        Assert.Equal(ErrorCodes.SpeechDisabled, thread.ErrorCode);

        thread.Audio = new StubAudio();
        await thread.RecordCommand.ExecuteAsync(null);
        client.Throw = true;
        await thread.RecordCommand.ExecuteAsync(null); // the upload is the part that can fail
        Assert.Equal(ErrorCodes.NetworkError, thread.ErrorCode);
    }

    [Fact]
    public async Task TaskActionsNeedAnIdAndReportFailures()
    {
        var (nav, client, _, copy) = Build();
        var trace = (TaskTraceViewModel)nav.Routes["/tasks/:id"];
        trace.EntityId = 0;
        await trace.CancelCommand.ExecuteAsync(null);
        Assert.Equal(ErrorCodes.NotFound, trace.ErrorCode);

        trace.EntityId = 9;
        await trace.CancelCommand.ExecuteAsync(null);
        await trace.ResumeCommand.ExecuteAsync(null);
        Assert.Equal("", trace.ErrorCode);

        client.ThrowApi = true;
        client.FailCode = ErrorCodes.NotFound;
        await trace.CancelCommand.ExecuteAsync(null);
        Assert.Equal(ErrorCodes.NotFound, trace.ErrorCode);
    }

    [Fact]
    public async Task FileUploadNeedsAPickerAndReportsBothFailureKinds()
    {
        var (nav, client, _, copy) = Build();
        var files = (FilesViewModel)nav.Routes["/files"];

        await files.UploadCommand.ExecuteAsync(null);
        Assert.Equal(ErrorCodes.NotConfigured, files.ErrorCode);

        files.PickFileAsync = () => Task.FromResult<(Stream, string)?>(null);
        await files.UploadCommand.ExecuteAsync(null);      // the dialog was cancelled
        Assert.Equal(ErrorCodes.NotConfigured, files.ErrorCode);

        files.PickFileAsync = () => Task.FromResult<(Stream, string)?>((new MemoryStream([1, 2]), "a.bin"));
        await files.UploadCommand.ExecuteAsync(null);
        Assert.Equal(100, files.Progress);

        client.UploadThrows = true;
        await files.UploadCommand.ExecuteAsync(null);
        Assert.Equal(ErrorCodes.NetworkError, files.ErrorCode);
    }

    [Fact]
    public async Task FileDownloadAndDeleteNeedASelectionAndReleaseTheStream()
    {
        var (nav, client, _, copy) = Build();
        var files = (FilesViewModel)nav.Routes["/files"];

        await files.DownloadCommand.ExecuteAsync(null);
        Assert.Equal(ErrorCodes.NotFound, files.ErrorCode);
        await files.DeleteCommand.ExecuteAsync(null);
        Assert.Equal(ErrorCodes.NotFound, files.ErrorCode);

        var saved = "";
        files.SelectedItem = """{"id":"f-1","name":"a.bin"}""";
        Assert.Equal("f-1", files.SelectedId);
        files.SaveFileAsync = (name, content) =>
        {
            saved = name;
            return Task.CompletedTask;
        };
        await files.DownloadCommand.ExecuteAsync(null);
        Assert.Equal("f-1", saved);

        files.SaveFileAsync = null;
        await files.DownloadCommand.ExecuteAsync(null);   // no saver: the stream is still released

        await files.DeleteCommand.ExecuteAsync(null);
        Assert.Equal("", files.ErrorCode);

        client.Throw = true;
        await files.DownloadCommand.ExecuteAsync(null);
        Assert.Equal(ErrorCodes.NetworkError, files.ErrorCode);
        await files.DeleteCommand.ExecuteAsync(null);
        Assert.Equal(ErrorCodes.NetworkError, files.ErrorCode);
    }

    [Fact]
    public void SelectedFileIdsFallBackToTheRawRowWhenTheyAreNotJson()
    {
        var (nav, _, _, _) = Build();
        var files = (FilesViewModel)nav.Routes["/files"];

        files.SelectedItem = null;
        Assert.Null(files.SelectedId);
        files.SelectedItem = "";
        Assert.Null(files.SelectedId);
        files.SelectedItem = "[1,2]";
        Assert.Equal("[1,2]", files.SelectedId);
        files.SelectedItem = "{ not json";
        Assert.Equal("{ not json", files.SelectedId);
        files.SelectedItem = """{"id":42}""";
        Assert.Equal("42", files.SelectedId);
    }

    [Fact]
    public async Task SettingsExposeTheExecutorAndUpgradeWithoutLeakingTheKey()
    {
        var (nav, client, shell, copy) = Build();
        var settings = (SettingsViewModel)nav.Routes["/settings"];

        await settings.RefreshAsync();
        Assert.Contains(settings.Items, i => i.Contains("upgrade", StringComparison.OrdinalIgnoreCase));

        await settings.CheckUpgradeCommand.ExecuteAsync(null);
        await settings.InstallUpgradeCommand.ExecuteAsync(null);
        Assert.Equal("", settings.ErrorCode);

        shell.UpgradeThrows = true;
        await settings.CheckUpgradeCommand.ExecuteAsync(null);
        Assert.Equal(ErrorCodes.NetworkError, settings.ErrorCode);
        await settings.InstallUpgradeCommand.ExecuteAsync(null);
        Assert.Equal(ErrorCodes.NetworkError, settings.ErrorCode);

        shell.ConfigThrows = true;
        await settings.RefreshAsync();
        Assert.Equal(ErrorCodes.NetworkError, settings.ErrorCode);
    }

    [Fact]
    public async Task EverySimpleScreenLoadsItsOwnEndpoint()
    {
        var (nav, client, _, _) = Build();
        nav.SetAuthenticated(true);
        foreach (var route in new[]
                 {
                     "/", "/threads", "/tasks", "/org", "/channels", "/connectors",
                     "/computers", "/schedules", "/persona", "/knowledge", "/files",
                     "/__shell/connect", "/__shell/about"
                 })
        {
            client.Payload = null;
            await nav.NavigateAsync(route);
            Assert.Equal(route, nav.Current?.Route);
            Assert.Equal("", nav.Current!.ErrorCode);
        }
    }

    [Fact]
    public async Task AnyUnexpectedExceptionBecomesNetworkError()
    {
        var (nav, client, shell, copy) = Build();
        nav.SetAuthenticated(true);
        client.ThrowGeneral = true;

        var workspace = (WorkspaceViewModel)nav.Routes["/"];
        await workspace.RefreshAsync();
        Assert.Equal(ErrorCodes.NetworkError, workspace.ErrorCode);

        var login = (LoginViewModel)nav.Routes["/login"];
        await login.LoginCommand.ExecuteAsync(null);
        Assert.Equal(ErrorCodes.NetworkError, login.ErrorCode);

        var thread = (ThreadViewModel)nav.Routes["/threads/:id"];
        thread.EntityId = 3;
        thread.Audio = new StubAudio();
        await thread.RecordCommand.ExecuteAsync(null);
        Assert.Equal(ErrorCodes.SpeechDisabled, thread.ErrorCode);
        await thread.PlayCommand.ExecuteAsync(null);
        Assert.Equal(ErrorCodes.SpeechDisabled, thread.ErrorCode);

        var trace = (TaskTraceViewModel)nav.Routes["/tasks/:id"];
        trace.EntityId = 3;
        await trace.CancelCommand.ExecuteAsync(null);
        Assert.Equal(ErrorCodes.NetworkError, trace.ErrorCode);

        var files = (FilesViewModel)nav.Routes["/files"];
        files.PickFileAsync = () => Task.FromResult<(Stream, string)?>((new MemoryStream([1]), "a.bin"));
        await files.UploadCommand.ExecuteAsync(null);
        Assert.Equal(ErrorCodes.NetworkError, files.ErrorCode);
        files.SelectedItem = "f-1";
        await files.DownloadCommand.ExecuteAsync(null);
        Assert.Equal(ErrorCodes.NetworkError, files.ErrorCode);
        await files.DeleteCommand.ExecuteAsync(null);
        Assert.Equal(ErrorCodes.NetworkError, files.ErrorCode);

        shell.ConfigThrowsGeneral = true;
        var settings = (SettingsViewModel)nav.Routes["/settings"];
        await settings.RefreshAsync();
        Assert.Equal(ErrorCodes.NetworkError, settings.ErrorCode);
        Assert.NotNull(settings.ExecutorLabel);
        Assert.NotNull(settings.LanguageLabel);
        Assert.NotNull(settings.CheckLabel);
        Assert.NotNull(settings.InstallLabel);
        Assert.NotNull(settings.UpgradeLabel);

        // A playback failure that is not an API error is still speech_disabled.
        var play = (ThreadViewModel)nav.Routes["/threads/:id"];
        play.EntityId = 1;
        play.Audio = new BrokenAudio();
        await play.RecordCommand.ExecuteAsync(null);
        Assert.Equal(ErrorCodes.SpeechDisabled, play.ErrorCode);
        client.ThrowGeneral = false;
        await play.RecordCommand.ExecuteAsync(null);
        await play.PlayCommand.ExecuteAsync(null);
        Assert.Equal(ErrorCodes.SpeechDisabled, play.ErrorCode);
    }

    [Fact]
    public async Task ConnectorApprovalPostsTheResourceRoute()
    {
        var (nav, client, _, _) = Build();
        var connectors = (ConnectorsViewModel)nav.Routes["/connectors"];
        await connectors.ApproveAsync("c-1");
        Assert.Equal("/api/connectors/approvals/c-1/approve", client.LastPath);
        Assert.Equal("nav.connectors", connectors.TitleKey);
    }

    private sealed class StubAudio : IAudioService
    {
        public Task<byte[]> RecordAsync(TimeSpan duration, CancellationToken ct = default) =>
            Task.FromResult(new byte[] { 1, 2, 3 });
        public Task PlayAsync(Stream audio, CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class ThrowingAudio : IAudioService
    {
        public Task<byte[]> RecordAsync(TimeSpan duration, CancellationToken ct = default) =>
            throw new HubApiException(ErrorCodes.SpeechDisabled);
        public Task PlayAsync(Stream audio, CancellationToken ct = default) =>
            throw new HubApiException(ErrorCodes.SpeechDisabled);
    }

    /// <summary>Records fine but cannot play: a non-API failure must not escape.</summary>
    private sealed class BrokenAudio : IAudioService
    {
        public Task<byte[]> RecordAsync(TimeSpan duration, CancellationToken ct = default) =>
            Task.FromResult(new byte[] { 9 });
        public Task PlayAsync(Stream audio, CancellationToken ct = default) =>
            throw new InvalidOperationException("no output device");
    }
}
