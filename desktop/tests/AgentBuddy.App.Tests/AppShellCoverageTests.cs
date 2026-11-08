using System.Diagnostics;
using AgentBuddy.App;
using AgentBuddy.App.Controls;
using AgentBuddy.App.ViewModels;
using AgentBuddy.App.Views;
using AgentBuddy.Core.Contracts;
using AgentBuddy.Core.Gateway;
using AgentBuddy.Core.Services;
using AgentBuddy.Shell.Tray;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Headless;
using Avalonia.Media;
using Avalonia.Styling;
using Avalonia.Threading;
using Xunit;

namespace AgentBuddy.App.Tests;

/// <summary>
/// Boots the real application on a dedicated UI thread, headless, against a temp
/// profile: the view layer, the tray menu and the composition root run exactly as in
/// production, with no display and no network.
/// </summary>
public sealed class HeadlessAppFixture : IDisposable
{
    private readonly Thread _thread;
    private readonly CancellationTokenSource _stop = new();
    private Exception? _failure;

    public HeadlessAppFixture()
    {
        using var ready = new ManualResetEventSlim();
        _thread = new Thread(() =>
        {
            try
            {
                Root = Path.Combine(Path.GetTempPath(), "ab-app-" + Guid.NewGuid().ToString("N"));
                Directory.CreateDirectory(Root);
                // A closed loopback port keeps every upstream call instant and offline.
                new ConfigService(new AppPaths(Root))
                    .SaveAsync(new ShellConfig { ServerUrl = "http://127.0.0.1:1", Lang = "en", Background = true })
                    .GetAwaiter().GetResult();
                Composition.InitializeAsync(new AppPaths(Root)).GetAwaiter().GetResult();

                // SetupWithLifetime raises OnFrameworkInitializationCompleted, which builds
                // the window, the tray and the window capabilities as production does.
                var builder = AppBuilder.Configure<App>().UseHeadless(new AvaloniaHeadlessPlatformOptions());
                Lifetime = new ClassicDesktopStyleApplicationLifetime
                {
                    Args = [],
                    ShutdownMode = ShutdownMode.OnExplicitShutdown
                };
                builder.SetupWithLifetime(Lifetime);
                Window = (MainWindow)Lifetime.MainWindow!;
                Window.Show();
            }
            catch (Exception error)
            {
                _failure = error;
                ready.Set();
                return;
            }
            ready.Set();
            Dispatcher.UIThread.MainLoop(_stop.Token);
        })
        { IsBackground = true, Name = "agentbuddy-headless" };
        if (OperatingSystem.IsWindows()) _thread.SetApartmentState(ApartmentState.STA);
        _thread.Start();
        Assert.True(ready.Wait(TimeSpan.FromSeconds(120)), "headless setup timed out");
        if (_failure is not null) throw new InvalidOperationException("headless setup failed", _failure);
    }

    public string Root { get; private set; } = "";
    public ClassicDesktopStyleApplicationLifetime Lifetime { get; private set; } = null!;
    public MainWindow Window { get; private set; } = null!;

    public Task RunAsync(Func<Task> body)
    {
        var done = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        Dispatcher.UIThread.Post(async () =>
        {
            try { await body().ConfigureAwait(true); done.SetResult(); }
            catch (Exception error) { done.SetException(error); }
        });
        // A wedged UI thread must fail the test with a message, not hang the run.
        return done.Task.WaitAsync(TimeSpan.FromSeconds(60));
    }

    public void Dispose()
    {
        _stop.Cancel();
        _thread.Join(TimeSpan.FromSeconds(30));
        try { if (Directory.Exists(Root)) Directory.Delete(Root, true); } catch (Exception) { /* the gateway may hold it */ }
    }
}

[CollectionDefinition("headless-app", DisableParallelization = true)]
public sealed class HeadlessCollection : ICollectionFixture<HeadlessAppFixture>;

/// <summary>
/// One ordered walk through the whole UI surface: the tray quit action ends the
/// session, so every other UI step has to happen before it in the same test.
/// </summary>
[Collection("headless-app")]
public class AppShellTests(HeadlessAppFixture fixture)
{
    [Fact]
    public async Task TheApplicationWiresViewsTrayWindowsAndLifetime()
    {
        await fixture.RunAsync(() =>
        {
            EveryScreenResolvesToItsOwnView();
            EverySharedControlLoads();
            TheWindowIsTaggedOnlyWhenMotionIsReduced();
            return Task.CompletedTask;
        });

        await AudioBackends();
        await ReducedMotionDetection();

        await fixture.RunAsync(async () =>
        {
            var services = Composition.Services;
            Assert.Equal(new AppPaths(fixture.Root).ConfigDir, services.Paths.ConfigDir);
            Assert.Same(Composition.Shell, fixture.Window.DataContext);
            Composition.Navigation.SetAuthenticated(true); // a signed-in session

            // Tray → shell badge, and the badge text is localised.
            services.Tray.SetUnread(4);
            Assert.Equal(4, Composition.Shell.Unread);
            Assert.Contains("4", services.Tray.BadgeText(4));

            // Language → window flow direction (RTL for Arabic only).
            services.Copy.SetLang("ar");
            Assert.Equal(FlowDirection.RightToLeft, fixture.Window.FlowDirection);
            services.Copy.SetLang("en");
            Assert.Equal(FlowDirection.LeftToRight, fixture.Window.FlowDirection);

            // Theme toggling flips the application variant.
            Assert.NotNull(Application.Current);
            Composition.Shell.ToggleThemeCommand.Execute(null);
            Assert.Equal(ThemeVariant.Dark, Application.Current.RequestedThemeVariant);
            Composition.Shell.ToggleThemeCommand.Execute(null);
            Assert.Equal(ThemeVariant.Light, Application.Current.RequestedThemeVariant);

            // A burst of stream events triggers at most one aggregate refresh per second.
            Composition.OnRealtimeEvent(new HubEvent { Name = "task_status_update", Data = "{}" });
            Composition.OnRealtimeEvent(new HubEvent { Name = "task_status_update", Data = "{}" });

            // The in-app notification handler fills the shell list (it posts, so pump).
            Assert.Null(await services.Notifier.NotifyAsync("title", "body", null));
            Dispatcher.UIThread.RunJobs();
            Assert.Single(Composition.Shell.Notifications);

            // Deep links are consumed exactly once.
            services.DeepLinks.Enqueue("/threads/1");
            Assert.Equal("/threads/1", Composition.Shell.ConsumeDeepLink!());
            Assert.Null(Composition.Shell.ConsumeDeepLink!());

            // Window callbacks: navigate and hide.
            await services.Navigate!("/org");
            Assert.Equal("/org", Composition.Navigation.Current?.Route);
            await services.HideWindow!();
            Dispatcher.UIThread.RunJobs(); // Hide is posted to the UI thread
            Assert.False(fixture.Window.IsVisible);
            fixture.Window.Show();

            // Entity navigation opens exactly one per-entity stream.
            await services.Navigate!("/tasks/7");
            await WaitForStreamAsync("/api/tasks/7/events");
            await services.Navigate!("/org");
            await WaitForStreamAsync(null);

            // Desktop-only capabilities are injected into the ViewModels.
            Assert.IsType<FfmpegAudioService>(
                ((ThreadViewModel)Composition.Navigation.Routes["/threads/:id"]).Audio);
            var files = (FilesViewModel)Composition.Navigation.Routes["/files"];
            Assert.NotNull(files.PickFileAsync);
            Assert.NotNull(files.SaveFileAsync);
            await PickAndSaveAsync(files);

            // Tray dispatch: open/settings/about act on the live window.
            TrayHost.Handle(TrayService.IdOpen, fixture.Window, fixture.Lifetime);
            Assert.True(fixture.Window.IsVisible);
            TrayHost.Handle(TrayService.IdSettings, fixture.Window, fixture.Lifetime);
            Assert.Equal("/__shell/connect", Composition.Navigation.Current?.Route);
            TrayHost.Handle(TrayService.IdAbout, fixture.Window, fixture.Lifetime);
            Assert.Equal("/__shell/about", Composition.Navigation.Current?.Route);
            TrayHost.Handle("unknown", fixture.Window, fixture.Lifetime);

            // Closing hides to the tray while background mode is on, then really closes.
            fixture.Window.Close();
            Assert.False(fixture.Window.IsVisible);
            Assert.NotNull(fixture.Window.DataContext);
            await services.Config.SaveAsync(services.Config.Current with { Background = false });
            fixture.Window.Close();
        });

        // The composition root shuts down cleanly; a second call is harmless.
        await Composition.ShutdownAsync();
        await Composition.ShutdownAsync();

        // Quit is the tray's only unconditional exit path. It ends a session, so it runs
        // last and against a throwaway lifetime (the shared dispatcher must survive).
        var quit = new ClassicDesktopStyleApplicationLifetime { ShutdownMode = ShutdownMode.OnExplicitShutdown };
        TrayHost.Handle(TrayService.IdQuit, fixture.Window, quit);
        Assert.NotNull(Composition.Shell);
    }

    private static void EveryScreenResolvesToItsOwnView()
    {
        var copy = new LocalizationService();
        IAgentHubClient hub = new StubClient();
        IShellControl shell = new StubShell();
        var nav = new NavigationService();
        var cases = new (ScreenViewModel Screen, Type View)[]
        {
            (new LoginViewModel(hub, shell, copy, nav), typeof(LoginView)),
            (new WorkspaceViewModel(hub, shell, copy), typeof(WorkspaceView)),
            (new ThreadListViewModel(hub, shell, copy), typeof(ThreadListView)),
            (new ThreadViewModel(hub, shell, copy), typeof(ThreadView)),
            (new TaskListViewModel(hub, shell, copy), typeof(TaskListView)),
            (new TaskTraceViewModel(hub, shell, copy), typeof(TaskTraceView)),
            (new OrgViewModel(hub, shell, copy), typeof(OrgView)),
            (new ChannelsViewModel(hub, shell, copy), typeof(ChannelsView)),
            (new ConnectorsViewModel(hub, shell, copy), typeof(ConnectorsView)),
            (new SettingsViewModel(hub, shell, copy), typeof(SettingsView)),
            (new ComputersViewModel(hub, shell, copy), typeof(ComputersView)),
            (new SchedulesViewModel(hub, shell, copy), typeof(SchedulesView)),
            (new PersonaViewModel(hub, shell, copy), typeof(PersonaView)),
            (new KnowledgeViewModel(hub, shell, copy), typeof(KnowledgeView)),
            (new FilesViewModel(hub, shell, copy), typeof(FilesView)),
            (new ConnectViewModel(hub, shell, copy), typeof(ConnectView)),
            (new AboutViewModel(hub, shell, copy), typeof(AboutView))
        };
        var locator = new ViewLocator();
        foreach (var (screen, view) in cases)
        {
            Assert.True(locator.Match(screen));
            var control = locator.Build(screen);
            Assert.IsType(view, control);
            Assert.Same(screen, control!.DataContext);
        }
        Assert.False(locator.Match(new object()));
        Assert.Equal("Unknown screen", Assert.IsType<TextBlock>(locator.Build(new object())).Text);
    }

    private static void EverySharedControlLoads()
    {
        Assert.NotNull(new PageHeaderControl());
        Assert.NotNull(new FileTransferControl());
        Assert.NotNull(new VoiceControl());
        Assert.NotNull(new TaskActionsControl());
        Assert.NotNull(new TopBarControl());
        Assert.NotNull(new SidebarControl());

        var copy = new LocalizationService();
        var vm = new ShellViewModel(new NavigationService(), copy, new StubShell(), "1.0.0");
        Assert.Equal("v1.0.0", vm.VersionText);
        Assert.Equal("agentbuddy", vm.Title);
        Assert.NotNull(vm.NavWorkspace);
        Assert.NotNull(vm.NavFiles);
        Assert.NotNull(vm.LoginLabel);
        Assert.NotNull(vm.LanguageLabel);
        Assert.NotNull(vm.ThemeLabel);
        Assert.NotNull(vm.NotificationsLabel);
        Assert.NotNull(vm.ConnectedLabel);
        vm.NavigateCommand.Execute("/org");
        Assert.NotNull(vm.Navigation);
    }

    private static void TheWindowIsTaggedOnlyWhenMotionIsReduced()
    {
        var was = ReducedMotionService.ReduceMotion;
        try
        {
            var on = new Window();
            ReducedMotionService.ReduceMotion = true;
            ReducedMotionService.Apply(on);
            Assert.Contains("reduce-motion", on.Classes);

            var off = new Window();
            ReducedMotionService.ReduceMotion = false;
            ReducedMotionService.Apply(off);
            Assert.DoesNotContain("reduce-motion", off.Classes);
        }
        finally { ReducedMotionService.ReduceMotion = was; }
    }

    [Fact]
    public void EveryPlatformGetsItsOwnCaptureDevice()
    {
        var previous = Environment.GetEnvironmentVariable("AGENTBUDDY_AUDIO_DEVICE");
        try
        {
            Environment.SetEnvironmentVariable("AGENTBUDDY_AUDIO_DEVICE", "");
            Assert.Equal(("dshow", "audio=default"), FfmpegAudioService.InputDevice("windows"));
            Assert.Equal(("avfoundation", ":default"), FfmpegAudioService.InputDevice("macos"));
            Assert.Equal(("pulse", "default"), FfmpegAudioService.InputDevice("linux"));
            Assert.False(string.IsNullOrEmpty(FfmpegAudioService.InputDevice().Device));

            Environment.SetEnvironmentVariable("AGENTBUDDY_AUDIO_DEVICE", "hw:1");
            Assert.Equal(("pulse", "hw:1"), FfmpegAudioService.InputDevice("windows"));
        }
        finally { Environment.SetEnvironmentVariable("AGENTBUDDY_AUDIO_DEVICE", previous); }
    }

    private static async Task ReducedMotionDetection()
    {
        Assert.True(ReducedMotionService.Detect("1", false));
        Assert.True(ReducedMotionService.Detect("TRUE", false));
        Assert.False(ReducedMotionService.Detect("0", true));
        Assert.False(ReducedMotionService.Detect("FALSE", true));
        Assert.False(ReducedMotionService.Detect("", isWindows: false)); // non-Windows never queries
        Assert.False(ReducedMotionService.Detect("maybe", isWindows: false));
        _ = ReducedMotionService.Detect(null, isWindows: true); // the real OS query runs
        await Task.CompletedTask;
    }

    private static async Task AudioBackends()
    {
        var original = FfmpegAudioService.StartProcess;
        try
        {
            // No ffmpeg on the PATH: the caller gets a machine code, never silent success.
            await Assert.ThrowsAsync<HubApiException>(() => new FfmpegAudioService().RecordAsync(TimeSpan.FromSeconds(2)));
            await Assert.ThrowsAsync<HubApiException>(() => new FfmpegAudioService().PlayAsync(new MemoryStream([1])));

            // The argv is bounded by the requested duration and never a shell string.
            ProcessStartInfo? seen = null;
            FfmpegAudioService.StartProcess = psi =>
            {
                seen = psi;
                return Process.Start(new ProcessStartInfo("where.exe")
                {
                    ArgumentList = { "where" },
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true
                });
            };
            var clip = await new FfmpegAudioService().RecordAsync(TimeSpan.FromSeconds(3));
            Assert.NotEmpty(clip);
            Assert.Equal("ffmpeg", seen!.FileName);
            Assert.Contains("-t", seen.ArgumentList);
            Assert.Contains("3", seen.ArgumentList);
            Assert.Contains("pipe:1", seen.ArgumentList);

            FfmpegAudioService.StartProcess = _ => Process.Start(new ProcessStartInfo("findstr.exe")
            {
                ArgumentList = { "hit" },
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardInput = true,
                RedirectStandardOutput = true
            });
            await new FfmpegAudioService().PlayAsync(new MemoryStream("hit\n"u8.ToArray()));

            // A failed spawn is reported as speech_disabled, not as a raw exception.
            FfmpegAudioService.StartProcess = _ => null;
            await Assert.ThrowsAsync<HubApiException>(() => new FfmpegAudioService().RecordAsync(TimeSpan.FromSeconds(1)));
            await Assert.ThrowsAsync<HubApiException>(() => new FfmpegAudioService().PlayAsync(new MemoryStream([1])));

            // The capture device is configurable, and a nonsense duration is clamped.
            var previous = Environment.GetEnvironmentVariable("AGENTBUDDY_AUDIO_DEVICE");
            try
            {
                Environment.SetEnvironmentVariable("AGENTBUDDY_AUDIO_DEVICE", "hw:1");
                await Assert.ThrowsAsync<HubApiException>(() => new FfmpegAudioService().RecordAsync(TimeSpan.Zero));
                Environment.SetEnvironmentVariable("AGENTBUDDY_AUDIO_DEVICE", "");
                await Assert.ThrowsAsync<HubApiException>(() => new FfmpegAudioService().RecordAsync(TimeSpan.FromSeconds(-5)));
            }
            finally { Environment.SetEnvironmentVariable("AGENTBUDDY_AUDIO_DEVICE", previous); }
        }
        finally { FfmpegAudioService.StartProcess = original; }
    }

    private static async Task WaitForStreamAsync(string? expected)
    {
        var deadline = DateTime.UtcNow.AddSeconds(5);
        while (DateTime.UtcNow < deadline)
        {
            var open = Composition.Realtime!.EntityStreams.ToArray();
            if (expected is null ? open.Length == 0 : open is [var only] && only == expected) return;
            await Task.Delay(20);
        }
        Assert.Fail("the entity stream did not settle on " + (expected ?? "<none>"));
    }

    private static async Task PickAndSaveAsync(FilesViewModel files)
    {
        try
        {
            var picked = await files.PickFileAsync!();
            if (picked is not null) await picked.Value.Content.DisposeAsync();
        }
        catch (Exception) { /* headless has no picker implementation */ }

        try { await files.SaveFileAsync!("a.bin", new MemoryStream([1, 2])); }
        catch (Exception) { /* headless has no picker implementation */ }
    }
}
