using System.Collections.ObjectModel;
using System.ComponentModel;
using AgentBuddy.Core.Contracts;
using AgentBuddy.Core.Services;
using Avalonia;
using Avalonia.Styling;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;

namespace AgentBuddy.App.ViewModels;

public sealed class ShellViewModel : ObservableObject
{
    private readonly ILocalizationService _copy;
    private readonly IShellControl _control;
    private string _lang;
    private int _unread;

    public ShellViewModel(NavigationService navigation, ILocalizationService copy, IShellControl control, string version)
    {
        Navigation = navigation;
        _copy = copy;
        _control = control;
        _lang = copy.Lang;
        VersionText = "v" + version;
        navigation.CurrentChanged += _ => OnPropertyChanged(nameof(CurrentView));
        copy.LanguageChanged += _ => OnPropertyChanged(new PropertyChangedEventArgs(null)); // all localised properties
        NavigateCommand = new RelayCommand<string>(route => _ = navigation.NavigateAsync(route ?? "/"));
        ToggleThemeCommand = new RelayCommand(ToggleTheme);
        OpenNotificationCommand = new RelayCommand(OpenNotification);
    }

    public NavigationService Navigation { get; }
    public object? CurrentView => Navigation.Current;
    public string Title => "agentbuddy";
    public string VersionText { get; }
    public IRelayCommand<string> NavigateCommand { get; }
    public IRelayCommand ToggleThemeCommand { get; }
    public IRelayCommand OpenNotificationCommand { get; }
    public IReadOnlyList<string> Languages => LanguageCodes.All;
    public ObservableCollection<string> Notifications { get; } = [];

    public string Lang
    {
        get => _lang;
        set
        {
            if (!SetProperty(ref _lang, value)) return;
            _copy.SetLang(value);
            FireAndForget(_control.SetConfigAsync(new { lang = value }));
        }
    }

    public int Unread
    {
        get => _unread;
        private set => SetProperty(ref _unread, value);
    }

    /// <summary>Set by the App so a notification click can consume its queued deep link.</summary>
    public Func<string?>? ConsumeDeepLink { get; set; }

    public void AddNotification(string title, string body, string? link)
    {
        Notifications.Insert(0, title + " — " + body);
        while (Notifications.Count > Limits.MaxNotifications) Notifications.RemoveAt(Notifications.Count - 1);
        Unread = Notifications.Count;
        FireAndForget(_control.SetBadgeAsync(Unread));
    }

    /// <summary>Mirrors the tray badge without re-posting it (avoids a feedback loop).</summary>
    public void MarkUnread(int count) => Unread = count;

    public void MarkAllRead()
    {
        Notifications.Clear();
        Unread = 0;
        FireAndForget(_control.SetBadgeAsync(0));
    }

    private void OpenNotification()
    {
        var link = ConsumeDeepLink?.Invoke();
        if (!string.IsNullOrEmpty(link)) _ = Navigation.NavigateAsync(link);
    }

    private static void ToggleTheme()
    {
        var app = Application.Current;
        if (app is null) return; // headless tests
        app.RequestedThemeVariant = app.RequestedThemeVariant == ThemeVariant.Dark
            ? ThemeVariant.Light
            : ThemeVariant.Dark;
    }

    private static void FireAndForget(Task task) =>
        _ = task.ContinueWith(static t => _ = t.Exception, TaskContinuationOptions.OnlyOnFaulted);

    // The 15 sidebar labels, all resolved from the 13-language resource.
    public string NavWorkspace => _copy.Get("nav.workspace");
    public string NavThreads => _copy.Get("nav.threads");
    public string NavTasks => _copy.Get("nav.tasks");
    public string NavOrg => _copy.Get("nav.org");
    public string NavChannels => _copy.Get("nav.channels");
    public string NavConnectors => _copy.Get("nav.connectors");
    public string NavSettings => _copy.Get("nav.settings");
    public string NavComputers => _copy.Get("nav.computers");
    public string NavSchedules => _copy.Get("nav.schedules");
    public string NavPersona => _copy.Get("nav.persona");
    public string NavKnowledge => _copy.Get("nav.knowledge");
    public string NavFiles => _copy.Get("nav.files");
    public string LoginLabel => _copy.Get("action.login");
    public string LanguageLabel => _copy.Get("shell.language");
    public string ThemeLabel => _copy.Get("shell.theme");
    public string NotificationsLabel => _copy.Get("shell.notifications");
    public string ConnectedLabel => _copy.Get("state.connected");
}
