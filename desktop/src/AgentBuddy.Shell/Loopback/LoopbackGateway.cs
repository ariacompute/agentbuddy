using System.Net;
using System.Net.Security;
using System.Text.Json;
using AgentBuddy.Core.Contracts;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace AgentBuddy.Shell.Loopback;

/// <summary>
/// Loopback reverse proxy on 127.0.0.1:0. Only /api, /a2a, /healthz and
/// /.well-known are forwarded; /__shell/* is the local control plane. Every
/// request except bootstrap needs the ab_proxy cookie (or a Bearer token).
/// </summary>
public sealed class LoopbackGateway(ShellServices services, ILogger? logger = null) : IAsyncDisposable
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private readonly BootstrapAuth _auth = new();
    private WebApplication? _app;
    private HttpClient? _upstream;

    public Uri BaseAddress { get; private set; } = new("http://127.0.0.1:1/");
    public string Token => _auth.Token;
    public Uri BootstrapUri => new(BaseAddress, ShellEndpoints.Bootstrap + "?nonce=" + Uri.EscapeDataString(_auth.Nonce));

    public async Task<Uri> StartAsync(CancellationToken ct = default)
    {
        if (_app is not null) return BaseAddress;
        // ContentRootPath is pinned to the install directory: a stray appsettings.json
        // in whatever directory the user launched from must not shape the host.
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions
        {
            Args = [],
            ContentRootPath = AppContext.BaseDirectory,
            EnvironmentName = Environments.Production
        });
        builder.Logging.ClearProviders();
        // Port 0 lets Kestrel pick a free port and report it back — no bind/close/bind
        // race where another local process could take the port between the two binds.
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.WebHost.ConfigureKestrel(options =>
        {
            options.Limits.MaxRequestBodySize = Limits.MaxRequestBody;
            options.AddServerHeader = false;
            options.Limits.MaxRequestLineSize = 16 * 1024;
            options.Limits.MaxRequestHeadersTotalSize = 32 * 1024;
        });
        var app = builder.Build();
        app.Run(DispatchAsync);
        _upstream = CreateUpstreamClient();
        await app.StartAsync(ct).ConfigureAwait(false);
        _app = app;
        var address = app.Services.GetRequiredService<IServer>()
            .Features.Get<IServerAddressesFeature>()?.Addresses.FirstOrDefault();
        if (!Uri.TryCreate(address, UriKind.Absolute, out var bound) || bound.Port <= 0)
        {
            await app.DisposeAsync().ConfigureAwait(false);
            _app = null;
            throw new InvalidOperationException("loopback gateway did not report a bound address");
        }
        BaseAddress = new Uri($"http://127.0.0.1:{bound.Port}/");
        logger?.LogInformation("loopback gateway ready on 127.0.0.1:{Port}", bound.Port);
        return BaseAddress;
    }

    public async Task StopAsync(CancellationToken ct = default)
    {
        if (_app is null) return;
        await _app.StopAsync(ct).ConfigureAwait(false);
        await _app.DisposeAsync().ConfigureAwait(false);
        _app = null;
    }

    private HttpClient CreateUpstreamClient()
    {
        var handler = new SocketsHttpHandler
        {
            AllowAutoRedirect = false,
            UseCookies = false,
            AutomaticDecompression = DecompressionMethods.None,
            ConnectTimeout = TimeSpan.FromSeconds(Limits.ConnectTimeoutSeconds)
        };
        handler.SslOptions.RemoteCertificateValidationCallback = (_, _, _, errors) =>
            errors == SslPolicyErrors.None || services.Config.Current.AcceptInvalidCerts;
        return new HttpClient(handler) { Timeout = Timeout.InfiniteTimeSpan };
    }

    private async Task DispatchAsync(HttpContext context)
    {
        var path = context.Request.Path.Value ?? "/";
        try
        {
            if (!_auth.OriginAllowed(context, BaseAddress.ToString()))
            {
                await Write(context, 403, new { code = ErrorCodes.ProxyOriginRefused });
                return;
            }
            if (path == ShellEndpoints.Bootstrap) { await Bootstrap(context); return; }
            if (!_auth.IsAuthorized(context))
            {
                await Write(context, 401, new { code = ErrorCodes.ProxyUnauthorized });
                return;
            }
            if (path == "/")
            {
                await Write(context, 200, new { app = "agentbuddy", shell = "avalonia", version = services.Version });
                return;
            }
            if (global::AgentBuddy.Core.Contracts.Gateway.IsRemotePath(path) && !IsForwardablePath(path))
            {
                await Write(context, 400, new { code = ErrorCodes.Invalid });
                return;
            }
            if (global::AgentBuddy.Core.Contracts.Gateway.IsRemotePath(path)) { await ForwardAsync(context); return; }
            if (path.StartsWith(ShellEndpoints.Prefix, StringComparison.Ordinal))
            {
                await ShellRoutes.HandleAsync(context, services, context.RequestAborted);
                return;
            }
            await Write(context, 404, new { code = ErrorCodes.NotFound });
        }
        catch (Exception error)
        {
            logger?.LogError(error, "loopback dispatch failed for {Path}", path);
            if (!context.Response.HasStarted)
                await Write(context, 500, new { code = ErrorCodes.InternalError });
        }
    }

    private async Task Bootstrap(HttpContext context)
    {
        if (!string.Equals(context.Request.Method, "GET", StringComparison.OrdinalIgnoreCase))
        {
            await Write(context, 404, new { code = ErrorCodes.NotFound });
            return;
        }
        var nonce = context.Request.Query["nonce"].ToString();
        if (!_auth.TryConsumeNonce(nonce))
        {
            await Write(context, 403, new
            {
                ok = false,
                code = ErrorCodes.ProxyNonceRefused,
                reason = "nonce missing, expired or already used"
            });
            return;
        }
        context.Response.Headers.Append("Set-Cookie", _auth.CookieHeader);
        context.Response.StatusCode = StatusCodes.Status303SeeOther;
        context.Response.Headers.Location = "/";
    }

    private async Task ForwardAsync(HttpContext context)
    {
        var serverUrl = services.Config.Current.ServerUrl;
        if (string.IsNullOrWhiteSpace(serverUrl) || !Uri.TryCreate(serverUrl, UriKind.Absolute, out var upstream))
        {
            await Write(context, 503, new { code = ErrorCodes.ServerNotConfigured });
            return;
        }
        try
        {
            await ForwardHandler.HandleAsync(context, upstream, _upstream!, services.Credentials,
                BaseAddress.ToString().TrimEnd('/'), context.RequestAborted);
        }
        catch (Exception error) when (!context.Response.HasStarted)
        {
            logger?.LogWarning(error, "upstream forwarding failed");
            await Write(context, 502, new { code = ForwardHandler.Classify(error) });
        }
    }

    /// <summary>
    /// No forwarded path may carry a traversal segment, a backslash or a doubled
    /// slash: those are how a base-URI join gets turned into an authority change
    /// ("//host/x") or an escape from the API prefix ("/api/../admin").
    /// </summary>
    public static bool IsForwardablePath(string path) =>
        !path.Contains("..", StringComparison.Ordinal) &&
        !path.Contains('\\') &&
        !path.Contains("//", StringComparison.Ordinal);

    private static async Task Write(HttpContext context, int status, object payload)
    {
        context.Response.StatusCode = status;
        context.Response.ContentType = "application/json; charset=utf-8";
        // Nothing this gateway emits is a document: no sniffing, no caching, no referrer.
        context.Response.Headers.CacheControl = "no-store";
        context.Response.Headers["X-Content-Type-Options"] = "nosniff";
        context.Response.Headers["Referrer-Policy"] = "no-referrer";
        await context.Response.WriteAsJsonAsync(payload, Json).ConfigureAwait(false);
    }

    public async ValueTask DisposeAsync()
    {
        await StopAsync().ConfigureAwait(false);
        _upstream?.Dispose();
    }
}
