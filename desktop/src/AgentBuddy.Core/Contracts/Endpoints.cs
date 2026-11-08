using System.Text;

namespace AgentBuddy.Core.Contracts;

/// <summary>
/// The frozen HTTP surface of agenthub. Every literal lives here exactly once;
/// the static guard in tests/AgentBuddy.Guards asserts each constant is referenced.
/// </summary>
public static class Endpoints
{
    // Authentication and health.
    public const string AuthConfig = "/api/auth/config";
    public const string Register = "/api/auth/register";
    public const string Login = "/api/auth/login";
    public const string Logout = "/api/auth/logout";
    public const string WhoAmI = "/api/auth/me";
    public const string Health = "/healthz";
    public const string Workspace = "/api/workspace";

    // Threads.
    public const string Threads = "/api/threads";
    public const string ThreadById = "/api/threads/{id}";
    public const string ThreadMessages = "/api/threads/{id}/messages";
    public const string ThreadEvents = "/api/threads/{id}/events";
    public const string ThreadAudio = "/api/threads/{id}/audio";

    // Computers (agent sandboxes in the old UI).
    public const string Computers = "/api/computers";
    public const string ComputerById = "/api/computers/{id}";

    // Sandbox control plane.
    public const string SandboxStats = "/api/sandboxes/stats";
    public const string Sandboxes = "/api/sandboxes";
    public const string SandboxById = "/api/sandboxes/{id}";
    public const string SandboxExec = "/api/sandboxes/{id}/exec";
    public const string SandboxRenew = "/api/sandboxes/{id}/renew";
    public const string SandboxEvents = "/api/sandboxes/events";
    public const string SandboxProviders = "/api/sandbox-providers";
    public const string SandboxProvidersRefresh = "/api/sandbox-providers/refresh";
    public const string SandboxNodes = "/api/sandbox-nodes";
    public const string SandboxNodeHeartbeat = "/api/sandbox-nodes/{id}/heartbeat";
    public const string SandboxNodeJobs = "/api/sandbox-nodes/{id}/jobs";
    public const string SandboxNodeJobById = "/api/sandbox-nodes/{id}/jobs/{jobId}";

    // Schedules.
    public const string Schedules = "/api/schedules";
    public const string ScheduleById = "/api/schedules/{id}";
    public const string ScheduleRun = "/api/schedules/{id}/run";

    // Router (trigger stream / policies).
    public const string RouterStats = "/api/router/stats";
    public const string RouterTriggers = "/api/router/triggers";
    public const string RouterTriggerById = "/api/router/triggers/{id}";
    public const string RouterTickets = "/api/router/tickets";
    public const string RouterTicketById = "/api/router/tickets/{id}";
    public const string RouterTicketCancel = "/api/router/tickets/{id}/cancel";
    public const string RouterTicketHandback = "/api/router/tickets/{ticketId}/handback";
    public const string RouterThreadSubscription = "/api/router/threads/{threadId}/subscription";
    public const string RouterPolicies = "/api/router/policies";
    public const string RouterPolicyBySource = "/api/router/policies/{source}";
    public const string RouterPasses = "/api/router/passes";
    public const string RouterEvents = "/api/router/events";

    // Knowledge, tasks.
    public const string Knowledge = "/api/knowledge";
    public const string Tasks = "/api/tasks";
    public const string TaskById = "/api/tasks/{id}";
    public const string TaskCancel = "/api/tasks/{id}/cancel";
    public const string TaskResume = "/api/tasks/{id}/resume";
    public const string TaskEvents = "/api/tasks/{id}/events";

    // Registry resources.
    public const string Resources = "/api/resources";
    public const string ResourceById = "/api/resources/{id}";

    // Channels.
    public const string Channels = "/api/channels";
    public const string ChannelById = "/api/channels/{id}";
    public const string ChannelDeliveries = "/api/channels/{id}/deliveries";
    public const string ChannelDeliveryRetry = "/api/channels/{id}/deliveries/{deliveryId}/retry";

    // Connectors.
    public const string Connectors = "/api/connectors";
    public const string ConnectorPolicy = "/api/connectors/{id}/policy";
    public const string ConnectorActions = "/api/connectors/{id}/actions";
    public const string ConnectorApprovals = "/api/connectors/approvals";
    public const string ConnectorApprovalApprove = "/api/connectors/approvals/{id}/approve";
    public const string ConnectorApprovalReject = "/api/connectors/approvals/{id}/reject";

    // Shared files.
    public const string Files = "/api/files";
    public const string FileById = "/api/files/{id}";
    public const string FileContent = "/api/files/{id}/content";

    /// <summary>The four long-lived event streams, with their fixed event names.</summary>
    public static readonly IReadOnlyDictionary<string, string[]> StreamEventNames =
        new Dictionary<string, string[]>
        {
            [ThreadEvents] = SseEvents.ThreadStream,
            [TaskEvents] = SseEvents.TaskStream,
            [SandboxEvents] = SseEvents.SandboxStream,
            [RouterEvents] = SseEvents.RouterStream,
        };

    /// <summary>
    /// The two streams that exist without an entity id. Thread and task streams are
    /// per-entity ("/api/tasks/{id}/events"), so they are opened on demand with
    /// <see cref="TemplateFor"/>-backed belonging checks — subscribing to the literal
    /// template would just 404 forever.
    /// </summary>
    public static readonly string[] GlobalStreams = [SandboxEvents, RouterEvents];

    /// <summary>
    /// Maps a concrete stream path back to its frozen template
    /// ("/api/tasks/42/events" → "/api/tasks/{id}/events"). Unknown paths are returned
    /// unchanged, so callers can still compare them literally.
    /// </summary>
    public static string TemplateFor(string path)
    {
        if (path.Length == 0 || StreamEventNames.ContainsKey(path)) return path;
        var actual = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
        foreach (var template in StreamEventNames.Keys)
        {
            var expected = template.Split('/', StringSplitOptions.RemoveEmptyEntries);
            if (expected.Length != actual.Length) continue;
            var matches = true;
            for (var i = 0; i < expected.Length; i++)
            {
                if (expected[i].StartsWith('{') && expected[i].EndsWith('}')) continue;
                if (!string.Equals(expected[i], actual[i], StringComparison.Ordinal)) { matches = false; break; }
            }
            if (matches) return template;
        }
        return path;
    }

    /// <summary>
    /// True for a concrete per-entity stream ("/api/tasks/42/events"). Templates and
    /// unknown paths both return false, so "did the caller fill in the id?" is one call.
    /// </summary>
    public static bool IsEntityStream(string path) =>
        !string.Equals(TemplateFor(path), path, StringComparison.Ordinal);

    /// <summary>Replace {placeholders} with URL-encoded values.</summary>
    public static string Format(string template, params (string Name, object? Value)[] args)
    {
        var path = new StringBuilder(template);
        foreach (var (name, value) in args)
        {
            var encoded = Uri.EscapeDataString(value?.ToString() ?? string.Empty);
            path.Replace("{" + name + "}", encoded);
        }
        return path.ToString();
    }

    public static string WithSince(string path, long? since) =>
        since is > 0 ? path + "?since=" + since.Value.ToString(System.Globalization.CultureInfo.InvariantCulture) : path;

    public static string WithQuery(string path, params (string Name, object? Value)[] args)
    {
        var pairs = args
            .Where(a => a.Value is not null && !string.IsNullOrEmpty(a.Value.ToString()))
            .Select(a => Uri.EscapeDataString(a.Name) + "=" + Uri.EscapeDataString(a.Value!.ToString()!));
        var query = string.Join("&", pairs);
        return query.Length == 0 ? path : path + "?" + query;
    }
}

/// <summary>Local control plane between the Avalonia UI and the shell process.</summary>
public static class ShellEndpoints
{
    public const string Prefix = "/__shell";
    public const string Bootstrap = "/__shell/bootstrap";
    public const string Connect = "/__shell/connect";
    public const string About = "/__shell/about";
    public const string Config = "/__shell/config";
    public const string Executor = "/__shell/executor";
    public const string Test = "/__shell/test";
    public const string Notify = "/__shell/notify";
    public const string Badge = "/__shell/badge";
    public const string Hide = "/__shell/hide";
    public const string Upgrade = "/__shell/upgrade";
    public const string UpgradeCheck = "/__shell/upgrade/check";
    public const string UpgradeInstall = "/__shell/upgrade/install";

    public static readonly string[] All =
    [
        Bootstrap, Connect, About, Config, Executor, Test, Notify, Badge, Hide,
        Upgrade, UpgradeCheck, UpgradeInstall
    ];
}

public static class SseEvents
{
    public const string ThreadAgent = "thread.agent";
    public const string ThreadMessage = "thread.message";
    public const string TaskStatus = "task_status_update";
    public const string TaskArtifact = "task_artifact_update";
    public const string TaskSpan = "task_span_update";
    public const string Message = "message";
    public const string Sandbox = "sandbox_event";
    public const string Router = "router_event";

    public static readonly string[] ThreadStream = [ThreadAgent, ThreadMessage];
    public static readonly string[] TaskStream = [TaskStatus, TaskArtifact, TaskSpan, Message];
    public static readonly string[] SandboxStream = [Sandbox];
    public static readonly string[] RouterStream = [Router];
    public static readonly string[] All = [.. ThreadStream, .. TaskStream, .. SandboxStream, .. RouterStream];
}

public static class Gateway
{
    public const string CookieName = "ab_proxy";
    public const string CookieAttributes = "; HttpOnly; SameSite=Strict; Path=/";
    /// <summary>
    /// The one upstream cookie worth persisting. agenthub names its session cookie
    /// here (auth.Options default) and everything else it sets — OAuth state and
    /// PKCE verifier — is transient, so nothing else is written to the credential
    /// store. A hostile server therefore cannot plant a durable credential.
    /// </summary>
    public const string SessionCookieName = "agenthub_session";
    public const string DefaultServerUrl = "http://localhost:3500";
    public const int NonceTtlSeconds = 60;
    public const int TokenBytes = 32;

    /// <summary>Only these prefixes are forwarded upstream; everything else stays local.</summary>
    public static readonly string[] RemotePrefixes = ["/api", "/a2a", "/healthz", "/.well-known"];

    public static bool IsRemotePath(string path)
    {
        foreach (var prefix in RemotePrefixes)
        {
            if (path == prefix || path.StartsWith(prefix + "/", StringComparison.Ordinal)) return true;
        }
        return false;
    }
}

public static class LanguageCodes
{
    public static readonly string[] All =
        ["en", "zh", "zh-TW", "es", "fr", "de", "it", "ru", "ja", "ko", "pt", "ar", "hi"];

    public static bool IsRtl(string lang) => lang == "ar";

    /// <summary>Maps a system language tag onto the frozen 13-language set.</summary>
    public static string Match(string? systemLanguage)
    {
        var value = (systemLanguage ?? string.Empty).ToLowerInvariant();
        if (value.Contains("tw") || value.Contains("hk") || value.Contains("hant")) return "zh-TW";
        foreach (var code in All)
        {
            if (value == code.ToLowerInvariant() || value.StartsWith(code.ToLowerInvariant() + "-", StringComparison.Ordinal))
                return code;
        }
        return "en";
    }
}

public static class PlatformKeys
{
    public static readonly string[] Published = ["linux-x86_64", "darwin-aarch64", "windows-x86_64"];
    public static readonly string[] All =
    [
        "windows-x86_64", "windows-aarch64", "windows-i686",
        "darwin-x86_64", "darwin-aarch64",
        "linux-x86_64", "linux-aarch64", "linux-i686", "linux-armv7"
    ];

    public static string? Key(string os, string arch)
    {
        var mappedOs = os switch { "windows" => "windows", "macos" => "darwin", "linux" => "linux", _ => null };
        var mappedArch = arch switch
        {
            "x86_64" => "x86_64", "aarch64" => "aarch64", "x86" => "i686", "arm" => "armv7", _ => null
        };
        return mappedOs is null || mappedArch is null ? null : mappedOs + "-" + mappedArch;
    }

    public static string Current()
    {
        var os = OperatingSystem.IsWindows() ? "windows" : OperatingSystem.IsMacOS() ? "macos" : "linux";
        var arch = ArchName(System.Runtime.InteropServices.RuntimeInformation.ProcessArchitecture);
        return Key(os, arch) ?? "unsupported-" + os + "-" + arch;
    }

    /// <summary>Maps a process architecture to the release matrix's spelling.</summary>
    internal static string ArchName(System.Runtime.InteropServices.Architecture arch) => arch switch
    {
        System.Runtime.InteropServices.Architecture.X64 => "x86_64",
        System.Runtime.InteropServices.Architecture.Arm64 => "aarch64",
        System.Runtime.InteropServices.Architecture.X86 => "x86",
        System.Runtime.InteropServices.Architecture.Arm => "arm",
        _ => "unknown"
    };
}
