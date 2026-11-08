using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using AgentBuddy.Core.Contracts;
using AgentBuddy.Shell.Executor;
using Microsoft.AspNetCore.Http;

namespace AgentBuddy.Shell.Loopback;

/// <summary>All 13 /__shell/* routes. Unknown paths return {"code":"not_found"}.</summary>
public static class ShellRoutes
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public static async Task HandleAsync(HttpContext context, ShellServices services, CancellationToken ct)
    {
        var method = context.Request.Method;
        var path = context.Request.Path.Value ?? "";
        switch ((method, path))
        {
            case ("GET", ShellEndpoints.Connect):
            case ("GET", "/__shell"):
            case ("GET", "/__shell/"):
                await WriteJson(context, 200, new { page = "connect", app = "agentbuddy", shell = "avalonia" });
                return;
            case ("GET", ShellEndpoints.About):
                await WriteJson(context, 200, new { page = "about", version = services.Version, commit = services.Commit });
                return;
            case ("GET", ShellEndpoints.Config):
                await GetConfigAsync(context, services, ct);
                return;
            case ("POST", ShellEndpoints.Config):
                await SetConfigAsync(context, services, ct);
                return;
            case ("GET", ShellEndpoints.Executor):
                await WriteJson(context, 200, new
                {
                    status = services.Executor.Status,
                    limits = new
                    {
                        maxOutputBytes = services.Executor.Limits.MaxOutputBytes,
                        timeoutSeconds = services.Executor.Limits.TimeoutSeconds
                    },
                    shellsRefused = true
                });
                return;
            case ("POST", ShellEndpoints.Executor):
                await SetExecutorAsync(context, services, ct);
                return;
            case ("POST", ShellEndpoints.Test):
                await TestConnectionAsync(context, ct);
                return;
            case ("POST", ShellEndpoints.Notify):
                await NotifyAsync(context, services, ct);
                return;
            case ("POST", ShellEndpoints.Badge):
                await SetBadgeAsync(context, services, ct);
                return;
            case ("POST", ShellEndpoints.Hide):
                if (services.HideWindow is not null) await services.HideWindow();
                await WriteJson(context, 200, new { ok = true });
                return;
            case ("GET", ShellEndpoints.Upgrade):
                await UpgradeStateAsync(context, services);
                return;
            case ("POST", ShellEndpoints.UpgradeCheck):
                await UpgradeStateAsync(context, services, await services.Upgrade.CheckAsync(true, ct));
                return;
            case ("POST", ShellEndpoints.UpgradeInstall):
                await UpgradeStateAsync(context, services, await services.Upgrade.InstallAsync(ct), isInstall: true);
                return;
            default:
                await WriteJson(context, 404, new { code = ErrorCodes.NotFound });
                return;
        }
    }

    private static async Task GetConfigAsync(HttpContext context, ShellServices services, CancellationToken ct)
    {
        var key = await services.Credentials.GetAsync("executor_api_key", ct).ConfigureAwait(false);
        var view = ShellConfigView.From(services.Config.Current, !string.IsNullOrEmpty(key), services.Credentials.Backend);
        await WriteJson(context, 200, view);
    }

    private static async Task SetConfigAsync(HttpContext context, ShellServices services, CancellationToken ct)
    {
        var text = await ReadBodyAsync(context, Limits.MaxShellBody, ct);
        if (text is null) { await WriteJson(context, 400, new { ok = false, code = ErrorCodes.InvalidJson }); return; }
        JsonObject patch;
        try { patch = JsonNode.Parse(text)?.AsObject() ?? throw new FormatException(); }
        catch (Exception) { await WriteJson(context, 400, new { ok = false, code = ErrorCodes.InvalidJson }); return; }

        // The API key is a credential: it is lifted out of the patch before the patch
        // is validated or merged, so it can never reach config.json on this path.
        var keyReason = ExtractApiKey(patch, out var apiKey);
        if (keyReason is not null) { await WriteJson(context, 400, new { ok = false, code = keyReason }); return; }
        var reason = ValidatePatch(patch);
        if (reason is not null) { await WriteJson(context, 400, new { ok = false, code = reason }); return; }
        if (apiKey is not null)
        {
            try { await services.Credentials.SetAsync("executor_api_key", apiKey, ct).ConfigureAwait(false); }
            catch (Exception) { await WriteJson(context, 500, new { ok = false, code = ErrorCodes.NotSaved }); return; }
        }
        try
        {
            var updated = await services.Config.ApplyPatchAsync(patch.ToJsonString(), ct).ConfigureAwait(false);
            if (patch.ContainsKey("lang")) services.Tray.Refresh(updated.Lang);
            if (patch.ContainsKey("notifyQuietMinutes"))
                services.QuietUntil = global::AgentBuddy.Core.Services.NotificationDecider
                    .QuietUntil(DateTimeOffset.UtcNow, updated.NotifyQuietMinutes);
            await WriteJson(context, 200, new { ok = true });
        }
        catch (FormatException) { await WriteJson(context, 400, new { ok = false, code = ErrorCodes.InvalidJson }); }
        catch (Exception) { await WriteJson(context, 500, new { ok = false, code = ErrorCodes.NotSaved }); }
    }

    private static async Task SetExecutorAsync(HttpContext context, ShellServices services, CancellationToken ct)
    {
        var text = await ReadBodyAsync(context, Limits.MaxShellBody, ct);
        if (text is null) { await WriteJson(context, 400, new { ok = false, code = ErrorCodes.InvalidJson }); return; }
        JsonObject body;
        try { body = JsonNode.Parse(text)?.AsObject() ?? throw new FormatException(); }
        catch (Exception) { await WriteJson(context, 400, new { ok = false, code = ErrorCodes.InvalidJson }); return; }
        try
        {
            var enabled = body.TryGetPropertyValue("enabled", out var e) && e is JsonValue ev && ev.TryGetValue<bool>(out var b) && b;
            var confirmed = body.TryGetPropertyValue("userConfirmed", out var c) && c is JsonValue cv && cv.TryGetValue<bool>(out var ok) && ok;

            // The same validation as POST /__shell/config: a bypass here would let a
            // caller set an unusable root, allowlist a shell, or smuggle the API key
            // into config.json in plaintext.
            var keyReason = ExtractApiKey(body, out var apiKey);
            if (keyReason is not null) { await WriteJson(context, 400, new { ok = false, code = keyReason }); return; }
            var reason = ValidatePatch(body);
            if (reason is not null) { await WriteJson(context, 400, new { ok = false, code = reason }); return; }

            if (apiKey is not null) await services.Credentials.SetAsync("executor_api_key", apiKey, ct).ConfigureAwait(false);
            if (body.ContainsKey("executorRoot") || body.ContainsKey("executorAllowlist"))
                await services.Config.ApplyPatchAsync(body.ToJsonString(), ct).ConfigureAwait(false);
            services.Executor.SetEnabled(enabled, confirmed);
            await WriteJson(context, 200, new { ok = true, status = services.Executor.Status });
        }
        catch (ExecutorRejectException ex)
        {
            await WriteJson(context, 400, new { ok = false, code = ex.Reason });
        }
        catch (Exception) { await WriteJson(context, 500, new { ok = false, code = ErrorCodes.NotSaved }); }
    }

    /// <summary>
    /// Validates every field the two PATCH-like routes accept. Types are checked as
    /// well as values: a JSON number where a string belongs is a 400, not a 500.
    /// </summary>
    public static string? ValidatePatch(JsonObject patch)
    {
        if (patch.TryGetPropertyValue("serverUrl", out var urlNode) && urlNode is not null)
        {
            if (urlNode is not JsonValue urlValue || !urlValue.TryGetValue<string>(out var url))
                return ErrorCodes.Invalid;
            if (ValidateServerUrl(url) is { } reason) return reason;
        }
        if (patch.TryGetPropertyValue("executorRoot", out var rootNode) && rootNode is not null)
        {
            if (rootNode is not JsonValue rootValue || !rootValue.TryGetValue<string>(out var root))
                return ExecutorReject.RootUnusable;
            if (root.Length > 0 && ExecutorPolicy.ValidateRoot(root) is { } reason) return reason;
        }
        if (patch.TryGetPropertyValue("executorAllowlist", out var listNode) && listNode is not null)
        {
            if (listNode is not JsonArray list) return ExecutorReject.CommandNotAllowed;
            foreach (var item in list)
            {
                if (item is not JsonValue value || !value.TryGetValue<string>(out var name))
                    return ExecutorReject.CommandNotAllowed;
                if (ExecutorPolicy.ValidateAllowlistEntry(name) is { } reason) return reason;
            }
        }
        if (patch.TryGetPropertyValue("executorMaxConcurrency", out var concurrency) && concurrency is not null)
        {
            if (concurrency is not JsonValue value || !value.TryGetValue<int>(out _)) return ErrorCodes.Invalid;
        }
        if (patch.TryGetPropertyValue("notifyQuietMinutes", out var quiet) && quiet is not null)
        {
            if (quiet is not JsonValue value || !value.TryGetValue<int>(out _)) return ErrorCodes.Invalid;
        }
        return null;
    }

    /// <summary>Removes executorApiKey from the patch and hands it back for the store.</summary>
    private static string? ExtractApiKey(JsonObject patch, out string? key)
    {
        key = null;
        if (!patch.TryGetPropertyValue("executorApiKey", out var node) || node is null) return null;
        patch.Remove("executorApiKey");
        if (node is not JsonValue value || !value.TryGetValue<string>(out var text)) return ErrorCodes.Invalid;
        if (text.Length > Limits.MaxSecretChars) return ErrorCodes.Invalid;
        if (text.Length > 0) key = text;
        return null;
    }

    private static async Task TestConnectionAsync(HttpContext context, CancellationToken ct)
    {
        var text = await ReadBodyAsync(context, Limits.MaxShellBody, ct);
        if (text is null) { await WriteJson(context, 400, new { ok = false, code = ErrorCodes.InvalidJson }); return; }
        string url;
        try
        {
            using var doc = JsonDocument.Parse(text);
            url = doc.RootElement.TryGetProperty("serverUrl", out var u) ? u.GetString() ?? "" : "";
        }
        catch (JsonException) { await WriteJson(context, 400, new { ok = false, code = ErrorCodes.InvalidJson }); return; }
        var reason = ValidateServerUrl(url);
        if (reason is not null) { await WriteJson(context, 400, new { ok = false, code = reason }); return; }
        try
        {
            using var response = await ProbeClient.GetAsync(
                new Uri(new Uri(url.TrimEnd('/') + "/"), "healthz"), ct).ConfigureAwait(false);
            await WriteJson(context, 200, new { ok = true, status = (int)response.StatusCode });
        }
        catch (Exception ex)
        {
            await WriteJson(context, 200, new { ok = false, reason = ForwardHandler.Classify(ex) });
        }
    }

    /// <summary>
    /// The health probe never follows a redirect: a server that answers 302 to
    /// 127.0.0.1:22 would otherwise turn this endpoint into a port scanner.
    /// </summary>
    private static readonly HttpClient ProbeClient = new(new SocketsHttpHandler
    {
        AllowAutoRedirect = false,
        UseCookies = false,
        AutomaticDecompression = DecompressionMethods.None,
        ConnectTimeout = TimeSpan.FromSeconds(Limits.ConnectTimeoutSeconds)
    })
    { Timeout = TimeSpan.FromSeconds(Limits.ProbeTimeoutSeconds) };

    private static async Task NotifyAsync(HttpContext context, ShellServices services, CancellationToken ct)
    {
        var text = await ReadBodyAsync(context, Limits.MaxShellBody, ct);
        if (text is null) { await WriteJson(context, 400, new { ok = false, code = ErrorCodes.InvalidJson }); return; }
        string title, body, link;
        try
        {
            using var doc = JsonDocument.Parse(text);
            var root = doc.RootElement;
            title = root.TryGetProperty("title", out var t) && t.ValueKind == JsonValueKind.String ? t.GetString() ?? "" : "";
            body = root.TryGetProperty("body", out var b) && b.ValueKind == JsonValueKind.String ? b.GetString() ?? "" : "";
            link = root.TryGetProperty("link", out var l) && l.ValueKind == JsonValueKind.String ? l.GetString() ?? "" : "";
        }
        catch (JsonException) { await WriteJson(context, 400, new { ok = false, code = ErrorCodes.InvalidJson }); return; }

        if (!services.Config.Current.NotifyEnabled || services.QuietUntil > DateTimeOffset.UtcNow)
        {
            await WriteJson(context, 200, new { ok = false, reason = "disabled" });
            return;
        }
        if (title.Trim().Length == 0 || body.Trim().Length == 0)
        {
            await WriteJson(context, 200, new { ok = false, reason = "missing_fields" });
            return;
        }
        // Both strings end up in an OS notification (and on macOS/Windows in a
        // script argument): keep them short and single-line.
        title = Clip(title, Limits.MaxNotifyTitleChars);
        body = Clip(body, Limits.MaxNotifyBodyChars);
        var queued = link.Length > 0 && services.DeepLinks.Enqueue(link); // invalid links are dropped, the toast still shows
        var reason = await services.Notifier.NotifyAsync(title, body, queued ? link : null, ct).ConfigureAwait(false);
        if (reason is null) await WriteJson(context, 200, new { ok = true });
        else await WriteJson(context, 200, new { ok = false, reason });
    }

    private static string Clip(string value, int max)
    {
        var single = value.Replace('\r', ' ').Replace('\n', ' ').Trim();
        return single.Length <= max ? single : single[..max];
    }

    private static async Task SetBadgeAsync(HttpContext context, ShellServices services, CancellationToken ct)
    {
        var text = await ReadBodyAsync(context, Limits.MaxShellBody, ct);
        if (text is null) { await WriteJson(context, 400, new { ok = false, code = ErrorCodes.InvalidJson }); return; }
        try
        {
            using var doc = JsonDocument.Parse(text);
            if (!doc.RootElement.TryGetProperty("count", out var c) || !c.TryGetInt32(out var count) || count < 0)
            {
                await WriteJson(context, 400, new { ok = false, code = ErrorCodes.InvalidCount });
                return;
            }
            var clamped = global::AgentBuddy.Core.Services.NotificationDecider.ClampBadge(count);
            services.Tray.SetUnread(clamped);
            await WriteJson(context, 200, new { ok = true, count = clamped });
        }
        catch (JsonException) { await WriteJson(context, 400, new { ok = false, code = ErrorCodes.InvalidJson }); }
    }

    private static async Task UpgradeStateAsync(HttpContext context, ShellServices services,
        UpgradeState? state = null, bool isInstall = false)
    {
        var current = state ?? services.Upgrade.State;
        if (current.Status == UpgradeCodes.Machine(UpgradeCode.NotConfigured))
        {
            await WriteJson(context, 404, new { code = ErrorCodes.NotConfigured });
            return;
        }
        if (isInstall && current.Status is not ("installing" or "available"))
        {
            await WriteJson(context, 400, new { code = current.Status });
            return;
        }
        await WriteJson(context, 200, current);
    }

    /// <summary>
    /// A server URL is an http(s) origin and nothing else: no userinfo (a password
    /// in the URL would land in config.json and in any log line that prints it),
    /// no whitespace or control characters, no fragment.
    /// </summary>
    public static string? ValidateServerUrl(string value)
    {
        if (string.IsNullOrWhiteSpace(value)) return ErrorCodes.Empty;
        var trimmed = value.Trim();
        if (trimmed.Length > 2048) return ErrorCodes.Invalid;
        if (trimmed.Any(char.IsControl) || trimmed.Any(char.IsWhiteSpace)) return ErrorCodes.Invalid;
        if (trimmed.Contains('#')) return ErrorCodes.Invalid;
        if (!Uri.TryCreate(trimmed, UriKind.Absolute, out var uri) || string.IsNullOrEmpty(uri.Host) ||
            (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps)) return ErrorCodes.Invalid;
        if (uri.UserInfo.Length > 0) return ErrorCodes.Invalid;
        return null;
    }

    private static async Task<string?> ReadBodyAsync(HttpContext context, int maxBytes, CancellationToken ct)
    {
        if (context.Request.ContentLength > maxBytes) return null;
        using var reader = new StreamReader(context.Request.Body, Encoding.UTF8, false, 1024, leaveOpen: true);
        // A chunked request has no Content-Length, so the cap is enforced on the
        // bytes actually read rather than on the advertised length.
        var buffer = new char[4096];
        var text = new StringBuilder();
        var bytes = 0;
        while (true)
        {
            var read = await reader.ReadAsync(buffer, ct).ConfigureAwait(false);
            if (read == 0) break;
            bytes += Encoding.UTF8.GetByteCount(buffer, 0, read);
            if (bytes > maxBytes) return null;
            text.Append(buffer, 0, read);
        }
        return text.ToString();
    }

    private static async Task WriteJson(HttpContext context, int status, object payload)
    {
        context.Response.StatusCode = status;
        context.Response.ContentType = "application/json; charset=utf-8";
        context.Response.Headers.CacheControl = "no-store";
        context.Response.Headers["X-Content-Type-Options"] = "nosniff";
        await context.Response.WriteAsJsonAsync(payload, JsonOptions).ConfigureAwait(false);
    }
}
