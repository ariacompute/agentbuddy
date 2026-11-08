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
                // A corrupt or oversized file must not block startup: fall back to
                // defaults and let the next save rewrite it.
                try
                {
                    var info = new FileInfo(_paths.ConfigFile);
                    if (info.Length is > 0 and <= 1024 * 1024)
                    {
                        var text = await File.ReadAllTextAsync(_paths.ConfigFile, ct).ConfigureAwait(false);
                        _current = (JsonSerializer.Deserialize<ShellConfig>(text, Json) ?? new ShellConfig()).Normalize();
                    }
                    else if (info.Length == 0)
                    {
                        _current = new ShellConfig();
                    }
                }
                catch (Exception) { _current = new ShellConfig(); }
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
    /// Writes through a private temp file in the same directory and then renames it
    /// over the target. The content therefore never exists at a permissive mode
    /// (Unix create mode is restrictive from the first byte; Windows gets icacls
    /// before the rename), the old file is never deleted before the new one is
    /// complete, and a crash cannot leave a half-written config.json behind.
    /// </summary>
    public static void WritePrivateFile(string path, string content)
    {
        var full = Path.GetFullPath(path);
        var directory = Path.GetDirectoryName(full)!;
        Directory.CreateDirectory(directory);
        var temp = Path.Combine(directory, "." + Path.GetFileName(full) + "." + Guid.NewGuid().ToString("N") + ".tmp");
        try
        {
            var options = new FileStreamOptions
            {
                Mode = FileMode.CreateNew,
                Access = FileAccess.Write,
                Share = FileShare.None
            };
            if (!OperatingSystem.IsWindows())
                options.UnixCreateMode = UnixFileMode.UserRead | UnixFileMode.UserWrite;
            using (var stream = new FileStream(temp, options))
            {
                stream.Write(Encoding.UTF8.GetBytes(content));
                stream.Flush(flushToDisk: true);
            }
            if (OperatingSystem.IsWindows()) HardenWindows(temp);
            File.Move(temp, full, overwrite: true);
        }
        catch (Exception)
        {
            try { if (File.Exists(temp)) File.Delete(temp); } catch (Exception) { /* best effort */ }
            throw;
        }
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
