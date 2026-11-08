using System.Collections.ObjectModel;
using System.Text.Json;
using AgentBuddy.Core.Contracts;
using AgentBuddy.Core.Gateway;
using AgentBuddy.Core.Services;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;

namespace AgentBuddy.App.ViewModels;

public abstract class ViewModelBase(ILocalizationService copy) : ObservableObject
{
    protected ILocalizationService Copy { get; } = copy;
    private bool _isBusy;
    private string _errorCode = "";

    public bool IsBusy { get => _isBusy; set => SetProperty(ref _isBusy, value); }

    public string ErrorCode
    {
        get => _errorCode;
        set { if (SetProperty(ref _errorCode, value)) OnPropertyChanged(nameof(ErrorText)); }
    }

    /// <summary>Stores only the machine code; the text is resolved at display time.</summary>
    public string ErrorText
    {
        get
        {
            if (string.IsNullOrEmpty(ErrorCode)) return "";
            var key = ErrorCode switch
            {
                ErrorCodes.Unauthenticated => "errors.unauthenticated",
                ErrorCodes.Forbidden => "errors.forbidden",
                ErrorCodes.NotFound => "errors.notFound",
                ErrorCodes.NetworkError or ErrorCodes.Timeout => "errors.networkError",
                _ => "errors.internalError"
            };
            return Copy.Get(key) + " (" + ErrorCode + ")";
        }
    }
}

/// <summary>
/// One per screen. Every screen declares the exact endpoint constants it uses;
/// tests/AgentBuddy.Guards asserts no frozen constant is left unwired.
/// </summary>
/// <summary>Detail screens receive the numeric id parsed from the route.</summary>
public interface IEntityScreen
{
    long EntityId { get; set; }
}

public abstract class ScreenViewModel : ViewModelBase
{
    protected readonly IAgentHubClient Hub;
    protected readonly IShellControl Control;

    protected ScreenViewModel(IAgentHubClient hub, IShellControl control, ILocalizationService copy,
        string route, string[] endpoints) : base(copy)
    {
        Hub = hub;
        Control = control;
        Route = route;
        EndpointsUsed = endpoints;
        RefreshCommand = new AsyncRelayCommand(RefreshAsync);
    }

    public string Route { get; }
    public IReadOnlyList<string> EndpointsUsed { get; }
    public abstract string TitleKey { get; }
    public string Title => Copy.Get(TitleKey);
    public string RefreshLabel => Copy.Get("action.refresh");
    public ObservableCollection<string> Items { get; } = [];
    public IAsyncRelayCommand RefreshCommand { get; }

    public async Task RefreshAsync()
    {
        if (IsBusy) return;
        IsBusy = true;
        ErrorCode = "";
        try { Fill(await LoadAsync(CancellationToken.None).ConfigureAwait(false)); }
        catch (HubApiException error) { ErrorCode = error.Code; }
        catch (Exception) { ErrorCode = ErrorCodes.NetworkError; }
        finally { IsBusy = false; }
    }

    protected abstract Task<JsonElement?> LoadAsync(CancellationToken ct);

    protected virtual void Fill(JsonElement? data)
    {
        Items.Clear();
        if (data is null) return;
        if (data.Value.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in data.Value.EnumerateArray()) Items.Add(item.ToString());
        }
        else if (data.Value.ValueKind == JsonValueKind.Object)
        {
            foreach (var property in data.Value.EnumerateObject())
                Items.Add(property.Name + ": " + property.Value.ToString());
        }
    }
}

public sealed class LoginViewModel : ScreenViewModel
{
    private readonly NavigationService _navigation;
    private string _email = "";
    private string _password = "";
    private string _serverUrl = Gateway.DefaultServerUrl;

    public LoginViewModel(IAgentHubClient hub, IShellControl control, ILocalizationService copy, NavigationService navigation)
        : base(hub, control, copy, "/login",
            [Endpoints.AuthConfig, Endpoints.Register, Endpoints.Login, Endpoints.Logout, Endpoints.WhoAmI, Endpoints.Health])
    {
        _navigation = navigation;
        LoginCommand = new AsyncRelayCommand(SignInAsync);
        ConnectCommand = new AsyncRelayCommand(TestConnectionAsync);
    }

    public override string TitleKey => "action.connect";
    public string LoginLabel => Copy.Get("action.login");
    public string ServerLabel => Copy.Get("shell.serverUrl");
    public string EmailLabel => Copy.Get("shell.email");
    public string PasswordLabel => Copy.Get("shell.password");

    public string Email { get => _email; set => SetProperty(ref _email, value); }
    public string Password { get => _password; set => SetProperty(ref _password, value); }
    public string ServerUrl { get => _serverUrl; set => SetProperty(ref _serverUrl, value); }
    public IAsyncRelayCommand LoginCommand { get; }
    public IAsyncRelayCommand ConnectCommand { get; }

    protected override Task<JsonElement?> LoadAsync(CancellationToken ct) =>
        Hub.SendAsync(Endpoints.AuthConfig, HttpMethod.Get, null, ct);

    private async Task SignInAsync()
    {
        IsBusy = true;
        ErrorCode = "";
        try
        {
            await Hub.SendAsync(Endpoints.Login, HttpMethod.Post, new { email = Email, password = Password })
                .ConfigureAwait(false);
            _navigation.SetAuthenticated(true);
            await _navigation.NavigateAsync("/").ConfigureAwait(false);
        }
        catch (HubApiException error) { ErrorCode = error.Code; }
        catch (Exception) { ErrorCode = ErrorCodes.NetworkError; }
        finally { IsBusy = false; }
    }

    private async Task TestConnectionAsync()
    {
        try
        {
            var result = await Control.TestConnectionAsync(ServerUrl).ConfigureAwait(false);
            ErrorCode = result is { ValueKind: JsonValueKind.Object } &&
                        result.Value.TryGetProperty("ok", out var ok) && ok.GetBoolean()
                ? "" : ErrorCodes.NetworkError;
        }
        catch (Exception) { ErrorCode = ErrorCodes.NetworkError; }
    }
}

public sealed class WorkspaceViewModel(IAgentHubClient hub, IShellControl control, ILocalizationService copy)
    : ScreenViewModel(hub, control, copy, "/", [Endpoints.Workspace])
{
    public override string TitleKey => "nav.workspace";
    protected override Task<JsonElement?> LoadAsync(CancellationToken ct) =>
        Hub.SendAsync(Endpoints.Workspace, HttpMethod.Get, null, ct);
}

public sealed class ThreadListViewModel(IAgentHubClient hub, IShellControl control, ILocalizationService copy)
    : ScreenViewModel(hub, control, copy, "/threads", [Endpoints.Threads, Endpoints.ThreadById])
{
    public override string TitleKey => "nav.threads";
    protected override Task<JsonElement?> LoadAsync(CancellationToken ct) =>
        Hub.SendAsync(Endpoints.Threads, HttpMethod.Get, null, ct);
}

public sealed class ThreadViewModel : ScreenViewModel, IEntityScreen
{
    private byte[]? _lastClip;

    public ThreadViewModel(IAgentHubClient hub, IShellControl control, ILocalizationService copy)
        : base(hub, control, copy, "/threads/:id",
            [Endpoints.ThreadMessages, Endpoints.ThreadEvents, Endpoints.ThreadAudio])
    {
        RecordCommand = new AsyncRelayCommand(RecordVoiceAsync);
        PlayCommand = new AsyncRelayCommand(PlayVoiceAsync);
    }

    public override string TitleKey => "nav.threads";
    public long EntityId { get; set; }
    public IAudioService? Audio { get; set; }
    public string RecordLabel => Copy.Get("voice.record");
    public string PlayLabel => Copy.Get("voice.play");
    public IAsyncRelayCommand RecordCommand { get; }
    public IAsyncRelayCommand PlayCommand { get; }

    protected override Task<JsonElement?> LoadAsync(CancellationToken ct) =>
        Hub.SendAsync(Endpoints.ThreadMessages, HttpMethod.Get, null, ct);

    public Task<JsonElement?> SendAudioAsync(long threadId, Stream audio, CancellationToken ct = default) =>
        Hub.PostAudioAsync(threadId, audio, ct);

    private async Task RecordVoiceAsync()
    {
        if (Audio is null) { ErrorCode = ErrorCodes.SpeechDisabled; return; }
        if (EntityId <= 0) { ErrorCode = ErrorCodes.NotFound; return; }
        IsBusy = true;
        ErrorCode = "";
        try
        {
            _lastClip = await Audio.RecordAsync(TimeSpan.FromSeconds(10)).ConfigureAwait(false);
            using var clip = new MemoryStream(_lastClip);
            await SendAudioAsync(EntityId, clip).ConfigureAwait(false);
            await RefreshAsync().ConfigureAwait(false);
        }
        catch (HubApiException error) { ErrorCode = error.Code; }
        catch (Exception) { ErrorCode = ErrorCodes.SpeechDisabled; }
        finally { IsBusy = false; }
    }

    private async Task PlayVoiceAsync()
    {
        if (Audio is null || _lastClip is null) { ErrorCode = ErrorCodes.SpeechDisabled; return; }
        try
        {
            using var clip = new MemoryStream(_lastClip);
            await Audio.PlayAsync(clip).ConfigureAwait(false);
        }
        catch (HubApiException error) { ErrorCode = error.Code; }
        catch (Exception) { ErrorCode = ErrorCodes.SpeechDisabled; }
    }
}

public sealed class TaskListViewModel(IAgentHubClient hub, IShellControl control, ILocalizationService copy)
    : ScreenViewModel(hub, control, copy, "/tasks", [Endpoints.Tasks, Endpoints.TaskById])
{
    public override string TitleKey => "nav.tasks";
    protected override Task<JsonElement?> LoadAsync(CancellationToken ct) =>
        Hub.SendAsync(Endpoints.Tasks, HttpMethod.Get, null, ct);
}

public sealed class TaskTraceViewModel : ScreenViewModel, IEntityScreen
{
    public TaskTraceViewModel(IAgentHubClient hub, IShellControl control, ILocalizationService copy)
        : base(hub, control, copy, "/tasks/:id",
            [Endpoints.TaskCancel, Endpoints.TaskResume, Endpoints.TaskEvents])
    {
        CancelCommand = new AsyncRelayCommand(() => ActAsync(Endpoints.TaskCancel));
        ResumeCommand = new AsyncRelayCommand(() => ActAsync(Endpoints.TaskResume));
    }

    public override string TitleKey => "nav.tasks";
    public long EntityId { get; set; }
    public string CancelLabel => Copy.Get("action.cancel");
    public string RetryLabel => Copy.Get("action.retry");
    public IAsyncRelayCommand CancelCommand { get; }
    public IAsyncRelayCommand ResumeCommand { get; }

    protected override Task<JsonElement?> LoadAsync(CancellationToken ct) =>
        Hub.SendAsync(Endpoints.TaskEvents, HttpMethod.Get, null, ct);

    private async Task ActAsync(string template)
    {
        if (EntityId <= 0) { ErrorCode = ErrorCodes.NotFound; return; }
        try
        {
            await Hub.SendAsync(Endpoints.Format(template, ("id", EntityId)), HttpMethod.Post, null)
                .ConfigureAwait(false);
            await RefreshAsync().ConfigureAwait(false);
        }
        catch (HubApiException error) { ErrorCode = error.Code; }
        catch (Exception) { ErrorCode = ErrorCodes.NetworkError; }
    }
}

public sealed class OrgViewModel(IAgentHubClient hub, IShellControl control, ILocalizationService copy)
    : ScreenViewModel(hub, control, copy, "/org", [Endpoints.Resources, Endpoints.ResourceById])
{
    public override string TitleKey => "nav.org";
    protected override Task<JsonElement?> LoadAsync(CancellationToken ct) =>
        Hub.SendAsync(Endpoints.Resources, HttpMethod.Get, null, ct);
}

public sealed class ChannelsViewModel(IAgentHubClient hub, IShellControl control, ILocalizationService copy)
    : ScreenViewModel(hub, control, copy, "/channels",
        [Endpoints.Channels, Endpoints.ChannelById, Endpoints.ChannelDeliveries, Endpoints.ChannelDeliveryRetry])
{
    public override string TitleKey => "nav.channels";
    protected override Task<JsonElement?> LoadAsync(CancellationToken ct) =>
        Hub.SendAsync(Endpoints.Channels, HttpMethod.Get, null, ct);
}

public sealed class ConnectorsViewModel(IAgentHubClient hub, IShellControl control, ILocalizationService copy)
    : ScreenViewModel(hub, control, copy, "/connectors",
        [Endpoints.Connectors, Endpoints.ConnectorPolicy, Endpoints.ConnectorActions,
         Endpoints.ConnectorApprovals, Endpoints.ConnectorApprovalApprove, Endpoints.ConnectorApprovalReject])
{
    public override string TitleKey => "nav.connectors";
    protected override Task<JsonElement?> LoadAsync(CancellationToken ct) =>
        Hub.SendAsync(Endpoints.Connectors, HttpMethod.Get, null, ct);

    public Task<JsonElement?> ApproveAsync(string id, CancellationToken ct = default) =>
        Hub.SendAsync(Endpoints.Format(Endpoints.ConnectorApprovalApprove, ("id", id)), HttpMethod.Post, null, ct);
}

public sealed class ComputersViewModel(IAgentHubClient hub, IShellControl control, ILocalizationService copy)
    : ScreenViewModel(hub, control, copy, "/computers",
        [Endpoints.Computers, Endpoints.ComputerById, Endpoints.SandboxStats, Endpoints.Sandboxes,
         Endpoints.SandboxById, Endpoints.SandboxExec, Endpoints.SandboxRenew, Endpoints.SandboxEvents,
         Endpoints.SandboxProviders, Endpoints.SandboxProvidersRefresh, Endpoints.SandboxNodes,
         Endpoints.SandboxNodeHeartbeat, Endpoints.SandboxNodeJobs, Endpoints.SandboxNodeJobById])
{
    public override string TitleKey => "nav.computers";
    protected override Task<JsonElement?> LoadAsync(CancellationToken ct) =>
        Hub.SendAsync(Endpoints.SandboxStats, HttpMethod.Get, null, ct);
}

public sealed class SchedulesViewModel(IAgentHubClient hub, IShellControl control, ILocalizationService copy)
    : ScreenViewModel(hub, control, copy, "/schedules",
        [Endpoints.Schedules, Endpoints.ScheduleById, Endpoints.ScheduleRun,
         Endpoints.RouterStats, Endpoints.RouterTriggers, Endpoints.RouterTriggerById,
         Endpoints.RouterTickets, Endpoints.RouterTicketById, Endpoints.RouterTicketCancel,
         Endpoints.RouterTicketHandback, Endpoints.RouterThreadSubscription, Endpoints.RouterPolicies,
         Endpoints.RouterPolicyBySource, Endpoints.RouterPasses, Endpoints.RouterEvents])
{
    public override string TitleKey => "nav.schedules";
    protected override Task<JsonElement?> LoadAsync(CancellationToken ct) =>
        Hub.SendAsync(Endpoints.Schedules, HttpMethod.Get, null, ct);
}

public sealed class PersonaViewModel(IAgentHubClient hub, IShellControl control, ILocalizationService copy)
    : ScreenViewModel(hub, control, copy, "/persona", [Endpoints.Workspace])
{
    public override string TitleKey => "nav.persona";
    protected override Task<JsonElement?> LoadAsync(CancellationToken ct) =>
        Hub.SendAsync(Endpoints.Workspace, HttpMethod.Get, null, ct);
}

public sealed class KnowledgeViewModel(IAgentHubClient hub, IShellControl control, ILocalizationService copy)
    : ScreenViewModel(hub, control, copy, "/knowledge", [Endpoints.Knowledge])
{
    public override string TitleKey => "nav.knowledge";
    protected override Task<JsonElement?> LoadAsync(CancellationToken ct) =>
        Hub.SendAsync(Endpoints.Knowledge, HttpMethod.Get, null, ct);
}

public sealed class FilesViewModel : ScreenViewModel
{
    private int _progress;
    private string? _selectedId;
    private string? _selectedItem;

    public FilesViewModel(IAgentHubClient hub, IShellControl control, ILocalizationService copy)
        : base(hub, control, copy, "/files", [Endpoints.Files, Endpoints.FileById, Endpoints.FileContent])
    {
        UploadCommand = new AsyncRelayCommand(UploadPickedFileAsync);
        DownloadCommand = new AsyncRelayCommand(DownloadSelectedAsync);
        DeleteCommand = new AsyncRelayCommand(DeleteSelectedAsync);
    }

    public override string TitleKey => "nav.files";
    public string UploadLabel => Copy.Get("action.upload");
    public string DownloadLabel => Copy.Get("action.download");
    public string DeleteLabel => Copy.Get("action.delete");
    public IAsyncRelayCommand UploadCommand { get; }
    public IAsyncRelayCommand DownloadCommand { get; }
    public IAsyncRelayCommand DeleteCommand { get; }

    /// <summary>Injected by the window: native file pickers never live in a ViewModel.</summary>
    public Func<Task<(Stream Content, string Name)?>>? PickFileAsync { get; set; }
    public Func<string, Stream, Task>? SaveFileAsync { get; set; }

    public int Progress { get => _progress; private set => SetProperty(ref _progress, value); }
    public string? SelectedId { get => _selectedId; set => SetProperty(ref _selectedId, value); }

    /// <summary>The list holds raw JSON rows; extract the id before issuing a request.</summary>
    public string? SelectedItem
    {
        get => _selectedItem;
        set
        {
            if (!SetProperty(ref _selectedItem, value)) return;
            SelectedId = ExtractId(value);
        }
    }

    private static string? ExtractId(string? raw)
    {
        if (string.IsNullOrEmpty(raw)) return null;
        try
        {
            using var doc = JsonDocument.Parse(raw);
            if (doc.RootElement.ValueKind == JsonValueKind.Object &&
                doc.RootElement.TryGetProperty("id", out var id)) return id.ToString();
        }
        catch (JsonException) { }
        return raw;
    }

    protected override Task<JsonElement?> LoadAsync(CancellationToken ct) =>
        Hub.SendAsync(Endpoints.Files, HttpMethod.Get, null, ct);

    public Task<JsonElement?> UploadAsync(Stream content, string fileName, IProgress<int>? progress = null,
        CancellationToken ct = default) =>
        Hub.UploadAsync(Endpoints.Files, content, "file", fileName, progress, ct);

    public Task<Stream> DownloadAsync(string id, CancellationToken ct = default) =>
        Hub.DownloadAsync(Endpoints.Format(Endpoints.FileContent, ("id", id)), ct);

    private async Task UploadPickedFileAsync()
    {
        if (PickFileAsync is null) { ErrorCode = ErrorCodes.NotConfigured; return; }
        var picked = await PickFileAsync().ConfigureAwait(false);
        if (picked is null) return;
        await using var content = picked.Value.Content;
        Progress = 0;
        try
        {
            await UploadAsync(content, picked.Value.Name, new Progress<int>(p => Progress = p))
                .ConfigureAwait(false);
            Progress = 100;
            await RefreshAsync().ConfigureAwait(false);
        }
        catch (HubApiException error) { ErrorCode = error.Code; }
        catch (Exception) { ErrorCode = ErrorCodes.NetworkError; }
    }

    private async Task DownloadSelectedAsync()
    {
        if (string.IsNullOrEmpty(SelectedId)) { ErrorCode = ErrorCodes.NotFound; return; }
        try
        {
            var stream = await DownloadAsync(SelectedId).ConfigureAwait(false);
            if (SaveFileAsync is not null) await SaveFileAsync(SelectedId, stream).ConfigureAwait(false);
            else await stream.DisposeAsync().ConfigureAwait(false);
        }
        catch (HubApiException error) { ErrorCode = error.Code; }
        catch (Exception) { ErrorCode = ErrorCodes.NetworkError; }
    }

    private async Task DeleteSelectedAsync()
    {
        if (string.IsNullOrEmpty(SelectedId)) { ErrorCode = ErrorCodes.NotFound; return; }
        try
        {
            await Hub.SendAsync(Endpoints.Format(Endpoints.FileById, ("id", SelectedId)), HttpMethod.Delete, null)
                .ConfigureAwait(false);
            await RefreshAsync().ConfigureAwait(false);
        }
        catch (HubApiException error) { ErrorCode = error.Code; }
        catch (Exception) { ErrorCode = ErrorCodes.NetworkError; }
    }
}

public sealed class SettingsViewModel : ScreenViewModel
{
    public SettingsViewModel(IAgentHubClient hub, IShellControl control, ILocalizationService copy)
        : base(hub, control, copy, "/settings", [Endpoints.Health])
    {
        CheckUpgradeCommand = new AsyncRelayCommand(CheckAsync);
        InstallUpgradeCommand = new AsyncRelayCommand(InstallAsync);
    }

    public override string TitleKey => "nav.settings";
    public string UpgradeLabel => Copy.Get("shell.upgrade");
    public string CheckLabel => Copy.Get("upgrade.check");
    public string InstallLabel => Copy.Get("upgrade.install");
    public string ExecutorLabel => Copy.Get("shell.executor");
    public string LanguageLabel => Copy.Get("shell.language");
    public IAsyncRelayCommand CheckUpgradeCommand { get; }
    public IAsyncRelayCommand InstallUpgradeCommand { get; }

    private async Task CheckAsync()
    {
        try { await Control.CheckUpgradeAsync().ConfigureAwait(false); }
        catch (Exception) { ErrorCode = ErrorCodes.NetworkError; }
    }

    private async Task InstallAsync()
    {
        try { await Control.InstallUpgradeAsync().ConfigureAwait(false); }
        catch (Exception) { ErrorCode = ErrorCodes.NetworkError; }
    }

    protected override async Task<JsonElement?> LoadAsync(CancellationToken ct)
    {
        var view = await Control.GetConfigAsync(ct).ConfigureAwait(false);
        var upgrade = await Control.GetUpgradeAsync(ct).ConfigureAwait(false);
        return JsonSerializer.SerializeToElement(new { config = view, upgrade });
    }
}

public sealed class ConnectViewModel(IAgentHubClient hub, IShellControl control, ILocalizationService copy)
    : ScreenViewModel(hub, control, copy, "/__shell/connect", [Endpoints.Health])
{
    public override string TitleKey => "action.connect";
    protected override Task<JsonElement?> LoadAsync(CancellationToken ct) =>
        Hub.SendAsync(Endpoints.Health, HttpMethod.Get, null, ct);
}

public sealed class AboutViewModel(IAgentHubClient hub, IShellControl control, ILocalizationService copy)
    : ScreenViewModel(hub, control, copy, "/__shell/about", [Endpoints.Health])
{
    public override string TitleKey => "action.about";
    protected override Task<JsonElement?> LoadAsync(CancellationToken ct) =>
        Hub.SendAsync(Endpoints.Health, HttpMethod.Get, null, ct);
}
