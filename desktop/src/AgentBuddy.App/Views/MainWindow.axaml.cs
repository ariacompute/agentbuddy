using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.ApplicationLifetimes;

namespace AgentBuddy.App.Views;

public partial class MainWindow : Window
{
    private int _exitRequested;

    public MainWindow()
    {
        InitializeComponent();
        Closing += OnClosing;
        Closed += OnClosed;
    }

    private void OnClosing(object? sender, WindowClosingEventArgs e)
    {
        if (!Composition.Initialized) return;
        // background=true (default) hides the window and keeps the tray running;
        // only an explicit quit tears the session down.
        if (Composition.Services.Config.Current.Background)
        {
            e.Cancel = true;
            Hide();
            return;
        }

        // background=false means "closing the window exits". Cancel the close once so the
        // teardown runs while the dispatcher still pumps, then let QuitAsync stop the
        // lifetime — exiting first would kill the cleanup halfway through.
        if (Interlocked.Exchange(ref _exitRequested, 1) != 0) return;
        e.Cancel = true;
        _ = Composition.QuitAsync(DesktopLifetime);
    }

    // Safety net: the lifetime can shut down without our close path (OS session end, a
    // second quit). ShutdownAsync is single-flight, so a duplicate is a no-op.
    private void OnClosed(object? sender, EventArgs e) => _ = Composition.ShutdownAsync();

    private static IClassicDesktopStyleApplicationLifetime? DesktopLifetime =>
        Application.Current?.ApplicationLifetime as IClassicDesktopStyleApplicationLifetime;
}
