using AgentBuddy.Core.Services;
using AgentBuddy.Shell.Credentials;
using AgentBuddy.Shell.Executor;
using AgentBuddy.Shell.Notifications;
using AgentBuddy.Shell.Tray;
using AgentBuddy.Shell.Upgrade;

namespace AgentBuddy.Shell;

/// <summary>
/// Dependency container for the shell. Everything here is headless and can be
/// constructed in unit tests without an Avalonia AppHandle.
/// </summary>
public sealed class ShellServices
{
    public required ConfigService Config { get; init; }
    public required ILocalizationService Copy { get; init; }
    public required ICredentialStore Credentials { get; init; }
    public required TrayService Tray { get; init; }
    public required ISystemNotifier Notifier { get; init; }
    public required DeepLinkQueue DeepLinks { get; init; }
    public required ExecutorService Executor { get; init; }
    public required UpgradeService Upgrade { get; init; }
    public required IAppPaths Paths { get; init; }

    /// <summary>Navigation / window callbacks supplied by the App layer.</summary>
    public Func<string, Task>? Navigate { get; set; }
    public Func<Task>? HideWindow { get; set; }
    public Func<Task>? Quit { get; set; }

    public DateTimeOffset QuietUntil { get; set; }

    public string Version { get; init; } = "0.1.0";
    public string Commit { get; init; } = "";
}
