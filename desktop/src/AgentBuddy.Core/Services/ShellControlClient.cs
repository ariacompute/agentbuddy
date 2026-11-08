using System.Net.Http.Json;
using System.Text.Json;
using AgentBuddy.Core.Contracts;

namespace AgentBuddy.Core.Services;

/// <summary>The single entry point from ViewModels to the shell's local control plane.</summary>
public interface IShellControl
{
    Task<ShellConfigView> GetConfigAsync(CancellationToken ct = default);
    Task<ShellConfigView> SetConfigAsync(object patch, CancellationToken ct = default);
    Task<JsonElement?> GetExecutorAsync(CancellationToken ct = default);
    Task<JsonElement?> SetExecutorAsync(object patch, CancellationToken ct = default);
    Task<JsonElement?> TestConnectionAsync(string serverUrl, CancellationToken ct = default);
    Task<JsonElement?> HideAsync(CancellationToken ct = default);
    Task NotifyAsync(string title, string body, string? link, CancellationToken ct = default);
    Task<int> SetBadgeAsync(int count, CancellationToken ct = default);
    Task<UpgradeState> GetUpgradeAsync(CancellationToken ct = default);
    Task<UpgradeState> CheckUpgradeAsync(CancellationToken ct = default);
    Task<UpgradeState> InstallUpgradeAsync(CancellationToken ct = default);
}

public sealed class ShellControlClient : IShellControl
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private readonly HttpClient _http;

    public ShellControlClient(Uri gatewayBase, string? bearerToken = null)
    {
        _http = new HttpClient { BaseAddress = gatewayBase, Timeout = TimeSpan.FromSeconds(30) };
        if (!string.IsNullOrEmpty(bearerToken))
            _http.DefaultRequestHeaders.Authorization =
                new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", bearerToken);
    }

    public ShellControlClient(HttpClient http) => _http = http;

    private async Task<JsonElement?> PostAsync(string path, object body, CancellationToken ct)
    {
        using var response = await _http.PostAsJsonAsync(path, body, Json, ct).ConfigureAwait(false);
        var text = await response.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        if (string.IsNullOrWhiteSpace(text)) return null;
        try { using var doc = JsonDocument.Parse(text); return doc.RootElement.Clone(); }
        catch (JsonException) { return null; }
    }

    private async Task<T> GetAsync<T>(string path, CancellationToken ct) where T : new()
    {
        using var response = await _http.GetAsync(path, ct).ConfigureAwait(false);
        var text = await response.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        return string.IsNullOrWhiteSpace(text) ? new T() : JsonSerializer.Deserialize<T>(text, Json) ?? new T();
    }

    public Task<ShellConfigView> GetConfigAsync(CancellationToken ct = default) =>
        GetAsync<ShellConfigView>(ShellEndpoints.Config, ct);

    public async Task<ShellConfigView> SetConfigAsync(object patch, CancellationToken ct = default)
    {
        await PostAsync(ShellEndpoints.Config, patch, ct).ConfigureAwait(false);
        return await GetConfigAsync(ct).ConfigureAwait(false);
    }

    public async Task<JsonElement?> GetExecutorAsync(CancellationToken ct = default) =>
        await GetRawAsync(ShellEndpoints.Executor, ct).ConfigureAwait(false);

    private async Task<JsonElement?> GetRawAsync(string path, CancellationToken ct)
    {
        using var response = await _http.GetAsync(path, ct).ConfigureAwait(false);
        var text = await response.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        if (string.IsNullOrWhiteSpace(text)) return null;
        try { using var doc = JsonDocument.Parse(text); return doc.RootElement.Clone(); }
        catch (JsonException) { return null; }
    }

    public Task<JsonElement?> SetExecutorAsync(object patch, CancellationToken ct = default) =>
        PostAsync(ShellEndpoints.Executor, patch, ct);

    public Task<JsonElement?> TestConnectionAsync(string serverUrl, CancellationToken ct = default) =>
        PostAsync(ShellEndpoints.Test, new { serverUrl }, ct);

    public Task<JsonElement?> HideAsync(CancellationToken ct = default) =>
        PostAsync(ShellEndpoints.Hide, new { }, ct);

    public Task NotifyAsync(string title, string body, string? link, CancellationToken ct = default) =>
        PostAsync(ShellEndpoints.Notify, new { title, body, link }, ct);

    public async Task<int> SetBadgeAsync(int count, CancellationToken ct = default)
    {
        var result = await PostAsync(ShellEndpoints.Badge,
            new { count = NotificationDecider.ClampBadge(count) }, ct).ConfigureAwait(false);
        return result is { ValueKind: JsonValueKind.Object } && result.Value.TryGetProperty("count", out var c)
            ? c.GetInt32()
            : NotificationDecider.ClampBadge(count);
    }

    public Task<UpgradeState> GetUpgradeAsync(CancellationToken ct = default) =>
        GetAsync<UpgradeState>(ShellEndpoints.Upgrade, ct);

    public Task<UpgradeState> CheckUpgradeAsync(CancellationToken ct = default) =>
        PostAsAsync<UpgradeState>(ShellEndpoints.UpgradeCheck, ct);

    public Task<UpgradeState> InstallUpgradeAsync(CancellationToken ct = default) =>
        PostAsAsync<UpgradeState>(ShellEndpoints.UpgradeInstall, ct);

    private async Task<T> PostAsAsync<T>(string path, CancellationToken ct) where T : new()
    {
        using var response = await _http.PostAsJsonAsync(path, new { }, Json, ct).ConfigureAwait(false);
        var text = await response.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        return string.IsNullOrWhiteSpace(text) ? new T() : JsonSerializer.Deserialize<T>(text, Json) ?? new T();
    }
}
