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

        if (patch.TryGetPropertyValue("serverUrl", out var urlNode) && urlNode is not null)
        {
            var reason = ValidateServerUrl(urlNode.GetValue<string>());
            if (reason is not null) { await WriteJson(context, 400, new { ok = false, code = reason }); return; }
        }
        if (patch.TryGetPropertyValue("executorRoot", out var rootNode) && rootNode is not null)
        {
            var root = rootNode.GetValue<string>();
            if (root.Length > 0 && ExecutorPolicy.ValidateRoot(root) is { } reason)
            {
                await WriteJson(context, 400, new { ok = false, code = reason });
                return;
            }
        }
        if (patch.TryGetPropertyValue("executorAllowlist", out var listNode) && listNode is JsonArray list)
        {
            foreach (var item in list)
            {
                var name = item?.GetValue<string>() ?? "";
                if (ExecutorReject.Shells.Contains(name, StringComparer.OrdinalIgnoreCase))
                {
                    await WriteJson(context, 400, new { ok = false, code = ExecutorReject.CommandNotAllowed });
                    return;
                }
            }
        }
        if (patch.TryGetPropertyValue("executorApiKey", out var keyNode) && keyNode is not null)
        {
            await services.Credentials.SetAsync("executor_api_key", keyNode.GetValue<string>(), ct).ConfigureAwait(false);
            patch["executorApiKey"] = ""; // the secret never lands in config.json
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
        try
        {
            using var doc = JsonDocument.Parse(text);
            var root = doc.RootElement;
            var enabled = root.TryGetProperty("enabled", out var e) && e.GetBoolean();
            var confirmed = root.TryGetProperty("userConfirmed", out var c) && c.GetBoolean();
            if (root.TryGetProperty("executorRoot", out var r) || root.TryGetProperty("executorAllowlist", out _))
                await services.Config.ApplyPatchAsync(text, ct).ConfigureAwait(false);
            services.Executor.SetEnabled(enabled, confirmed);
            await WriteJson(context, 200, new { ok = true, status = services.Executor.Status });
        }
        catch (ExecutorRejectException ex)
        {
            await WriteJson(context, 400, new { ok = false, code = ex.Reason });
        }
        catch (JsonException) { await WriteJson(context, 400, new { ok = false, code = ErrorCodes.InvalidJson }); }
        catch (Exception) { await WriteJson(context, 500, new { ok = false, code = ErrorCodes.NotSaved }); }
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
            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(Limits.ProbeTimeoutSeconds) };
            using var response = await client.GetAsync(new Uri(new Uri(url.TrimEnd('/') + "/"), "healthz"), ct).ConfigureAwait(false);
            await WriteJson(context, 200, new { ok = true, status = (int)response.StatusCode });
        }
        catch (Exception ex)
        {
            await WriteJson(context, 200, new { ok = false, reason = ForwardHandler.Classify(ex) });
        }
    }

    private static async Task NotifyAsync(HttpContext context, ShellServices services, CancellationToken ct)
    {
        var text = await ReadBodyAsync(context, Limits.MaxShellBody, ct);
        if (text is null) { await WriteJson(context, 400, new { ok = false, code = ErrorCodes.InvalidJson }); return; }
        string title, body, link;
        try
        {
            using var doc = JsonDocument.Parse(text);
            var root = doc.RootElement;
            title = root.TryGetProperty("title", out var t) ? t.GetString() ?? "" : "";
            body = root.TryGetProperty("body", out var b) ? b.GetString() ?? "" : "";
            link = root.TryGetProperty("link", out var l) && l.ValueKind == JsonValueKind.String ? l.GetString() ?? "" : "";
        }
        catch (JsonException) { await WriteJson(context, 400, new { ok = false, code = ErrorCodes.InvalidJson }); return; }

        if (!services.Config.Current.NotifyEnabled || services.QuietUntil > DateTimeOffset.UtcNow)
        {
            await WriteJson(context, 200, new { ok = false, reason = "disabled" });
            return;
        }
        if (title.Length == 0 || body.Length == 0)
        {
            await WriteJson(context, 200, new { ok = false, reason = "missing_fields" });
            return;
        }
        if (link.Length > 0) services.DeepLinks.Enqueue(link);
        var reason = await services.Notifier.NotifyAsync(title, body, link.Length > 0 ? link : null, ct).ConfigureAwait(false);
        if (reason is null) await WriteJson(context, 200, new { ok = true });
        else await WriteJson(context, 200, new { ok = false, reason });
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

    public static string? ValidateServerUrl(string value)
    {
        if (string.IsNullOrWhiteSpace(value)) return ErrorCodes.Empty;
        if (!Uri.TryCreate(value.Trim(), UriKind.Absolute, out var uri) || string.IsNullOrEmpty(uri.Host) ||
            (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps)) return ErrorCodes.Invalid;
        return null;
    }

    private static async Task<string?> ReadBodyAsync(HttpContext context, int maxBytes, CancellationToken ct)
    {
        if (context.Request.ContentLength > maxBytes) return null;
        using var reader = new StreamReader(context.Request.Body, Encoding.UTF8, false, 1024, leaveOpen: true);
        var text = await reader.ReadToEndAsync(ct).ConfigureAwait(false);
        return Encoding.UTF8.GetByteCount(text) > maxBytes ? null : text;
    }

    private static async Task WriteJson(HttpContext context, int status, object payload)
    {
        context.Response.StatusCode = status;
        context.Response.ContentType = "application/json; charset=utf-8";
        await context.Response.WriteAsJsonAsync(payload, JsonOptions).ConfigureAwait(false);
    }
}
