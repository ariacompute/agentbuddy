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
        Endpoints.StreamEventNames.TryGetValue(Endpoints.TemplateFor(streamPath), out var names) &&
        names.Contains(eventName, StringComparer.Ordinal);
}

/// <summary>
/// Owns the long-lived subscriptions: the two global streams started up front and the
/// per-entity thread/task stream of whichever detail screen is open. Each stream tracks
/// its last event id so a reconnect replays with since=&lt;seq&gt;; a bounded ring keeps
/// recent events for the views. Failures back off using the same 5s/20s/30s ladder as
/// the poller. There is no overall timeout: the streams stay open indefinitely.
/// </summary>
public sealed class RealtimeService : IAsyncDisposable
{
    public const int RecentCapacity = 100;

    private readonly IAgentHubClient _client;
    private readonly ConcurrentDictionary<string, long> _cursors = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, List<HubEvent>> _recent = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, CancellationTokenSource> _entityStops = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, Task> _entityPumps = new(StringComparer.Ordinal);
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

    /// <summary>
    /// Starts the two id-less streams only. Thread and task streams are per entity, so
    /// subscribing to their template ("/api/tasks/{id}/events") would 404 forever; the
    /// UI opens those with <see cref="SwitchEntityStreamAsync"/> instead.
    /// </summary>
    public Task StartAsync(CancellationToken ct = default)
    {
        if (_stop is not null) return Task.CompletedTask;
        var stop = CancellationTokenSource.CreateLinkedTokenSource(ct);
        _stop = stop;
        // Capture the token here, not inside the lambda: StopAsync clears the field before
        // the pumps are awaited, so reading _stop on the pool thread would race the teardown.
        var token = stop.Token;
        _pumps = Endpoints.GlobalStreams
            .Select(path => Task.Run(() => PumpAsync(path, token), CancellationToken.None))
            .ToArray();
        return Task.CompletedTask;
    }

    /// <summary>The per-entity streams currently open, keyed by their concrete path.</summary>
    public IReadOnlyCollection<string> EntityStreams => _entityPumps.Keys.ToArray();

    /// <summary>
    /// Opens one per-entity stream ("/api/threads/42/events") and keeps it pumping.
    /// Templates and unknown paths are refused, so an unfilled route cannot turn into a
    /// permanent 404 subscription. Returns true when the path is now tracked.
    /// </summary>
    public bool Track(string path, CancellationToken ct = default)
    {
        if (!Endpoints.IsEntityStream(path)) return false;
        if (_entityPumps.ContainsKey(path)) return true;

        var owner = _stop;
        var linked = owner is null
            ? CancellationTokenSource.CreateLinkedTokenSource(ct)
            : CancellationTokenSource.CreateLinkedTokenSource(owner.Token, ct);
        if (!_entityStops.TryAdd(path, linked))
        {
            linked.Dispose();
            return true;
        }
        _entityPumps[path] = Task.Run(() => PumpAsync(path, linked.Token), CancellationToken.None);
        return true;
    }

    /// <summary>Closes one per-entity stream and waits for its pump to unwind.</summary>
    public async Task UntrackAsync(string path)
    {
        if (!_entityStops.TryRemove(path, out var stop)) return;
        stop.Cancel();
        if (_entityPumps.TryRemove(path, out var pump))
        {
            try { await pump.ConfigureAwait(false); }
            catch (OperationCanceledException) { }
        }
        stop.Dispose();
    }

    /// <summary>
    /// Navigation hook: closes every entity stream and opens the one the new screen
    /// needs (null closes them all). Entity streams are mutually exclusive because only
    /// one detail screen is visible at a time.
    /// </summary>
    public async Task SwitchEntityStreamAsync(string? path)
    {
        foreach (var open in _entityPumps.Keys.ToArray())
        {
            if (!string.Equals(open, path, StringComparison.Ordinal))
                await UntrackAsync(open).ConfigureAwait(false);
        }
        if (path is not null) Track(path);
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
        // Claim the token before the first await: two concurrent stops must not cancel and
        // dispose the same CancellationTokenSource.
        var stop = Interlocked.Exchange(ref _stop, null);
        if (stop is null) return;
        stop.Cancel();
        var pumps = Interlocked.Exchange(ref _pumps, []);
        foreach (var pump in pumps)
        {
            try { await pump.ConfigureAwait(false); }
            catch (OperationCanceledException) { }
        }
        foreach (var entity in _entityPumps.Keys.ToArray())
            await UntrackAsync(entity).ConfigureAwait(false);
        stop.Dispose();
    }

    public async ValueTask DisposeAsync() => await StopAsync().ConfigureAwait(false);
}
