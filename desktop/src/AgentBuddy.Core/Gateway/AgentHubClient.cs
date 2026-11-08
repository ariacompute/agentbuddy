using System.Net;
using System.Net.Http.Json;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using AgentBuddy.Core.Contracts;

namespace AgentBuddy.Core.Gateway;

public interface IAgentHubClient
{
    Task<JsonElement?> SendAsync(string path, HttpMethod method, object? body = null, CancellationToken ct = default);
    IAsyncEnumerable<HubEvent> SubscribeAsync(string path, long? since = null, CancellationToken ct = default);
    Task<Stream> DownloadAsync(string path, CancellationToken ct = default);
    Task<JsonElement?> UploadAsync(string path, Stream content, string field, string fileName, IProgress<int>? progress = null, CancellationToken ct = default);
    Task<JsonElement?> PostAudioAsync(long threadId, Stream audio, CancellationToken ct = default);
}

/// <summary>
/// One HttpClient for the whole process. It speaks to the loopback gateway, which
/// forwards /api, /a2a, /healthz and /.well-known to agenthub. There is no overall
/// timeout: SSE streams stay open, only connect is bounded (see SocketsHttpHandler).
/// </summary>
public sealed class AgentHubClient : IAgentHubClient, IDisposable
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private readonly HttpClient _http;

    public AgentHubClient(Uri gatewayBase, string? bearerToken = null, CookieContainer? cookies = null)
    {
        var handler = new SocketsHttpHandler
        {
            UseCookies = true,
            CookieContainer = cookies ?? new CookieContainer(),
            AllowAutoRedirect = false,
            AutomaticDecompression = DecompressionMethods.None,
            ConnectTimeout = TimeSpan.FromSeconds(Limits.ConnectTimeoutSeconds)
        };
        _http = new HttpClient(handler)
        {
            BaseAddress = gatewayBase,
            Timeout = Timeout.InfiniteTimeSpan
        };
        if (!string.IsNullOrEmpty(bearerToken))
            _http.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", bearerToken);
        _http.DefaultRequestHeaders.TryAddWithoutValidation("Accept-Encoding", "identity");
    }

    /// <summary>Used by tests and by the shell's own upstream probes.</summary>
    public AgentHubClient(HttpClient http) => _http = http;

    public async Task<JsonElement?> SendAsync(string path, HttpMethod method, object? body = null, CancellationToken ct = default)
    {
        using var request = new HttpRequestMessage(method, path);
        if (body is not null) request.Content = JsonContent.Create(body, options: Json);
        using var response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct).ConfigureAwait(false);
        var text = await ReadBoundedAsync(response.Content, ct).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
            throw new HubApiException(ExtractCode(text) ?? ((int)response.StatusCode).ToString(), (int)response.StatusCode);
        if (response.StatusCode == HttpStatusCode.NoContent || string.IsNullOrWhiteSpace(text)) return null;
        try
        {
            using var doc = JsonDocument.Parse(text);
            return doc.RootElement.Clone();
        }
        catch (JsonException) { return null; }
    }

    public async IAsyncEnumerable<HubEvent> SubscribeAsync(
        string path, long? since = null, [EnumeratorCancellation] CancellationToken ct = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, Endpoints.WithSince(path, since));
        request.Headers.TryAddWithoutValidation("Accept", "text/event-stream");
        request.Headers.TryAddWithoutValidation("Accept-Encoding", "identity");
        using var response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
            throw new HubApiException(((int)response.StatusCode).ToString(), (int)response.StatusCode);
        await using var stream = await response.Content.ReadAsStreamAsync(ct).ConfigureAwait(false);
        await foreach (var item in SseParser.ParseAsync(stream, ct).ConfigureAwait(false))
            yield return item;
    }

    /// <summary>
    /// Returns the response body as a live stream: the caller copies it to disk and
    /// disposes it, so a large file is never buffered in memory. The response and
    /// request are owned by the returned stream and released with it.
    /// </summary>
    public async Task<Stream> DownloadAsync(string path, CancellationToken ct = default)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, path);
        var response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
        {
            var code = (int)response.StatusCode;
            var text = await ReadBoundedAsync(response.Content, ct).ConfigureAwait(false);
            response.Dispose();
            request.Dispose();
            throw new HubApiException(ExtractCode(text) ?? code.ToString(), code);
        }
        var source = await response.Content.ReadAsStreamAsync(ct).ConfigureAwait(false);
        return new OwnedStream(source, response, request);
    }

    /// <summary>
    /// Reads at most <see cref="Limits.MaxJsonBytes"/> characters. A body past the cap
    /// is truncated to nothing rather than turned into an unbounded string.
    /// </summary>
    private static async Task<string> ReadBoundedAsync(HttpContent content, CancellationToken ct)
    {
        if (content.Headers.ContentLength is > Limits.MaxJsonBytes) return "";
        await using var stream = await content.ReadAsStreamAsync(ct).ConfigureAwait(false);
        using var reader = new StreamReader(stream, Encoding.UTF8);
        var buffer = new char[8192];
        var text = new StringBuilder();
        while (true)
        {
            var read = await reader.ReadAsync(buffer, ct).ConfigureAwait(false);
            if (read == 0) break;
            if (text.Length + read > Limits.MaxJsonBytes) return "";
            text.Append(buffer, 0, read);
        }
        return text.ToString();
    }

    public async Task<JsonElement?> UploadAsync(
        string path, Stream content, string field, string fileName,
        IProgress<int>? progress = null, CancellationToken ct = default)
    {
        using var form = new MultipartFormDataContent();
        var tracked = new ProgressStream(content, content.Length, progress);
        form.Add(new StreamContent(tracked), field, fileName);
        using var response = await _http.PostAsync(path, form, ct).ConfigureAwait(false);
        var text = await ReadBoundedAsync(response.Content, ct).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
            throw new HubApiException(ExtractCode(text) ?? ((int)response.StatusCode).ToString(), (int)response.StatusCode);
        if (string.IsNullOrWhiteSpace(text)) return null;
        try { using var doc = JsonDocument.Parse(text); return doc.RootElement.Clone(); }
        catch (JsonException) { return null; }
    }

    public Task<JsonElement?> PostAudioAsync(long threadId, Stream audio, CancellationToken ct = default) =>
        UploadAsync(Endpoints.Format(Endpoints.ThreadAudio, ("id", threadId)), audio, "audio", "voice.webm", null, ct);

    private static string? ExtractCode(string text)
    {
        if (string.IsNullOrWhiteSpace(text)) return null;
        try
        {
            using var doc = JsonDocument.Parse(text);
            if (doc.RootElement.ValueKind == JsonValueKind.Object &&
                doc.RootElement.TryGetProperty("code", out var code) &&
                code.ValueKind == JsonValueKind.String)
                return code.GetString();
        }
        catch (JsonException) { }
        return null;
    }

    public void Dispose() => _http.Dispose();
}

/// <summary>
/// Incremental SSE framing: one event per blank line, no whole-body buffering.
/// Framing happens on bytes with an explicit line and event cap, so neither an
/// endless line nor an endless run of data lines can grow memory without bound.
/// </summary>
public static class SseParser
{
    public static async IAsyncEnumerable<HubEvent> ParseAsync(
        Stream stream, [EnumeratorCancellation] CancellationToken ct = default)
    {
        var readBuffer = new byte[8192];
        var lineBuffer = new byte[Limits.MaxEventBytes];
        var lineLength = 0;
        var lineOverflow = false;
        var data = new StringBuilder();
        string? name = null, id = null;
        var eventOverflow = false;

        var used = 0;
        var scanned = 0;
        while (!ct.IsCancellationRequested)
        {
            if (scanned >= used)
            {
                used = await stream.ReadAsync(readBuffer.AsMemory(), ct).ConfigureAwait(false);
                scanned = 0;
                if (used == 0) break;
            }
            var span = readBuffer.AsSpan(scanned, used - scanned);
            var newline = span.IndexOf((byte)'\n');
            if (newline < 0)
            {
                (lineLength, lineOverflow) = Append(lineLength, span, lineBuffer, lineOverflow);
                scanned = used;
                continue;
            }
            (lineLength, lineOverflow) = Append(lineLength, span[..newline], lineBuffer, lineOverflow);
            scanned += newline + 1;
            if (lineOverflow)
            {
                // A single line past the cap is dropped whole; framing stays in sync.
                lineLength = 0;
                lineOverflow = false;
                continue;
            }
            var length = lineLength;
            lineLength = 0;
            if (length > 0 && lineBuffer[length - 1] == (byte)'\r') length--;
            if (length == 0)
            {
                // Per the SSE spec an event with no data never fires; that also keeps a
                // truncated or dropped payload from arriving as an empty event.
                if (!eventOverflow && data.Length > 0)
                    yield return new HubEvent { Name = name ?? SseEvents.Message, Data = data.ToString(), Id = id };
                name = null; id = null; data.Clear(); eventOverflow = false;
                continue;
            }
            var line = Encoding.UTF8.GetString(lineBuffer, 0, length);
            if (line[0] == ':') continue;
            var colon = line.IndexOf(':');
            var field = colon < 0 ? line : line[..colon];
            var value = colon < 0 ? string.Empty : line[(colon + 1)..].TrimStart(' ');
            switch (field)
            {
                case "event":
                    if (value.Length <= MaxFieldChars) name = value;
                    break;
                case "id":
                    if (value.Length <= MaxFieldChars) id = value;
                    break;
                case "data":
                    if (eventOverflow) break;
                    if (data.Length + value.Length + 1 > Limits.MaxEventBytes) { eventOverflow = true; data.Clear(); break; }
                    if (data.Length > 0) data.Append('\n');
                    data.Append(value);
                    break;
            }
        }
    }

    private const int MaxFieldChars = 256;

    private static (int Length, bool Overflow) Append(int length, ReadOnlySpan<byte> chunk, byte[] buffer, bool overflow)
    {
        if (overflow) return (0, true);
        if (length + chunk.Length > buffer.Length) return (0, true);
        chunk.CopyTo(buffer.AsSpan(length));
        return (length + chunk.Length, false);
    }
}

/// <summary>
/// A response stream that owns the HttpResponseMessage and HttpRequestMessage it
/// came from, so DownloadAsync can hand out a live stream without leaking either.
/// </summary>
internal sealed class OwnedStream(Stream inner, HttpResponseMessage response, HttpRequestMessage request) : Stream
{
    public override bool CanRead => true;
    public override bool CanSeek => false;
    public override bool CanWrite => false;
    public override long Length => throw new NotSupportedException();
    public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }

    public override int Read(byte[] buffer, int offset, int count) => inner.Read(buffer, offset, count);
    public override ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken ct = default) => inner.ReadAsync(buffer, ct);
    public override Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken ct) => inner.ReadAsync(buffer, offset, count, ct);
    public override Task CopyToAsync(Stream destination, int bufferSize, CancellationToken ct) => inner.CopyToAsync(destination, bufferSize, ct);
    public override void Flush() { }
    public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
    public override void SetLength(long value) => throw new NotSupportedException();
    public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();

    protected override void Dispose(bool disposing)
    {
        if (disposing) { inner.Dispose(); response.Dispose(); request.Dispose(); }
        base.Dispose(disposing);
    }

    public override async ValueTask DisposeAsync()
    {
        await inner.DisposeAsync().ConfigureAwait(false);
        response.Dispose();
        request.Dispose();
        await base.DisposeAsync().ConfigureAwait(false);
    }
}

internal sealed class ProgressStream : Stream
{
    private readonly Stream _inner;
    private readonly long _total;
    private readonly IProgress<int>? _progress;
    private long _read;
    private int _last = -1;

    public ProgressStream(Stream inner, long total, IProgress<int>? progress)
    {
        _inner = inner; _total = total; _progress = progress;
    }

    public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken ct = default)
    {
        var n = await _inner.ReadAsync(buffer, ct).ConfigureAwait(false);
        Report(n);
        return n;
    }

    public override int Read(byte[] buffer, int offset, int count)
    {
        var n = _inner.Read(buffer, offset, count);
        Report(n);
        return n;
    }

    private void Report(int n)
    {
        if (_progress is null || n <= 0) return;
        _read += n;
        var pct = _total > 0 ? (int)Math.Min(100, _read * 100 / _total) : 100;
        if (pct == _last) return;
        _last = pct;
        _progress.Report(pct);
    }

    public override bool CanRead => true;
    public override bool CanSeek => false;
    public override bool CanWrite => false;
    public override long Length => _total;
    public override long Position { get => _read; set => throw new NotSupportedException(); }
    public override void Flush() { }
    public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
    public override void SetLength(long value) => throw new NotSupportedException();
    public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
}
