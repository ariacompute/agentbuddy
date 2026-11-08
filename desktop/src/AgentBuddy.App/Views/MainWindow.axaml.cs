using Avalonia.Controls;

namespace AgentBuddy.App.Views;

public partial class MainWindow : Window
{
    public MainWindow()
    {
        InitializeComponent();
        Closing += OnClosing;
        Closed += async (_, _) => await Composition.ShutdownAsync();
    }

    private void OnClosing(object? sender, WindowClosingEventArgs e)
    {
        if (!Composition.Initialized) return;
        // background=true (default) hides the window and keeps the tray running;
        // only the tray's Quit action reaches desktop.Shutdown().
        if (Composition.Services.Config.Current.Background)
        {
            e.Cancel = true;
            Hide();
        }
    }
}
