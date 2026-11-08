using AgentBuddy.Shell.Tray;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Platform;

namespace AgentBuddy.App;

/// <summary>Builds the real Avalonia TrayIcon from the headless TrayService state.</summary>
public static class TrayHost
{
    public static void Attach(Application application, Window window,
        IClassicDesktopStyleApplicationLifetime desktop)
    {
        var tray = new TrayIcon { ToolTipText = TrayService.AppName };
        try
        {
            using var iconStream = AssetLoader.Open(new Uri("avares://agentbuddy/Assets/Icons/app-icon.png"));
            tray.Icon = new WindowIcon(iconStream);
        }
        catch (Exception) { /* icon is optional; the menu and badge still work */ }

        var menu = new NativeMenu();
        var labels = Composition.Services.Tray.MenuLabels();
        foreach (var id in TrayService.MenuIds)
        {
            var menuId = id;
            var item = new NativeMenuItem { Header = labels[id] };
            item.Click += (_, _) => Handle(menuId, window, desktop);
            menu.Items.Add(item);
        }
        tray.Menu = menu;
        // A desktop without a tray area (bare X11, headless) must still start.
        try { TrayIcon.SetIcons(application, new TrayIcons { tray }); }
        catch (Exception) { /* the window keeps working without the tray icon */ }

        Composition.Services.Tray.BadgeChanged += count =>
            tray.ToolTipText = count == 0
                ? TrayService.AppName
                : Composition.Services.Tray.BadgeText(count);
        Composition.Services.Copy.LanguageChanged += _ =>
        {
            var refreshed = Composition.Services.Tray.MenuLabels();
            for (var i = 0; i < TrayService.MenuIds.Length; i++)
                if (menu.Items[i] is NativeMenuItem item)
                    item.Header = refreshed[TrayService.MenuIds[i]];
        };
    }

    /// <summary>Menu dispatch. Internal so the four actions can be asserted headlessly.</summary>
    internal static void Handle(string id, Window window,
        IClassicDesktopStyleApplicationLifetime desktop)
    {
        switch (id)
        {
            case TrayService.IdOpen:
                window.Show();
                window.Activate();
                break;
            case TrayService.IdSettings:
                _ = Composition.Navigation.NavigateAsync(TrayService.PathFor(id));
                window.Show();
                break;
            case TrayService.IdAbout:
                _ = Composition.Navigation.NavigateAsync(TrayService.PathFor(id));
                window.Show();
                break;
            case TrayService.IdQuit:
                desktop.Shutdown(); // the only path that always exits
                break;
        }
    }
}
