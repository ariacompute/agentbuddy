using Avalonia;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Markup.Xaml;

namespace AgentBuddy.App;

public partial class App : Application
{
    public override void Initialize() => AvaloniaXamlLoader.Load(this);

    public override void OnFrameworkInitializationCompleted()
    {
        Composition.InitializeAsync().GetAwaiter().GetResult();
        if (ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop)
        {
            var window = new Views.MainWindow { DataContext = Composition.Shell };
            desktop.MainWindow = window;
            desktop.ShutdownMode = Avalonia.Controls.ShutdownMode.OnMainWindowClose;
            TrayHost.Attach(this, window, desktop);
            Composition.AttachWindow(window, desktop);
        }
        base.OnFrameworkInitializationCompleted();
    }
}
