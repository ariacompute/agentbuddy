using System.Collections.Concurrent;
using System.Globalization;
using AgentBuddy.Core.Contracts;
using AgentBuddy.Core.Gateway;

namespace AgentBuddy.Core.Services;

public enum RealtimeChannel
{
    Unknown,
    Thread,
    Task,
    Sandbox,
    Router
}

/// <summary>
/// The four frozen event streams and their event names. Classifying here keeps the
/// wire names in one place and lets the UI react by channel without parsing JSON.
/// </summary>
public static class RealtimeEvents
{
    public static RealtimeChannel Classify(string name) => name switch
    {
        SseEvents.ThreadAgent or SseEvents.ThreadMessage => RealtimeChannel.Thread,
        SseEvents.TaskStatus or SseEvents.TaskArtifact or SseEvents.TaskSpan or SseEvents.Message => RealtimeChannel.Task,
        SseEvents.Sandbox => RealtimeChannel.Sandbox,
        SseEvents.Router => RealtimeChannel.Router,
        _ => RealtimeChannel.Unknown
    };

    public static bool IsKnown(string name) => Classify(name) != RealtimeChannel.Unknown;

    /// <summary>Rejects keepalives and events that do not belong to the subscribed stream.</summary>
    public static bool BelongsTo(string streamPath, string eventName) =>
        Endpoints.StreamEventNames.TryGetValue(streamPath, out var names) &&
        names.Contains(eventName, StringComparer.Ordinal);
}

/// <summary>
/// Owns the four long-lived subscriptions. Each stream tracks its last event id so a
/// reconnect replays with since=&lt;seq&gt;; a bounded ring keeps recent events for the
/// views. Failures back off using the same 5s/20s/30s ladder as the poller. There is
/// no overall timeout: the streams are expected to stay open indefinitely.
/// </summary>
public sealed class RealtimeService : IAsyncDisposable
{
    public const int RecentCapacity = 100;

    private readonly IAgentHubClient _client;
    private readonly ConcurrentDictionary<string, long> _cursors = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, List<HubEvent>> _recent = new(StringComparer.Ordinal);
    private readonly object _gate = new();
    private readonly Func<bool> _isVisible;
    private CancellationTokenSource? _stop;
    private Task[] _pumps = [];
    private int _failures;

    public RealtimeService(IAgentHubClient client, Func<bool>? isVisible = null)
    {
        _client = client;
        _isVisible = isVisible ?? (() => true);
    }

    public int FailureCount => Volatile.Read(ref _failures);
    public int ProcessedCount { get; private set; }

    /// <summary>Raised for every accepted event, on the pump's background thread.</summary>
    public event Action<HubEvent>? EventReceived;

    public long? Cursor(string path) => _cursors.TryGetValue(path, out var seq) ? seq : null;

    public IReadOnlyList<HubEvent> Recent(string path)
    {
        lock (_gate)
            return _recent.TryGetValue(path, out var items) ? items.ToArray() : [];
    }

    public Task StartAsync(CancellationToken ct = default)
    {
        if (_stop is not null) return Task.CompletedTask;
        _stop = CancellationTokenSource.CreateLinkedTokenSource(ct);
        _pumps = Endpoints.StreamEventNames.Keys
            .Select(path => Task.Run(() => PumpAsync(path, _stop.Token), CancellationToken.None))
            .ToArray();
        return Task.CompletedTask;
    }

    /// <summary>
    /// One subscription attempt, exposed so tests can drive the normal and failure
    /// paths without looping. Returns false when the stream failed (and never throws).
    /// </summary>
    public async Task<bool> PumpOnceAsync(string path, CancellationToken ct = default)
    {
        try
        {
            await foreach (var item in _client.SubscribeAsync(path, Cursor(path), ct).ConfigureAwait(false))
                Accept(path, item);
            Interlocked.Exchange(ref _failures, 0);
            return true;
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
        catch (Exception)
        {
            Interlocked.Increment(ref _failures);
            return false;
        }
    }

    private async Task PumpAsync(string path, CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            await PumpOnceAsync(path, ct).ConfigureAwait(false);
            var delay = NotificationDecider.ComputePollInterval(FailureCount, _isVisible());
            try { await Task.Delay(delay, ct).ConfigureAwait(false); }
            catch (OperationCanceledException) { break; }
        }
    }

    private bool Accept(string path, HubEvent item)
    {
        if (long.TryParse(item.Id, NumberStyles.None, CultureInfo.InvariantCulture, out var seq) && seq > 0)
            _cursors.AddOrUpdate(path, seq, (_, old) => Math.Max(old, seq));
        if (!RealtimeEvents.BelongsTo(path, item.Name)) return false;

        lock (_gate)
        {
            if (!_recent.TryGetValue(path, out var items))
            {
                items = [];
                _recent[path] = items;
            }
            items.Insert(0, item);
            while (items.Count > RecentCapacity) items.RemoveAt(items.Count - 1);
            ProcessedCount++;
        }
        EventReceived?.Invoke(item);
        return true;
    }

    public async Task StopAsync()
    {
        if (_stop is null) return;
        _stop.Cancel();
        foreach (var pump in _pumps)
        {
            try { await pump.ConfigureAwait(false); }
            catch (OperationCanceledException) { }
        }
        _pumps = [];
        _stop.Dispose();
        _stop = null;
    }

    public async ValueTask DisposeAsync() => await StopAsync().ConfigureAwait(false);
}
