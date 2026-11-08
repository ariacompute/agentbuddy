using AgentBuddy.Core.Contracts;
using AgentBuddy.Core.Services;

namespace AgentBuddy.Shell.Tray;

/// <summary>
/// Pure tray state and 13-language label mapping. No AppHandle / Avalonia
/// dependency, so language switching and badge semantics are unit-testable.
/// The App layer builds the actual TrayIcon and calls Refresh on language change.
/// </summary>
public sealed class TrayService(ILocalizationService copy)
{
    public const string IdOpen = "shell.open";
    public const string IdSettings = "shell.settings";
    public const string IdAbout = "shell.about";
    public const string IdQuit = "shell.quit";
    public const string AppName = "agentbuddy";

    public static readonly string[] MenuIds = [IdOpen, IdSettings, IdAbout, IdQuit];

    private int _unread;

    public int Unread => _unread;
    public event Action<int>? BadgeChanged;

    public static string PathFor(string id) => id switch
    {
        IdOpen => "/",
        IdSettings => ShellEndpoints.Connect,
        IdAbout => ShellEndpoints.About,
        _ => "" // quit is handled by the App, never by navigation
    };

    public static string BadgeNumber(int count) =>
        count <= 0 ? "" : count > Limits.BadgeDisplayCap ? "99+" : count.ToString(System.Globalization.CultureInfo.InvariantCulture);

    public string BadgeText(int count)
    {
        if (count <= 0) return "";
        return copy.Get("tray.unread").Replace("{n}", BadgeNumber(count));
    }

    public IReadOnlyDictionary<string, string> MenuLabels() => new Dictionary<string, string>
    {
        [IdOpen] = copy.Get("tray.open"),
        [IdSettings] = copy.Get("tray.settings"),
        [IdAbout] = copy.Get("tray.about"),
        [IdQuit] = copy.Get("tray.quit")
    };

    public void SetUnread(int count)
    {
        var clamped = NotificationDecider.ClampBadge(count);
        if (clamped == _unread) return;
        _unread = clamped;
        BadgeChanged?.Invoke(clamped);
    }

    /// <summary>Rebuild the menu after a language change without losing the badge.</summary>
    public int Refresh(string lang)
    {
        copy.SetLang(lang);
        BadgeChanged?.Invoke(_unread);
        return _unread;
    }
}
