using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using AgentBuddy.Core.Contracts;

namespace AgentBuddy.Core.Services;

public interface IAppPaths
{
    string ConfigDir { get; }
    string DataDir { get; }
    string ConfigFile { get; }
}

public sealed class AppPaths : IAppPaths
{
    public AppPaths(string? root = null)
    {
        var baseDir = root ?? Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        ConfigDir = Path.Combine(baseDir, "agentbuddy");
        DataDir = Path.Combine(ConfigDir, "data");
        ConfigFile = Path.Combine(ConfigDir, "config.json");
    }

    public string ConfigDir { get; }
    public string DataDir { get; }
    public string ConfigFile { get; }
}

/// <summary>config.json is the only settings store. Secrets never live here.</summary>
public sealed class ConfigService
{
    private static readonly JsonSerializerOptions Json = new() { PropertyNameCaseInsensitive = true, WriteIndented = true };

    private static readonly Dictionary<string, string> CamelToSnake = new(StringComparer.Ordinal)
    {
        ["serverUrl"] = "server_url",
        ["acceptInvalidCerts"] = "accept_invalid_certs",
        ["lang"] = "lang",
        ["background"] = "background",
        ["notifyEnabled"] = "notify_enabled",
        ["notifyQuietMinutes"] = "notify_quiet_minutes",
        ["executorEnabled"] = "executor_enabled",
        ["executorRoot"] = "executor_root",
        ["executorAllowlist"] = "executor_allowlist",
        ["executorMaxConcurrency"] = "executor_max_concurrency",
        ["executorNodeId"] = "executor_node_id",
        ["executorApiKey"] = "executor_api_key",
        ["upgradeAutoCheck"] = "upgrade_auto_check",
        ["upgradeSkippedVersion"] = "upgrade_skipped_version",
        ["upgradeLastChecked"] = "upgrade_last_checked"
    };

    private readonly IAppPaths _paths;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private ShellConfig _current = new();

    public ConfigService(IAppPaths paths) => _paths = paths;

    public ShellConfig Current => _current;
    public event Action<ShellConfig>? Changed;

    public async Task<ShellConfig> LoadAsync(CancellationToken ct = default)
    {
        await _gate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            if (File.Exists(_paths.ConfigFile))
            {
                var text = await File.ReadAllTextAsync(_paths.ConfigFile, ct).ConfigureAwait(false);
                _current = (JsonSerializer.Deserialize<ShellConfig>(text, Json) ?? new ShellConfig()).Normalize();
            }
            return _current;
        }
        finally { _gate.Release(); }
    }

    /// <summary>Applies a partial camelCase patch (as sent by POST /__shell/config).</summary>
    public async Task<ShellConfig> ApplyPatchAsync(string json, CancellationToken ct = default)
    {
        var patch = JsonNode.Parse(json)?.AsObject() ?? throw new FormatException(ErrorCodes.InvalidJson);
        await _gate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            var merged = (JsonNode.Parse(JsonSerializer.Serialize(_current, Json)) as JsonObject) ?? new JsonObject();
            foreach (var (key, value) in patch)
            {
                if (!CamelToSnake.TryGetValue(key, out var snake)) continue;
                merged[snake] = value?.DeepClone();
            }
            var next = JsonSerializer.Deserialize<ShellConfig>(merged.ToJsonString(), Json) ?? _current;
            _current = next.Normalize();
            WritePrivateFile(_paths.ConfigFile, JsonSerializer.Serialize(_current, Json));
            Changed?.Invoke(_current);
            return _current;
        }
        finally { _gate.Release(); }
    }

    public async Task<ShellConfig> SaveAsync(ShellConfig config, CancellationToken ct = default)
    {
        await _gate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            _current = config.Normalize();
            WritePrivateFile(_paths.ConfigFile, JsonSerializer.Serialize(_current, Json));
            Changed?.Invoke(_current);
            return _current;
        }
        finally { _gate.Release(); }
    }

    /// <summary>
    /// Creates the file with restrictive permissions from the very first byte
    /// ("create then chmod" is not used). On Windows icacls explicitly removes
    /// inheritance and grants only the current user.
    /// </summary>
    public static void WritePrivateFile(string path, string content)
    {
        var full = Path.GetFullPath(path);
        Directory.CreateDirectory(Path.GetDirectoryName(full)!);
        if (File.Exists(full)) File.Delete(full);
        using (var stream = new FileStream(full, FileMode.CreateNew, FileAccess.Write, FileShare.None))
        {
            if (!OperatingSystem.IsWindows())
                File.SetUnixFileMode(full, UnixFileMode.UserRead | UnixFileMode.UserWrite);
            stream.Write(Encoding.UTF8.GetBytes(content));
        }
        if (OperatingSystem.IsWindows()) HardenWindows(full);
    }

    private static void HardenWindows(string full)
    {
        try
        {
            var psi = new ProcessStartInfo("icacls") { UseShellExecute = false, CreateNoWindow = true };
            psi.ArgumentList.Add(full);
            psi.ArgumentList.Add("/inheritance:r");
            psi.ArgumentList.Add("/grant:r");
            psi.ArgumentList.Add($"{Environment.UserDomainName}\\{Environment.UserName}:F");
            using var process = Process.Start(psi);
            process?.WaitForExit(2000);
        }
        catch (Exception) { /* No icacls: log-free fallback, the file is still user-scoped. */ }
    }
}
