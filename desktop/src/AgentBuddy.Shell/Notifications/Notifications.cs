using System.Diagnostics;
using AgentBuddy.Core.Contracts;

namespace AgentBuddy.Shell.Notifications;

/// <summary>
/// Notification deep links are in-app paths only. A click consumes exactly one
/// queued link; the App layer turns it into navigation (there is no JS bridge).
/// </summary>
public sealed class DeepLinkQueue
{
    private readonly Queue<string> _links = new();
    private readonly object _gate = new();

    public static bool IsValid(string? link)
    {
        if (string.IsNullOrWhiteSpace(link)) return false;
        if (link[0] != '/' || link.StartsWith("//", StringComparison.Ordinal)) return false;
        if (link.Contains('\\') || link.Any(char.IsControl)) return false;
        if (link.Contains("javascript:", StringComparison.OrdinalIgnoreCase)) return false;
        if (link.Contains("data:", StringComparison.OrdinalIgnoreCase)) return false;
        return Uri.TryCreate(link, UriKind.Relative, out _);
    }

    public bool Enqueue(string? link)
    {
        if (!IsValid(link)) return false;
        lock (_gate) _links.Enqueue(link!);
        return true;
    }

    public string? Consume()
    {
        lock (_gate) return _links.Count == 0 ? null : _links.Dequeue();
    }

    public int Count { get { lock (_gate) return _links.Count; } }
}

public interface ISystemNotifier
{
    /// <summary>Returns null on success, otherwise a machine reason code.</summary>
    Task<string?> NotifyAsync(string title, string body, string? link, CancellationToken ct = default);
}

/// <summary>
/// Prefers the native OS channel, and falls back to an in-app notification
/// callback. Windows uses a system popup (no modern toast API in .NET without
/// WinRT); Linux uses notify-send; macOS uses osascript. No capability is
/// claimed on a platform that does not have one.
/// </summary>
public sealed class SystemNotifier : ISystemNotifier
{
    private Func<string, string, string?, Task<bool>>? _inApp;

    public SystemNotifier(Func<string, string, string?, Task<bool>>? inApp = null) => _inApp = inApp;

    /// <summary>Wired by the App once a Window exists; headless tests leave it null.</summary>
    public void SetInAppHandler(Func<string, string, string?, Task<bool>> handler) => _inApp = handler;

    public async Task<string?> NotifyAsync(string title, string body, string? link, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(title) || string.IsNullOrWhiteSpace(body)) return "missing_fields";
        if (_inApp is not null && await _inApp(title, body, link).ConfigureAwait(false)) return null;
        return await NativeAsync(title, body, ct).ConfigureAwait(false);
    }

    private static async Task<string?> NativeAsync(string title, string body, CancellationToken ct)
    {
        ProcessStartInfo psi;
        if (OperatingSystem.IsLinux())
        {
            psi = new ProcessStartInfo("notify-send") { UseShellExecute = false, CreateNoWindow = true };
            psi.ArgumentList.Add(title);
            psi.ArgumentList.Add(body);
        }
        else if (OperatingSystem.IsMacOS())
        {
            psi = new ProcessStartInfo("osascript") { UseShellExecute = false, CreateNoWindow = true };
            psi.ArgumentList.Add("-e");
            psi.ArgumentList.Add($"display notification \"{Escape(body)}\" with title \"{Escape(title)}\"");
        }
        else if (OperatingSystem.IsWindows())
        {
            psi = new ProcessStartInfo("powershell") { UseShellExecute = false, CreateNoWindow = true };
            psi.ArgumentList.Add("-NoProfile");
            psi.ArgumentList.Add("-Command");
            psi.ArgumentList.Add($"$s=New-Object -ComObject Wscript.Shell; $s.Popup('{Escape(title)} {Escape(body)}',5,'agentbuddy',0) | Out-Null");
        }
        else return "no_app";

        try
        {
            using var process = Process.Start(psi);
            if (process is null) return "no_app";
            await process.WaitForExitAsync(ct).ConfigureAwait(false);
            return process.ExitCode == 0 ? null : "denied";
        }
        catch (Exception) { return "no_app"; }
    }

    private static string Escape(string value) => value.Replace("\\", "\\\\").Replace("'", "''").Replace("\"", "\\\"").Replace("\n", " ");
}
