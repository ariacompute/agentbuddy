using System.Text.Json;
using AgentBuddy.Core.Contracts;
using AgentBuddy.Core.Gateway;

namespace AgentBuddy.Core.Services;

/// <summary>
/// Aggregated polling (there is no global event stream). Polls workspace and tasks,
/// backs off on failure, computes unread and pushes badge/notifications to the shell.
/// Badge and notification delivery are always fire-and-forget.
/// </summary>
public sealed class MonitorService : IAsyncDisposable
{
    private readonly IAgentHubClient _client;
    private readonly IShellControl _shell;
    private readonly ILocalizationService _copy;
    private readonly Func<bool> _isVisible;
    private readonly Dictionary<string, DateTimeOffset> _seen = new(StringComparer.Ordinal);
    private CancellationTokenSource? _stop;
    private Task? _loop;

    public MonitorService(IAgentHubClient client, IShellControl shell, ILocalizationService copy,
        Func<bool>? isVisible = null)
    {
        _client = client;
        _shell = shell;
        _copy = copy;
        _isVisible = isVisible ?? (() => true);
    }

    public int FailureCount { get; private set; }
    public int UnreadCount { get; private set; }
    public IReadOnlyList<string> ActiveTaskIds { get; private set; } = [];
    public event Action<int>? UnreadChanged;

    public Task StartAsync(CancellationToken ct = default)
    {
        if (_loop is not null) return Task.CompletedTask;
        _stop = CancellationTokenSource.CreateLinkedTokenSource(ct);
        _loop = Task.Run(() => LoopAsync(_stop.Token), CancellationToken.None);
        return Task.CompletedTask;
    }

    public async Task StopAsync()
    {
        if (_stop is null) return;
        _stop.Cancel();
        if (_loop is not null)
        {
            try { await _loop.ConfigureAwait(false); }
            catch (OperationCanceledException) { }
        }
        _loop = null;
    }

    /// <summary>One poll, exposed so tests can drive the normal and failure paths deterministically.</summary>
    public async Task<bool> PollOnceAsync(CancellationToken ct = default)
    {
        try
        {
            var workspace = await _client.SendAsync(Endpoints.Workspace, HttpMethod.Get, null, ct).ConfigureAwait(false);
            var tasks = await _client.SendAsync(Endpoints.Tasks, HttpMethod.Get, null, ct).ConfigureAwait(false);
            var active = new List<string>();
            if (tasks is { ValueKind: JsonValueKind.Array })
            {
                foreach (var item in tasks.Value.EnumerateArray())
                {
                    if (item.ValueKind != JsonValueKind.Object) continue;
                    var state = item.TryGetProperty("state", out var s) ? s.GetString() ?? "" : "";
                    var id = item.TryGetProperty("id", out var i) ? i.ToString() : "";
                    if (NotificationDecider.ActiveStates.Contains(state) && id.Length > 0) active.Add(id);
                    Announce(id, state, workspace);
                }
            }
            ActiveTaskIds = active;
            FailureCount = 0;
            var unread = Math.Min(active.Count, Limits.MaxNotifications);
            if (unread != UnreadCount)
            {
                UnreadCount = unread;
                UnreadChanged?.Invoke(unread);
                FireAndForget(_shell.SetBadgeAsync(unread, CancellationToken.None));
            }
            PruneSeen();
            return true;
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
        catch (Exception)
        {
            FailureCount++;
            return false;
        }
    }

    private void Announce(string taskId, string state, JsonElement? workspace)
    {
        var key = NotificationDecider.AnnouncementKey(state);
        if (key is null || taskId.Length == 0 || workspace is null) return;
        var now = DateTimeOffset.UtcNow;
        var eventKey = NotificationDecider.EventKey(taskId, state);
        if (_seen.TryGetValue(eventKey, out var last) &&
            NotificationDecider.IsWithinIdempotentWindow(now, last)) return;
        _seen[eventKey] = now;
        // The title is resolved at send time, in the current language. Never send a copy key.
        var title = _copy.Get(key);
        FireAndForget(_shell.NotifyAsync(title, taskId, "/tasks/" + taskId, CancellationToken.None));
    }

    private void PruneSeen()
    {
        var cutoff = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - Limits.IdempotentWindowMs;
        foreach (var stale in _seen.Where(p => p.Value.ToUnixTimeMilliseconds() < cutoff).Select(p => p.Key).ToArray())
            _seen.Remove(stale);
    }

    private static void FireAndForget(Task task) =>
        _ = task.ContinueWith(static t => _ = t.Exception, TaskContinuationOptions.OnlyOnFaulted);

    private async Task LoopAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            await PollOnceAsync(ct).ConfigureAwait(false);
            var delay = NotificationDecider.ComputePollInterval(FailureCount, _isVisible());
            try { await Task.Delay(delay, ct).ConfigureAwait(false); }
            catch (OperationCanceledException) { break; }
        }
    }

    public async ValueTask DisposeAsync() => await StopAsync().ConfigureAwait(false);
}
