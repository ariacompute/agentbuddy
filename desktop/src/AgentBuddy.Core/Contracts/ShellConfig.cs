using System.Text.Json.Serialization;

namespace AgentBuddy.Core.Contracts;

/// <summary>
/// The single schema of config.json. Field names are snake_case on disk (kept
/// stable so existing installs keep their settings), camelCase on the wire.
/// </summary>
public sealed record ShellConfig
{
    [JsonPropertyName("server_url")]
    public string ServerUrl { get; init; } = "";

    [JsonPropertyName("accept_invalid_certs")]
    public bool AcceptInvalidCerts { get; init; }

    [JsonPropertyName("lang")]
    public string Lang { get; init; } = "";

    [JsonPropertyName("background")]
    public bool Background { get; init; } = true;

    [JsonPropertyName("notify_enabled")]
    public bool NotifyEnabled { get; init; } = true;

    [JsonPropertyName("notify_quiet_minutes")]
    public int NotifyQuietMinutes { get; init; }

    [JsonPropertyName("executor_enabled")]
    public bool ExecutorEnabled { get; init; }

    [JsonPropertyName("executor_root")]
    public string ExecutorRoot { get; init; } = "";

    [JsonPropertyName("executor_allowlist")]
    public string[] ExecutorAllowlist { get; init; } = [];

    [JsonPropertyName("executor_max_concurrency")]
    public int ExecutorMaxConcurrency { get; init; } = 1;

    [JsonPropertyName("executor_node_id")]
    public string ExecutorNodeId { get; init; } = "";

    [JsonPropertyName("executor_api_key")]
    public string ExecutorApiKey { get; init; } = "";

    [JsonPropertyName("upgrade_auto_check")]
    public bool UpgradeAutoCheck { get; init; } = true;

    [JsonPropertyName("upgrade_skipped_version")]
    public string UpgradeSkippedVersion { get; init; } = "";

    [JsonPropertyName("upgrade_last_checked")]
    public long UpgradeLastChecked { get; init; }

    public ShellConfig Normalize() => this with
    {
        NotifyQuietMinutes = Math.Clamp(NotifyQuietMinutes, 0, Limits.ConfigQuietMinutesCap),
        ExecutorMaxConcurrency = Math.Clamp(ExecutorMaxConcurrency, 1, 8),
        ExecutorAllowlist = ExecutorAllowlist ?? []
    };
}

/// <summary>What GET /__shell/config returns; secrets are never echoed.</summary>
public sealed record ShellConfigView
{
    [JsonPropertyName("serverUrl")] public string ServerUrl { get; init; } = "";
    [JsonPropertyName("acceptInvalidCerts")] public bool AcceptInvalidCerts { get; init; }
    [JsonPropertyName("lang")] public string Lang { get; init; } = "";
    [JsonPropertyName("background")] public bool Background { get; init; } = true;
    [JsonPropertyName("notifyEnabled")] public bool NotifyEnabled { get; init; } = true;
    [JsonPropertyName("notifyQuietMinutes")] public int NotifyQuietMinutes { get; init; }
    [JsonPropertyName("executorEnabled")] public bool ExecutorEnabled { get; init; }
    [JsonPropertyName("executorRoot")] public string ExecutorRoot { get; init; } = "";
    [JsonPropertyName("executorAllowlist")] public string[] ExecutorAllowlist { get; init; } = [];
    [JsonPropertyName("executorMaxConcurrency")] public int ExecutorMaxConcurrency { get; init; } = 1;
    [JsonPropertyName("executorNodeId")] public string ExecutorNodeId { get; init; } = "";
    [JsonPropertyName("executorHasApiKey")] public bool ExecutorHasApiKey { get; init; }
    [JsonPropertyName("upgradeAutoCheck")] public bool UpgradeAutoCheck { get; init; } = true;
    [JsonPropertyName("upgradeSkippedVersion")] public string UpgradeSkippedVersion { get; init; } = "";
    [JsonPropertyName("sessionBackend")] public string SessionBackend { get; init; } = "file";

    public static ShellConfigView From(ShellConfig c, bool hasApiKey, string sessionBackend) => new()
    {
        ServerUrl = c.ServerUrl,
        AcceptInvalidCerts = c.AcceptInvalidCerts,
        Lang = c.Lang,
        Background = c.Background,
        NotifyEnabled = c.NotifyEnabled,
        NotifyQuietMinutes = c.NotifyQuietMinutes,
        ExecutorEnabled = c.ExecutorEnabled,
        ExecutorRoot = c.ExecutorRoot,
        ExecutorAllowlist = c.ExecutorAllowlist,
        ExecutorMaxConcurrency = c.ExecutorMaxConcurrency,
        ExecutorNodeId = c.ExecutorNodeId,
        ExecutorHasApiKey = hasApiKey,
        UpgradeAutoCheck = c.UpgradeAutoCheck,
        UpgradeSkippedVersion = c.UpgradeSkippedVersion,
        SessionBackend = sessionBackend
    };
}

public sealed class HubEvent
{
    public required string Name { get; init; }
    public required string Data { get; init; }
    public string? Id { get; init; }
}

public sealed record UpgradeState
{
    [JsonPropertyName("status")] public string Status { get; init; } = UpgradeCodes.Machine(UpgradeCode.Idle);
    [JsonPropertyName("currentVersion")] public string CurrentVersion { get; init; } = "";
    [JsonPropertyName("latestVersion")] public string? LatestVersion { get; init; }
    [JsonPropertyName("notes")] public string? Notes { get; init; }
    [JsonPropertyName("source")] public string? Source { get; init; }
    [JsonPropertyName("downloadUrl")] public string? DownloadUrl { get; init; }
    [JsonPropertyName("checkedAt")] public long? CheckedAt { get; init; }
    [JsonPropertyName("autoCheck")] public bool AutoCheck { get; init; } = true;
    [JsonPropertyName("skippedVersion")] public string? SkippedVersion { get; init; }
}
