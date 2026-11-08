using System.Net;
using System.Security.Authentication;
using AgentBuddy.Core.Contracts;
using AgentBuddy.Shell.Credentials;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;

namespace AgentBuddy.Shell.Loopback;

/// <summary>
/// True streaming reverse proxy. SSE responses are never buffered and never
/// given an overall timeout; only the connect phase is bounded.
/// </summary>
public static class ForwardHandler
{
    public static readonly HashSet<string> HopByHop = new(StringComparer.OrdinalIgnoreCase)
    {
        "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
        "te", "trailer", "transfer-encoding", "upgrade", "proxy-connection"
    };

    private static readonly HashSet<string> SkipRequestHeaders = new(StringComparer.OrdinalIgnoreCase)
    {
        "host", "content-length", "authorization", "cookie", "origin", "referer", "accept-encoding"
    };

    public static async Task HandleAsync(HttpContext context, Uri upstreamBase, HttpClient client,
        ICredentialStore credentials, string selfUrl, CancellationToken ct)
    {
        var target = new Uri(upstreamBase, (context.Request.Path.Value ?? "/") + context.Request.QueryString.Value);
        using var request = new HttpRequestMessage(new HttpMethod(context.Request.Method), target);
        foreach (var header in context.Request.Headers)
        {
            if (HopByHop.Contains(header.Key) || SkipRequestHeaders.Contains(header.Key)) continue;
            request.Headers.TryAddWithoutValidation(header.Key, header.Value.ToArray());
        }
        request.Headers.TryAddWithoutValidation("Accept-Encoding", "identity");

        var inbound = FilterProxyCookie(context.Request.Headers.Cookie.ToString());
        var stored = await credentials.GetAsync("session", ct).ConfigureAwait(false);
        var cookies = new List<string>();
        if (!string.IsNullOrEmpty(inbound)) cookies.Add(inbound);
        if (!string.IsNullOrEmpty(stored) && !cookies.Any(c => c.StartsWith("session=", StringComparison.Ordinal)))
            cookies.Add(stored);
        if (cookies.Count > 0) request.Headers.TryAddWithoutValidation("Cookie", string.Join("; ", cookies));

        if (context.Request.ContentLength is > 0 || context.Request.Headers.ContainsKey("Transfer-Encoding"))
            request.Content = new StreamContent(context.Request.Body);

        using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct)
            .ConfigureAwait(false);
        context.Response.StatusCode = (int)response.StatusCode;
        foreach (var header in response.Headers)
        {
            var name = header.Key;
            if (HopByHop.Contains(name) || name.Equals("Content-Length", StringComparison.OrdinalIgnoreCase)) continue;
            if (name.Equals("Set-Cookie", StringComparison.OrdinalIgnoreCase))
            {
                foreach (var raw in header.Value)
                {
                    context.Response.Headers.Append("Set-Cookie", RewriteSetCookie(raw));
                    await PersistSessionAsync(credentials, raw, ct).ConfigureAwait(false);
                }
                continue;
            }
            if (name.Equals("Location", StringComparison.OrdinalIgnoreCase))
            {
                foreach (var raw in header.Value)
                    context.Response.Headers.Append("Location", RewriteLocation(raw, upstreamBase.ToString().TrimEnd('/'), selfUrl));
                continue;
            }
            foreach (var value in header.Value) context.Response.Headers.Append(name, value);
        }
        foreach (var header in response.Content.Headers)
        {
            if (header.Key.Equals("Content-Length", StringComparison.OrdinalIgnoreCase)) continue;
            foreach (var value in header.Value) context.Response.Headers.Append(header.Key, value);
        }

        var isEventStream = (response.Content.Headers.ContentType?.MediaType ?? "")
            .Contains("text/event-stream", StringComparison.OrdinalIgnoreCase)
            || (context.Request.Path.Value ?? "").EndsWith("/events", StringComparison.OrdinalIgnoreCase);
        if (isEventStream)
        {
            context.Response.Headers.CacheControl = "no-cache";
            context.Features.Get<IHttpResponseBodyFeature>()?.DisableBuffering();
        }
        await response.Content.CopyToAsync(context.Response.Body, ct).ConfigureAwait(false);
    }

    /// <summary>The proxy's own cookie must never reach the upstream server.</summary>
    public static string FilterProxyCookie(string raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return "";
        var kept = raw.Split(';')
            .Select(p => p.Trim())
            .Where(p => p.Length > 0 && !p.StartsWith(Gateway.CookieName + "=", StringComparison.Ordinal));
        return string.Join("; ", kept);
    }

    private static async Task PersistSessionAsync(ICredentialStore credentials, string raw, CancellationToken ct)
    {
        var first = raw.Split(';')[0].Trim();
        if (!first.Contains('=')) return;
        await credentials.SetAsync("session", first, ct).ConfigureAwait(false);
    }

    /// <summary>
    /// Drop Secure / Domain / original Path, turn SameSite=None into Lax, keep
    /// HttpOnly and Max-Age/Expires, and pin the cookie to the loopback root.
    /// </summary>
    public static string RewriteSetCookie(string raw)
    {
        var parts = raw.Split(';');
        if (parts.Length == 0) return "; Path=/";
        var output = parts[0].Trim();
        foreach (var part in parts.Skip(1))
        {
            var attribute = part.Trim();
            if (attribute.Length == 0) continue;
            var lower = attribute.ToLowerInvariant();
            if (lower == "secure" || lower.StartsWith("domain=", StringComparison.Ordinal) ||
                lower.StartsWith("path=", StringComparison.Ordinal)) continue;
            if (lower.StartsWith("samesite=", StringComparison.Ordinal))
            {
                var value = lower["samesite=".Length..].Trim();
                output += value == "none" ? "; SameSite=Lax" : "; " + attribute;
            }
            else output += "; " + attribute;
        }
        return output + "; Path=/";
    }

    /// <summary>Redirects back to the server land on the loopback origin; other hosts are untouched.</summary>
    public static string RewriteLocation(string raw, string upstreamBase, string selfUrl)
    {
        if (string.IsNullOrEmpty(upstreamBase) || string.IsNullOrEmpty(selfUrl) ||
            !raw.StartsWith(upstreamBase, StringComparison.Ordinal)) return raw;
        return selfUrl.TrimEnd('/') + raw[upstreamBase.Length..];
    }

    public static string Classify(Exception error) => error switch
    {
        OperationCanceledException or TimeoutException => "timeout",
        HttpRequestException http when http.InnerException is AuthenticationException => "certificate",
        HttpRequestException => "unreachable",
        _ => "unexpected"
    };
}
