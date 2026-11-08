using System.Diagnostics;
using System.Net;
using System.Text;
using System.Text.Json;
using AgentBuddy.Core.Contracts;
using AgentBuddy.Core.Services;
using Org.BouncyCastle.Crypto.Parameters;
using Org.BouncyCastle.Crypto.Signers;

namespace AgentBuddy.Shell.Upgrade;

public sealed record ReleaseProbe(string Source, string Json, long LatencyMs, string? Error = null);

public interface IReleaseSource { Task<ReleaseProbe> ProbeAsync(CancellationToken ct); }
public interface IReleaseDownloader { Task<byte[]> DownloadAsync(string url, CancellationToken ct); }
public interface IUpgradeVerifier { bool Verify(byte[] payload, string signatureBox, string publicKeyBox); }
public interface IUpgradeInstaller { Task<bool> InstallAsync(byte[] package, string fileName, CancellationToken ct); }

/// <summary>Probes GitHub and Gitee concurrently and takes the fastest usable source.</summary>
public sealed class SourceRace(HttpClient http) : IReleaseSource
{
    public async Task<ReleaseProbe> ProbeAsync(CancellationToken ct)
    {
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct);
        linked.CancelAfter(TimeSpan.FromSeconds(Limits.ManifestProbeTimeoutSeconds));
        var github = ProbeOneAsync("github", ReleaseContract.GithubLatest, linked.Token);
        var gitee = ProbeOneAsync("gitee", null, linked.Token);
        var results = await Task.WhenAll(github, gitee).ConfigureAwait(false);
        var winner = results.Where(r => r.Error is null).OrderBy(r => r.LatencyMs).FirstOrDefault();
        return winner ?? results.OrderBy(r => r.LatencyMs).First();
    }

    private async Task<ReleaseProbe> ProbeOneAsync(string code, string? url, CancellationToken ct)
    {
        var started = Stopwatch.StartNew();
        try
        {
            if (url is null)
            {
                using var api = await http.GetAsync(ReleaseContract.GiteeReleaseApi, ct).ConfigureAwait(false);
                api.EnsureSuccessStatusCode();
                using var doc = JsonDocument.Parse(await api.Content.ReadAsStringAsync(ct).ConfigureAwait(false));
                var tag = doc.RootElement.TryGetProperty("tag_name", out var t) ? t.GetString() ?? "" : "";
                if (tag.Length == 0) return new ReleaseProbe(code, "", started.ElapsedMilliseconds, "manifest_invalid");
                url = $"{ReleaseContract.GiteeBase}/{Uri.EscapeDataString(tag)}/latest.json";
            }
            using var response = await http.GetAsync(url, ct).ConfigureAwait(false);
            if (!response.IsSuccessStatusCode)
                return new ReleaseProbe(code, "", started.ElapsedMilliseconds, "network_failed");
            var json = await response.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            if (Encoding.UTF8.GetByteCount(json) > Limits.MaxManifestBytes)
                return new ReleaseProbe(code, "", started.ElapsedMilliseconds, "manifest_invalid");
            return new ReleaseProbe(code, json, started.ElapsedMilliseconds);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            return new ReleaseProbe(code, "", started.ElapsedMilliseconds, "network_failed");
        }
        catch (Exception) { return new ReleaseProbe(code, "", started.ElapsedMilliseconds, "network_failed"); }
    }
}

public sealed class HttpReleaseDownloader(HttpClient http) : IReleaseDownloader
{
    public async Task<byte[]> DownloadAsync(string url, CancellationToken ct)
    {
        using var response = await http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, ct).ConfigureAwait(false);
        response.EnsureSuccessStatusCode();
        await using var stream = await response.Content.ReadAsStreamAsync(ct).ConfigureAwait(false);
        using var buffer = new MemoryStream();
        await stream.CopyToAsync(buffer, ct).ConfigureAwait(false);
        return buffer.ToArray();
    }
}

/// <summary>
/// Minisign-compatible Ed25519 verification. Legacy "Ed" boxes are supported:
/// the signature covers the raw package bytes. Prehashed "ED" boxes are refused
/// in ab-tool so the two sides can never disagree about what was signed.
/// </summary>
public sealed class MinisignVerifier : IUpgradeVerifier
{
    public bool Verify(byte[] payload, string signatureBox, string publicKeyBox)
    {
        if (string.IsNullOrWhiteSpace(publicKeyBox) || string.IsNullOrWhiteSpace(signatureBox)) return false;
        try
        {
            var pub = Decode(publicKeyBox, 42);
            var sig = Decode(signatureBox, 74);
            var signer = new Ed25519Signer();
            signer.Init(false, new Ed25519PublicKeyParameters(pub[^32..], 0));
            signer.BlockUpdate(payload, 0, payload.Length);
            return signer.VerifySignature(sig[^64..]);
        }
        catch (Exception) { return false; }
    }

    /// <summary>Accepts either the two-line text box or its base64 wrapper.</summary>
    public static byte[] Decode(string box, int minimumLength)
    {
        var text = box.Contains('\n') || box.StartsWith("untrusted comment", StringComparison.Ordinal)
            ? box
            : Encoding.UTF8.GetString(Convert.FromBase64String(box.Trim()));
        var payloadLine = text.Split('\n')
            .Select(l => l.Trim())
            .Where(l => l.Length > 0 && !l.StartsWith("untrusted comment", StringComparison.Ordinal)
                                     && !l.StartsWith("trusted comment", StringComparison.Ordinal))
            .Last();
        var bytes = Convert.FromBase64String(payloadLine);
        if (bytes.Length < minimumLength) throw new FormatException("minisign box too short");
        return bytes;
    }
}

public static class SemverComparer
{
    public static int Compare(string left, string right)
    {
        static (int[] Numbers, string Pre) Parse(string value)
        {
            var main = value.Trim().TrimStart('v', 'V').Split('+')[0];
            var dash = main.IndexOf('-');
            var pre = dash < 0 ? "" : main[(dash + 1)..];
            var numbers = (dash < 0 ? main : main[..dash]).Split('.')
                .Select(p => int.TryParse(p, out var n) ? n : 0).ToArray();
            return (numbers, pre);
        }
        var a = Parse(left);
        var b = Parse(right);
        for (var i = 0; i < Math.Max(a.Numbers.Length, b.Numbers.Length); i++)
        {
            var x = i < a.Numbers.Length ? a.Numbers[i] : 0;
            var y = i < b.Numbers.Length ? b.Numbers[i] : 0;
            if (x != y) return x.CompareTo(y);
        }
        if (a.Pre == b.Pre) return 0;
        if (a.Pre.Length == 0) return 1;
        if (b.Pre.Length == 0) return -1;
        return string.CompareOrdinal(a.Pre, b.Pre);
    }
}

public static class UpgradeSchedule
{
    /// <summary>24h cadence; a backwards clock jump is treated as due.</summary>
    public static bool Due(long lastCheckedSeconds, long nowSeconds) =>
        lastCheckedSeconds <= 0 || nowSeconds < lastCheckedSeconds ||
        nowSeconds - lastCheckedSeconds >= Limits.CheckIntervalSeconds;
}

public sealed class UpgradeService
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private readonly IReleaseSource _source;
    private readonly IReleaseDownloader _downloader;
    private readonly IUpgradeVerifier _verifier;
    private readonly IUpgradeInstaller _installer;
    private readonly ConfigService _config;
    private readonly string _currentVersion;
    private readonly string _pubkey;
    private readonly string _platformKey;
    private readonly object _gate = new();
    private int _busy;
    private string _pendingSignature = "";
    private UpgradeState _state;

    public UpgradeService(IReleaseSource source, IReleaseDownloader downloader, IUpgradeVerifier verifier,
        IUpgradeInstaller installer, ConfigService config, string currentVersion, string pubkey,
        string? platformKey = null)
    {
        _source = source;
        _downloader = downloader;
        _verifier = verifier;
        _installer = installer;
        _config = config;
        _currentVersion = currentVersion;
        _pubkey = pubkey;
        _platformKey = platformKey ?? PlatformKeys.Current();
        _state = new UpgradeState { CurrentVersion = currentVersion };
    }

    public UpgradeState State { get { lock (_gate) return _state; } }

    private UpgradeState Set(UpgradeCode code, string? latest = null, string? notes = null,
        string? source = null, string? url = null)
    {
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var next = new UpgradeState
        {
            Status = UpgradeCodes.Machine(code),
            CurrentVersion = _currentVersion,
            LatestVersion = latest,
            Notes = notes,
            Source = source,
            DownloadUrl = url,
            CheckedAt = now,
            AutoCheck = _config.Current.UpgradeAutoCheck,
            SkippedVersion = _config.Current.UpgradeSkippedVersion
        };
        lock (_gate) _state = next;
        return next;
    }

    public async Task<UpgradeState> CheckAsync(bool manual = false, CancellationToken ct = default)
    {
        if (Interlocked.Exchange(ref _busy, 1) == 1) return Set(UpgradeCode.Busy);
        try
        {
            if (string.IsNullOrWhiteSpace(_pubkey)) return Set(UpgradeCode.NotConfigured);
            if (!PlatformKeys.Published.Contains(_platformKey)) return Set(UpgradeCode.UnsupportedPlatform);
            var probe = await _source.ProbeAsync(ct).ConfigureAwait(false);
            if (probe.Error is not null)
                return Set(probe.Error == "manifest_invalid" ? UpgradeCode.ManifestInvalid : UpgradeCode.NetworkFailed);

            ReleaseManifest? manifest;
            try { manifest = JsonSerializer.Deserialize<ReleaseManifest>(probe.Json, Json); }
            catch (JsonException) { return Set(UpgradeCode.ManifestInvalid); }
            if (manifest is null || !ReleaseContract.IsValidVersion(manifest.Version))
                return Set(UpgradeCode.ManifestInvalid);
            await _config.SaveAsync(_config.Current with { UpgradeLastChecked = DateTimeOffset.UtcNow.ToUnixTimeSeconds() }, ct)
                .ConfigureAwait(false);
            if (SemverComparer.Compare(manifest.Version, _currentVersion) <= 0) return Set(UpgradeCode.UpToDate);
            if (!manual && manifest.Version == _config.Current.UpgradeSkippedVersion) return Set(UpgradeCode.UpToDate);
            if (!manifest.Platforms.TryGetValue(_platformKey, out var asset) || !IsAllowedHttps(asset.Url, probe.Source))
                return Set(UpgradeCode.UnsupportedPlatform, manifest.Version, manifest.Notes, probe.Source);
            var name = Path.GetFileName(new Uri(asset.Url).AbsolutePath);
            if (!manifest.Signatures.TryGetValue(name, out var signature) || string.IsNullOrEmpty(signature))
                return Set(UpgradeCode.ManifestInvalid, manifest.Version, manifest.Notes, probe.Source);
            _pendingSignature = signature;
            return Set(UpgradeCode.Available, manifest.Version, manifest.Notes, probe.Source, asset.Url);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
        catch (Exception) { return Set(UpgradeCode.NetworkFailed); }
        finally { Interlocked.Exchange(ref _busy, 0); }
    }

    private static bool IsAllowedHttps(string url, string source)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps) return false;
        return source switch
        {
            "github" => uri.Host == "github.com",
            "gitee" => uri.Host == "gitee.com",
            _ => false
        };
    }

    public async Task<UpgradeState> InstallAsync(CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(_pubkey)) return Set(UpgradeCode.NotConfigured);
        var current = State;
        if (current.DownloadUrl is null || _pendingSignature.Length == 0) return Set(UpgradeCode.Unavailable);
        if (Interlocked.Exchange(ref _busy, 1) == 1) return Set(UpgradeCode.Busy);
        try
        {
            byte[] package;
            try { package = await _downloader.DownloadAsync(current.DownloadUrl, ct).ConfigureAwait(false); }
            catch (Exception) { return Set(UpgradeCode.NetworkFailed); }
            if (!_verifier.Verify(package, _pendingSignature, _pubkey)) return Set(UpgradeCode.SignatureFailed);
            var installing = Set(UpgradeCode.Installing, current.LatestVersion, current.Notes, current.Source, current.DownloadUrl);
            var name = Path.GetFileName(new Uri(current.DownloadUrl).AbsolutePath);
            return await _installer.InstallAsync(package, name, ct).ConfigureAwait(false)
                ? installing
                : Set(UpgradeCode.Unavailable);
        }
        finally { Interlocked.Exchange(ref _busy, 0); }
    }
}

/// <summary>Platform-specific install. The plugin-free implementation is deliberately explicit.</summary>
public sealed class PlatformUpgradeInstaller : IUpgradeInstaller
{
    public async Task<bool> InstallAsync(byte[] package, string fileName, CancellationToken ct)
    {
        var temp = Path.Combine(Path.GetTempPath(), "agentbuddy-update-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(temp);
        var file = Path.Combine(temp, fileName);
        await File.WriteAllBytesAsync(file, package, ct).ConfigureAwait(false);
        try
        {
            var psi = new ProcessStartInfo { UseShellExecute = false, CreateNoWindow = true };
            if (OperatingSystem.IsWindows() && fileName.EndsWith(".msi", StringComparison.OrdinalIgnoreCase))
            {
                psi.FileName = "msiexec";
                psi.ArgumentList.Add("/i"); psi.ArgumentList.Add(file); psi.ArgumentList.Add("/passive");
            }
            else if (OperatingSystem.IsMacOS() && fileName.EndsWith(".dmg", StringComparison.OrdinalIgnoreCase))
            {
                psi.FileName = "open"; psi.ArgumentList.Add(file);
            }
            else if (OperatingSystem.IsLinux() && fileName.EndsWith(".deb", StringComparison.OrdinalIgnoreCase))
            {
                psi.FileName = "dpkg"; psi.ArgumentList.Add("-i"); psi.ArgumentList.Add(file);
            }
            else return false;
            using var process = Process.Start(psi);
            if (process is null) return false;
            await process.WaitForExitAsync(ct).ConfigureAwait(false);
            return process.ExitCode == 0;
        }
        catch (Exception) { return false; }
    }
}
