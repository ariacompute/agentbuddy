using AgentBuddy.Core.Contracts;

namespace AgentBuddy.Core.Services;

/// <summary>
/// Pure notification and polling decisions, ported from the legacy workbench.
/// No clock or I/O here, so both the normal and the failure paths are trivially
/// unit-testable.
/// </summary>
public static class NotificationDecider
{
    public static readonly string[] ActiveStates = ["submitted", "working", "input-required"];

    public static string? AnnouncementKey(string state) => state switch
    {
        "completed" or "canceled" => "notification.result",
        "input-required" => "notification.approval",
        "failed" => "notification.failure",
        _ => null
    };

    public static string EventKey(string taskId, string state) => taskId + ":" + state;

    public static bool IsWithinIdempotentWindow(DateTimeOffset now, DateTimeOffset last,
        long windowMs = Limits.IdempotentWindowMs) =>
        last != default && now.ToUnixTimeMilliseconds() - last.ToUnixTimeMilliseconds() < windowMs;

    public static bool AllowsRate(int sentWithinMinute, int maxPerMinute = Limits.DefaultMaxPerMinute) =>
        sentWithinMinute < maxPerMinute;

    public static bool IsQuiet(DateTimeOffset now, DateTimeOffset quietUntil) =>
        quietUntil > now;

    public static DateTimeOffset QuietUntil(DateTimeOffset now, int quietMinutes)
    {
        var capped = Math.Min(Math.Max(quietMinutes, 0), Limits.MaxQuietMinutes);
        return now.AddMinutes(capped);
    }

    /// <summary>5s / 20s normally, exponential 5s..30s backoff after failures.</summary>
    public static int ComputePollInterval(int failureCount, bool visible)
    {
        if (failureCount <= 0) return visible ? Limits.PollVisibleMs : Limits.PollHiddenMs;
        var multiplier = Math.Pow(2, Math.Min(failureCount, 10));
        var value = Limits.BackoffFloorMs * multiplier;
        return (int)Math.Clamp(value, Limits.BackoffFloorMs, Limits.BackoffCeilMs);
    }

    public static int ClampBadge(int count) => Math.Clamp(count, 0, Limits.MaxBadge);
}
