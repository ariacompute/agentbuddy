using System.Globalization;
using AgentBuddy.App.ViewModels;
using AgentBuddy.Core.Contracts;
using AgentBuddy.Core.Gateway;
using AgentBuddy.Core.Services;
using AgentBuddy.Shell;
using AgentBuddy.Shell.Credentials;
using AgentBuddy.Shell.Executor;
using AgentBuddy.Shell.Loopback;
using AgentBuddy.Shell.Notifications;
using AgentBuddy.Shell.Tray;
using AgentBuddy.Shell.Upgrade;

namespace AgentBuddy.App;

/// <summary>Composition root: builds the headless shell, the gateway, then the UI services.</summary>
public static class Composition
{
    public static bool Initialized { get; private set; }
    public static ShellServices Services { get; private set; } = null!;
    public static LoopbackGateway GatewayHost { get; private set; } = null!;
    public static IAgentHubClient Hub { get; private set; } = null!;
    public static IShellControl Control { get; private set; } = null!;
    public static NavigationService Navigation { get; private set; } = null!;
    public static ShellViewModel Shell { get; private set; } = null!;
    public static SystemNotifier NotifierImpl { get; private set; } = null!;
    public static MonitorService? Monitor { get; private set; }
    public static RealtimeService? Realtime { get; private set; }
    private static long _lastRefreshMs;
    private static int _windowVisible = 1;
    private static bool IsWindowVisible => Volatile.Read(ref _windowVisible) != 0;
    private static readonly object ShutdownGate = new();
    private static Task? _shutdown;
    private static Action<string>? _entityStreamHook;

    public static Task InitializeAsync(CancellationToken ct = default) => InitializeAsync(new AppPaths(), ct);

    /// <summary>
    /// Test entry point: the paths are injected so a test run never reads or writes the
    /// real user profile. The public overload uses <see cref="AppPaths"/> defaults.
    /// </summary>
    internal static async Task InitializeAsync(IAppPaths paths, CancellationToken ct = default)
    {
        if (Initialized) return;
        var config = new ConfigService(paths);
        await config.LoadAsync(ct).ConfigureAwait(false);

        var copy = new LocalizationService();
        copy.SetLang(string.IsNullOrEmpty(config.Current.Lang)
            ? LanguageCodes.Match(CultureInfo.CurrentUICulture.Name)
            : config.Current.Lang);

        var credentials = new CredentialStore(paths);
        var tray = new TrayService(copy);
        NotifierImpl = new SystemNotifier();
        var deepLinks = new DeepLinkQueue();
        var executor = new ExecutorService(credentials);
        var version = typeof(Composition).Assembly.GetName().Version?.ToString(3) ?? "0.1.0";

        var updateHttp = new HttpClient { Timeout = Timeout.InfiniteTimeSpan };
        var upgrade = new UpgradeService(new SourceRace(updateHttp), new HttpReleaseDownloader(updateHttp),
            new MinisignVerifier(), new PlatformUpgradeInstaller(), config, version, UpdaterKeys.PublicKey);

        Services = new ShellServices
        {
            Config = config,
            Copy = copy,
            Credentials = credentials,
            Tray = tray,
            Notifier = NotifierImpl,
            DeepLinks = deepLinks,
            Executor = executor,
            Upgrade = upgrade,
            Paths = paths,
            Version = version
        };

        GatewayHost = new LoopbackGateway(Services);
        var baseAddress = await GatewayHost.StartAsync(ct).ConfigureAwait(false);
        Hub = new AgentHubClient(baseAddress, GatewayHost.Token);
        Control = new ShellControlClient(baseAddress, GatewayHost.Token);
        Navigation = new NavigationService();
        Shell = new ShellViewModel(Navigation, copy, Control, version)
        {
            ConsumeDeepLink = () => deepLinks.Consume()
        };

        var entry = new LoginViewModel(Hub, Control, copy, Navigation);
        Navigation.Register("/login", entry);
        Navigation.Register("/", new WorkspaceViewModel(Hub, Control, copy));
        Navigation.Register("/threads", new ThreadListViewModel(Hub, Control, copy));
        Navigation.Register("/threads/:id", new ThreadViewModel(Hub, Control, copy));
        Navigation.Register("/tasks", new TaskListViewModel(Hub, Control, copy));
        Navigation.Register("/tasks/:id", new TaskTraceViewModel(Hub, Control, copy));
        Navigation.Register("/org", new OrgViewModel(Hub, Control, copy));
        Navigation.Register("/channels", new ChannelsViewModel(Hub, Control, copy));
        Navigation.Register("/connectors", new ConnectorsViewModel(Hub, Control, copy));
        Navigation.Register("/settings", new SettingsViewModel(Hub, Control, copy));
        Navigation.Register("/computers", new ComputersViewModel(Hub, Control, copy));
        Navigation.Register("/schedules", new SchedulesViewModel(Hub, Control, copy));
        Navigation.Register("/persona", new PersonaViewModel(Hub, Control, copy));
        Navigation.Register("/knowledge", new KnowledgeViewModel(Hub, Control, copy));
        Navigation.Register("/files", new FilesViewModel(Hub, Control, copy));
        Navigation.Register("/__shell/connect", new ConnectViewModel(Hub, Control, copy));
        Navigation.Register("/__shell/about", new AboutViewModel(Hub, Control, copy));

        copy.LanguageChanged += lang => tray.Refresh(lang);
        tray.BadgeChanged += count => Shell.MarkUnread(count);

        try
        {
            await Hub.SendAsync(Endpoints.WhoAmI, HttpMethod.Get, null, ct).ConfigureAwait(false);
            Navigation.SetAuthenticated(true);
        }
        catch (Exception) { Navigation.SetAuthenticated(false); }

        var first = string.IsNullOrEmpty(config.Current.ServerUrl) ? "/__shell/connect" : "/";
        await Navigation.NavigateAsync(first).ConfigureAwait(false);

        Monitor = new MonitorService(Hub, Control, copy, () => IsWindowVisible);
        await Monitor.StartAsync(ct).ConfigureAwait(false);

        Realtime = new RealtimeService(Hub, () => IsWindowVisible);
        Realtime.EventReceived += OnRealtimeEvent;
        _entityStreamHook = path =>
            FireAndForget(Realtime?.SwitchEntityStreamAsync(path) ?? Task.CompletedTask);
        Navigation.EntityStreamChanged += _entityStreamHook;
        await Realtime.StartAsync(ct).ConfigureAwait(false);
        Initialized = true;
    }

    /// <summary>
    /// Incremental UI updates: at most one aggregate refresh per second, so a burst of
    /// events cannot turn into N+1 requests. Badge and notification work stays in the
    /// poller; nothing here blocks the SSE pump.
    /// </summary>
    /// <summary>Internal so the once-per-second aggregation can be asserted directly.</summary>
    internal static void OnRealtimeEvent(HubEvent item)
    {
        var now = Environment.TickCount64;
        var last = Interlocked.Read(ref _lastRefreshMs);
        if (now - last < 1000) return;
        if (Interlocked.CompareExchange(ref _lastRefreshMs, now, last) != last) return;

        FireAndForget(Monitor?.PollOnceAsync(CancellationToken.None) ?? Task.CompletedTask);
        Avalonia.Threading.Dispatcher.UIThread.Post(() =>
            Shell.Navigation.Current?.RefreshCommand.Execute(null));
    }

    private static void FireAndForget(Task task) =>
        _ = task.ContinueWith(static t => _ = t.Exception, TaskContinuationOptions.OnlyOnFaulted);

    /// <summary>Wires window-only capabilities after Avalonia has created the main window.</summary>
    public static void AttachWindow(Avalonia.Controls.Window window,
        Avalonia.Controls.ApplicationLifetimes.IClassicDesktopStyleApplicationLifetime desktop)
    {
        Services.Navigate = route => Navigation.NavigateAsync(route);
        Services.HideWindow = () =>
        {
            Avalonia.Threading.Dispatcher.UIThread.Post(window.Hide);
            return Task.CompletedTask;
        };
        Services.Quit = () => QuitAsync(desktop);
        NotifierImpl.SetInAppHandler((title, body, link) =>
        {
            Avalonia.Threading.Dispatcher.UIThread.Post(() => Shell.AddNotification(title, body, link));
            return Task.FromResult(true);
        });
        Volatile.Write(ref _windowVisible, window.IsVisible ? 1 : 0);
        window.PropertyChanged += (_, e) =>
        {
            if (e.Property == Avalonia.Visual.IsVisibleProperty)
                Volatile.Write(ref _windowVisible, window.IsVisible ? 1 : 0);
        };
        window.FlowDirection = Services.Copy.IsRtl
            ? Avalonia.Media.FlowDirection.RightToLeft
            : Avalonia.Media.FlowDirection.LeftToRight;
        Services.Copy.LanguageChanged += _ => window.FlowDirection = Services.Copy.IsRtl
            ? Avalonia.Media.FlowDirection.RightToLeft
            : Avalonia.Media.FlowDirection.LeftToRight;
        ReducedMotionService.Apply(window);
        AttachDesktopCapabilities(window);
    }

    /// <summary>
    /// Window-only capabilities are injected as delegates so the ViewModels stay
    /// headless-testable: native file pickers and the optional audio backend.
    /// </summary>
    private static void AttachDesktopCapabilities(Avalonia.Controls.Window window)
    {
        if (Navigation.Routes.TryGetValue("/threads/:id", out var threadRoute) &&
            threadRoute is ThreadViewModel thread)
            thread.Audio = new FfmpegAudioService();

        if (!Navigation.Routes.TryGetValue("/files", out var filesRoute) ||
            filesRoute is not FilesViewModel files) return;

        files.PickFileAsync = async () =>
        {
            var picked = await window.StorageProvider.OpenFilePickerAsync(
                new Avalonia.Platform.Storage.FilePickerOpenOptions { AllowMultiple = false }).ConfigureAwait(false);
            if (picked.Count == 0) return null;
            var stream = await picked[0].OpenReadAsync().ConfigureAwait(false);
            return (stream, picked[0].Name);
        };
        files.SaveFileAsync = async (name, content) =>
        {
            var target = await window.StorageProvider.SaveFilePickerAsync(
                new Avalonia.Platform.Storage.FilePickerSaveOptions { SuggestedFileName = name }).ConfigureAwait(false);
            if (target is null) return;
            await using var output = await target.OpenWriteAsync().ConfigureAwait(false);
            await content.CopyToAsync(output).ConfigureAwait(false);
        };
    }

    /// <summary>
    /// The only exit sequence: tear the session down, then let the lifetime stop. The tray's
    /// quit item and the window's close (background=false) both come through here, so the
    /// loopback host and the SSE pumps are released while the dispatcher still pumps —
    /// calling desktop.Shutdown() first would stop the loop and truncate the teardown.
    /// </summary>
    public static async Task QuitAsync(
        Avalonia.Controls.ApplicationLifetimes.IClassicDesktopStyleApplicationLifetime? desktop)
    {
        try { await ShutdownAsync().ConfigureAwait(true); }
        finally { desktop?.Shutdown(); }
    }

    /// <summary>
    /// Teardown is single-flight: every caller gets the same task, so a stray extra
    /// shutdown (window Closed after a tray quit, or two quits in a row) cannot dispose
    /// the gateway, the poller and the stream pumps twice.
    /// </summary>
    public static Task ShutdownAsync()
    {
        var started = Volatile.Read(ref _shutdown);
        if (started is not null) return started;
        lock (ShutdownGate) return _shutdown ??= ShutdownCoreAsync();
    }

    private static async Task ShutdownCoreAsync()
    {
        // Detach the UI hooks first: a navigation or an event arriving mid-teardown must not
        // re-open a stream on a client that is about to be disposed.
        if (Realtime is not null)
        {
            Realtime.EventReceived -= OnRealtimeEvent;
            if (_entityStreamHook is not null && Initialized)
                Navigation.EntityStreamChanged -= _entityStreamHook;
        }

        await StopAsync(Realtime).ConfigureAwait(false);
        await StopAsync(Monitor).ConfigureAwait(false);
        // Only a completed initialization owns a started gateway; a failure before that
        // point leaves the static property unassigned.
        await StopAsync(Initialized ? GatewayHost : null).ConfigureAwait(false);
    }

    /// <summary>
    /// Best-effort: one failing pump must not keep the loopback host (or the process) alive,
    /// and a partially initialized composition has nothing to stop at all.
    /// </summary>
    private static async Task StopAsync(IAsyncDisposable? target)
    {
        if (target is null) return;
        try { await target.DisposeAsync().ConfigureAwait(false); }
        catch (Exception) { /* teardown keeps going: the next step still has to run */ }
    }
}
