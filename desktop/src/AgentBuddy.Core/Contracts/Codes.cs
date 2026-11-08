namespace AgentBuddy.Core.Contracts;

/// <summary>Machine-readable codes only; human text is resolved through ILocalizationService.</summary>
public static class ErrorCodes
{
    public const string BadRequest = "bad_request";
    public const string Unauthenticated = "unauthenticated";
    public const string Forbidden = "forbidden";
    public const string NotFound = "not_found";
    public const string InternalError = "internal_error";
    public const string NetworkError = "network_error";
    public const string Timeout = "timeout";
    public const string ServerNotConfigured = "server_not_configured";
    public const string SessionExpired = "session_expired";
    public const string ProxyOriginRefused = "proxy_origin_refused";
    public const string ProxyUnauthorized = "proxy_unauthorized";
    public const string ProxyNonceRefused = "proxy_nonce_refused";
    public const string ProxyAuthDisabled = "proxy_auth_disabled";
    public const string NotConfigured = "not_configured";
    public const string InvalidJson = "invalid_json";
    public const string Invalid = "invalid";
    public const string Empty = "empty";
    public const string InvalidCount = "invalid_count";
    public const string NotSaved = "not_saved";
    public const string Unexpected = "unexpected";
    public const string SpeechDisabled = "speech_disabled";

    /// <summary>The 74 codes registered by agenthub's httputil + errors-copy.js.</summary>
    public static readonly string[] All =
    [
        "bad_request", "unauthorized", "unauthenticated", "forbidden", "not_found",
        "method_not_allowed", "invalid_credentials", "email_taken", "weak_password",
        "registration_closed", "payload_too_large", "rate_limited", "csrf_origin_mismatch",
        "internal_error", "service_unavailable", "database_down",
        "resource_not_found", "resource_exists", "invalid_kind", "invalid_health",
        "invalid_endpoint", "resource_not_discoverable",
        "task_not_found", "task_not_cancelable", "task_not_resumable",
        "invalid_state_transition", "push_notification_not_supported",
        "thread_not_found", "empty_message", "threads_unavailable",
        "channel_disabled", "channel_not_found", "channel_signature_missing",
        "channel_signature_invalid", "channel_timestamp_expired", "channel_payload_invalid",
        "delivery_failed", "delivery_not_found", "delivery_not_retryable",
        "connector_not_found", "connector_action_denied", "connector_policy_off",
        "connector_approval_not_found", "connector_approval_closed",
        "files_disabled", "file_not_found", "file_too_large", "file_unsupported",
        "file_store_error", "audio_too_large", "audio_unsupported", "audio_transcribe_failed",
        "speech_disabled", "computer_not_found", "schedule_not_found", "schedule_invalid",
        "skill_distill_disabled", "feature_unavailable",
        "router_ticket_not_found", "router_trigger_not_found", "router_thread_not_found",
        "router_ticket_closed", "router_handback_exhausted", "router_policy_invalid",
        "router_resource_unset",
        "sandbox_disabled", "sandbox_unsupported", "sandbox_unknown_provider",
        "sandbox_policy_denied", "sandbox_timeout", "sandbox_node_offline",
        "sandbox_lease_lost", "sandbox_limit_reached", "sandbox_capability_unavailable"
    ];

    private static readonly HashSet<string> AuthErrors =
        [Unauthenticated, Forbidden, SessionExpired, "unauthorized"];

    public static bool IsAuth(string code) => AuthErrors.Contains(code);

    public static string CopyKey(string code)
    {
        var parts = code.Split('_');
        var sb = new System.Text.StringBuilder(parts[0]);
        for (var i = 1; i < parts.Length; i++)
        {
            var p = parts[i];
            if (p.Length == 0) continue;
            sb.Append(char.ToUpperInvariant(p[0])).Append(p.AsSpan(1));
        }
        return "errors." + sb;
    }
}

public sealed class HubApiException : Exception
{
    public string Code { get; }
    public int Status { get; }

    public HubApiException(string code, int status = 0)
        : base(code)
    {
        Code = code;
        Status = status;
    }

    public bool IsAuth => ErrorCodes.IsAuth(Code) || Status is 401 or 403;
}

public static class ExecutorReject
{
    public const string RootUnusable = "root_unusable";
    public const string CommandNotAllowed = "command_not_allowed";
    public const string DirOutsideRoot = "dir_outside_root";
    public const string EnvNotAllowed = "env_not_allowed";
    public const string SpawnFailed = "spawn_failed";

    public static readonly string[] All =
        [RootUnusable, CommandNotAllowed, DirOutsideRoot, EnvNotAllowed, SpawnFailed];

    /// <summary>Exact-name denylist. Shells are refused by construction, never by string matching of a command line.</summary>
    public static readonly string[] Shells =
    [
        "sh", "bash", "zsh", "dash", "ksh", "csh", "tcsh", "fish", "ash", "busybox",
        "cmd", "powershell", "pwsh", "wsl",
        "sh.exe", "bash.exe", "zsh.exe", "dash.exe", "ksh.exe", "csh.exe",
        "cmd.exe", "powershell.exe", "pwsh.exe", "wsl.exe", "busybox.exe"
    ];

    /// <summary>
    /// Programs whose whole purpose is to launch another program. Allowlisting one
    /// of these would hand the server exactly the shell it was denied, so they are
    /// refused by construction as well — even when a user lists them by mistake.
    /// </summary>
    public static readonly string[] Launchers =
    [
        "env", "nohup", "setsid", "xargs", "timeout", "nice", "ionice", "stdbuf",
        "chroot", "unshare", "nsenter", "sudo", "su", "doas", "runuser", "pkexec",
        "systemd-run", "at", "batch", "watch", "expect", "script", "ssh", "scp",
        "sftp", "docker", "podman", "nerdctl", "strace", "ltrace", "gdb",
        "env.exe", "nohup.exe", "xargs.exe", "timeout.exe", "setsid.exe", "watch.exe",
        "sudo.exe", "ssh.exe", "scp.exe", "docker.exe", "podman.exe"
    ];

    public static readonly string[] EnvAllow =
        ["PATH", "HOME", "LANG", "LC_ALL", "TZ", "TERM", "TMPDIR", "TEMP"];
}

public enum UpgradeCode
{
    Idle, Checking, UpToDate, Available, UnsupportedPlatform, Downloading, Installing,
    NotConfigured, NetworkFailed, ManifestInvalid, SignatureFailed, Busy, Unavailable
}

public static class UpgradeCodes
{
    public static string Machine(UpgradeCode code) => code switch
    {
        UpgradeCode.Idle => "idle",
        UpgradeCode.Checking => "checking",
        UpgradeCode.UpToDate => "up_to_date",
        UpgradeCode.Available => "available",
        UpgradeCode.UnsupportedPlatform => "unsupported_platform",
        UpgradeCode.Downloading => "downloading",
        UpgradeCode.Installing => "installing",
        UpgradeCode.NotConfigured => "not_configured",
        UpgradeCode.NetworkFailed => "network_failed",
        UpgradeCode.ManifestInvalid => "manifest_invalid",
        UpgradeCode.SignatureFailed => "signature_failed",
        UpgradeCode.Busy => "busy",
        UpgradeCode.Unavailable => "unavailable",
        _ => "unavailable"
    };

    public static readonly string[] All = Enum.GetValues<UpgradeCode>().Select(Machine).ToArray();
}

public static class Limits
{
    public const int MaxRequestBody = 32 * 1024 * 1024;
    public const int MaxShellBody = 64 * 1024;
    public const int MaxManifestBytes = 256 * 1024;
    public const int MaxOutputBytes = 64 * 1024;
    public const int ConnectTimeoutSeconds = 10;
    public const int ProbeTimeoutSeconds = 15;
    public const int ManifestProbeTimeoutSeconds = 6;
    public const int ExecutorTimeoutSeconds = 60;
    public const int FirstCheckDelaySeconds = 8;
    public const int CheckIntervalSeconds = 24 * 60 * 60;
    public const int MaxBadge = 999;
    public const int BadgeDisplayCap = 99;
    public const int MaxNotifications = 50;
    public const int MaxQuietMinutes = 240;
    public const int ConfigQuietMinutesCap = 1440;
    public const int MaxSubscriptions = 6;
    public const int PollVisibleMs = 5000;
    public const int PollHiddenMs = 20000;
    public const int BackoffFloorMs = 5000;
    public const int BackoffCeilMs = 30000;
    public const long IdempotentWindowMs = 60L * 60 * 1000;
    public const long DigestWindowMs = 60L * 1000;
    public const int DefaultMaxPerMinute = 8;
    public const int ShellSettingsTtlMs = 60 * 1000;

    // Bounds that keep a hostile or wedged peer from turning a stream into memory.
    /// <summary>Largest JSON body read into a string (API responses, uploads).</summary>
    public const int MaxJsonBytes = 16 * 1024 * 1024;
    /// <summary>Largest single SSE event accumulated before it is dropped.</summary>
    public const int MaxEventBytes = 1024 * 1024;
    /// <summary>Largest update package kept in memory; the real ones are under 120 MiB.</summary>
    public const int MaxPackageBytes = 512 * 1024 * 1024;
    /// <summary>Notification title / body / deep-link caps.</summary>
    public const int MaxNotifyTitleChars = 200;
    public const int MaxNotifyBodyChars = 1000;
    /// <summary>Cap for a stored executor API key and for a replayed session cookie.</summary>
    public const int MaxSecretChars = 8 * 1024;
    public const int MaxCookieChars = 8 * 1024;
    /// <summary>Credential helper budget; a locked keychain must never wedge a request.</summary>
    public const int CredentialTimeoutSeconds = 5;
}
