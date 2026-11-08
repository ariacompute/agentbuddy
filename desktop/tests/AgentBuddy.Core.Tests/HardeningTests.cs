using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using AgentBuddy.Core.Contracts;
using AgentBuddy.Core.Gateway;
using AgentBuddy.Core.Services;
using Xunit;

namespace AgentBuddy.Core.Tests;

/// <summary>
/// The streaming paths are the ones a hostile or merely wedged peer controls, so
/// each case pins a bound that used to be "read it all and hope".
/// </summary>
public class StreamBoundTests
{
    [Fact]
    public async Task AnEventPastTheCapIsDroppedAndFramingSurvives()
    {
        var builder = new StringBuilder();
        builder.Append("event: task_status_update\ndata: ");
        builder.Append('x', Limits.MaxEventBytes + 1024);
        builder.Append("\n\n");
        builder.Append("event: message\ndata: ok\n\n");

        var events = await ReadAsync(builder.ToString());
        var single = Assert.Single(events);
        Assert.Equal("message", single.Name);
        Assert.Equal("ok", single.Data);
    }

    [Fact]
    public async Task AnEndlessLineIsDroppedInsteadOfBuffered()
    {
        var builder = new StringBuilder();
        builder.Append("data: ");
        builder.Append('y', Limits.MaxEventBytes + 4096); // no newline yet
        builder.Append("\n\n");                            // line ends, then the event ends
        builder.Append("event: message\ndata: after\n\n");

        var events = await ReadAsync(builder.ToString());
        var single = Assert.Single(events);
        Assert.Equal("message", single.Name);
        Assert.Equal("after", single.Data);
    }

    [Fact]
    public async Task CrlfCommentsAndMultiLineDataAreFramedCorrectly()
    {
        const string stream = ": keep-alive\r\nevent: thread.message\r\nid: 7\r\ndata: {\"a\":1}\r\ndata: two\r\n\r\n";
        var single = Assert.Single(await ReadAsync(stream));
        Assert.Equal("thread.message", single.Name);
        Assert.Equal("7", single.Id);
        Assert.Equal("{\"a\":1}\ntwo", single.Data);
    }

    [Fact]
    public async Task AnEmptyStreamYieldsNothing()
    {
        Assert.Empty(await ReadAsync(""));
        Assert.Empty(await ReadAsync(": only a comment\n\n"));
    }

    private static async Task<List<HubEvent>> ReadAsync(string text)
    {
        await using var stream = new MemoryStream(Encoding.UTF8.GetBytes(text));
        var events = new List<HubEvent>();
        await foreach (var item in SseParser.ParseAsync(stream)) events.Add(item);
        return events;
    }
}

public class ResponseBoundTests
{
    [Fact]
    public async Task AnOversizedJsonBodyIsNotBuffered()
    {
        var body = new string('z', Limits.MaxJsonBytes + 1024);
        using var client = ClientFor(() => JsonResponse(body));
        var result = await client.SendAsync("/api/workspace", HttpMethod.Get);
        Assert.Null(result);
    }

    [Fact]
    public async Task AnOversizedBodyWithoutAContentLengthIsAlsoRefused()
    {
        using var client = ClientFor(() => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StreamContent(new MemoryStream(Encoding.UTF8.GetBytes(
                new string('z', Limits.MaxJsonBytes + 1024))))
        });
        Assert.Null(await client.SendAsync("/api/workspace", HttpMethod.Get));
    }

    [Fact]
    public async Task ASmallBodyStillParses()
    {
        using var client = ClientFor(() => JsonResponse("{\"ok\":true}"));
        var result = await client.SendAsync("/api/workspace", HttpMethod.Get);
        Assert.NotNull(result);
        Assert.True(result!.Value.GetProperty("ok").GetBoolean());
    }

    [Fact]
    public async Task DownloadHandsOutALiveStreamAndReleasesTheResponse()
    {
        var content = new TrackingContent(Encoding.UTF8.GetBytes("file-bytes"));
        using var client = ClientFor(() => new HttpResponseMessage(HttpStatusCode.OK) { Content = content });

        var stream = await client.DownloadAsync("/api/files/1/content");
        var buffer = new byte[32];
        var read = await stream.ReadAsync(buffer);
        Assert.Equal("file-bytes", Encoding.UTF8.GetString(buffer, 0, read));
        Assert.False(content.Disposed);
        await stream.DisposeAsync();
        Assert.True(content.Disposed); // the response is owned by the returned stream
    }

    [Fact]
    public async Task AFailedDownloadCarriesTheMachineCode()
    {
        using var client = ClientFor(() => new HttpResponseMessage(HttpStatusCode.NotFound)
        {
            Content = new StringContent("{\"code\":\"not_found\"}", Encoding.UTF8, "application/json")
        });
        var error = await Assert.ThrowsAsync<HubApiException>(() => client.DownloadAsync("/api/files/9/content"));
        Assert.Equal("not_found", error.Code);
        Assert.Equal(404, error.Status);
    }

    private static HttpResponseMessage JsonResponse(string json) => new(HttpStatusCode.OK)
    {
        Content = new StringContent(json, Encoding.UTF8, "application/json")
    };

    private static AgentHubClient ClientFor(Func<HttpResponseMessage> factory)
    {
        var http = new HttpClient(new StubHandler(factory)) { BaseAddress = new Uri("http://127.0.0.1:1/") };
        return new AgentHubClient(http);
    }

    private sealed class StubHandler(Func<HttpResponseMessage> factory) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) =>
            Task.FromResult(factory());
    }

    private sealed class TrackingContent(byte[] bytes) : HttpContent
    {
        public bool Disposed { get; private set; }

        protected override Task SerializeToStreamAsync(Stream stream, TransportContext? context) =>
            stream.WriteAsync(bytes, 0, bytes.Length);

        protected override bool TryComputeLength(out long length)
        {
            length = bytes.Length;
            return true;
        }

        protected override Task<Stream> CreateContentReadStreamAsync() =>
            Task.FromResult<Stream>(new MemoryStream(bytes));

        protected override void Dispose(bool disposing)
        {
            Disposed = true;
            base.Dispose(disposing);
        }
    }
}

public class ConfigBoundTests
{
    [Fact]
    public async Task AnOversizedConfigFileIsIgnoredRatherThanRead()
    {
        var dir = Path.Combine(Path.GetTempPath(), "ab-" + Guid.NewGuid().ToString("N"));
        try
        {
            var paths = new AppPaths(dir);
            Directory.CreateDirectory(paths.ConfigDir);
            await File.WriteAllBytesAsync(paths.ConfigFile, new byte[2 * 1024 * 1024]);
            var config = await new ConfigService(paths).LoadAsync();
            Assert.Equal("", config.ServerUrl);
            Assert.True(config.Background);
        }
        finally { try { if (Directory.Exists(dir)) Directory.Delete(dir, true); } catch (Exception) { } }
    }

    [Fact]
    public async Task AnEmptyConfigFileFallsBackToDefaults()
    {
        var dir = Path.Combine(Path.GetTempPath(), "ab-" + Guid.NewGuid().ToString("N"));
        try
        {
            var paths = new AppPaths(dir);
            Directory.CreateDirectory(paths.ConfigDir);
            await File.WriteAllTextAsync(paths.ConfigFile, "");
            var config = await new ConfigService(paths).LoadAsync();
            Assert.Equal("", config.ServerUrl);
        }
        finally { try { if (Directory.Exists(dir)) Directory.Delete(dir, true); } catch (Exception) { } }
    }

    [Fact]
    public void TheJsonContractStillRoundTrips()
    {
        var config = new ShellConfig { ServerUrl = "http://localhost:3500", Lang = "ar" };
        var json = JsonSerializer.Serialize(config);
        Assert.Contains("\"server_url\"", json); // snake_case on disk, stable across versions
        var back = JsonSerializer.Deserialize<ShellConfig>(json)!;
        Assert.Equal("http://localhost:3500", back.ServerUrl);
        Assert.Equal("ar", back.Lang);
    }
}
