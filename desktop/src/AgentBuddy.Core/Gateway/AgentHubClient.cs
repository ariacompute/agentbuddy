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
        var text = await response.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
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

    public async Task<Stream> DownloadAsync(string path, CancellationToken ct = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, path);
        using var response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
            throw new HubApiException(((int)response.StatusCode).ToString(), (int)response.StatusCode);
        var memory = new MemoryStream();
        await using (var source = await response.Content.ReadAsStreamAsync(ct).ConfigureAwait(false))
            await source.CopyToAsync(memory, ct).ConfigureAwait(false);
        memory.Position = 0;
        return memory;
    }

    public async Task<JsonElement?> UploadAsync(
        string path, Stream content, string field, string fileName,
        IProgress<int>? progress = null, CancellationToken ct = default)
    {
        using var form = new MultipartFormDataContent();
        var tracked = new ProgressStream(content, content.Length, progress);
        form.Add(new StreamContent(tracked), field, fileName);
        using var response = await _http.PostAsync(path, form, ct).ConfigureAwait(false);
        var text = await response.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
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

/// <summary>Incremental SSE framing: one event per blank line, no whole-body buffering.</summary>
public static class SseParser
{
    public static async IAsyncEnumerable<HubEvent> ParseAsync(
        Stream stream, [EnumeratorCancellation] CancellationToken ct = default)
    {
        using var reader = new StreamReader(stream, Encoding.UTF8, detectEncodingFromByteOrderMarks: false,
            bufferSize: 4096, leaveOpen: true);
        string? name = null, id = null;
        var data = new StringBuilder();
        while (!ct.IsCancellationRequested)
        {
            var line = await reader.ReadLineAsync(ct).ConfigureAwait(false);
            if (line is null) break;
            if (line.Length == 0)
            {
                if (data.Length > 0 || name is not null)
                    yield return new HubEvent { Name = name ?? SseEvents.Message, Data = data.ToString(), Id = id };
                name = null; id = null; data.Clear();
                continue;
            }
            if (line[0] == ':') continue;
            var colon = line.IndexOf(':');
            var field = colon < 0 ? line : line[..colon];
            var value = colon < 0 ? string.Empty : line[(colon + 1)..].TrimStart(' ');
            switch (field)
            {
                case "event": name = value; break;
                case "data": if (data.Length > 0) data.Append('\n'); data.Append(value); break;
                case "id": id = value; break;
                case "retry": break;
            }
        }
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
