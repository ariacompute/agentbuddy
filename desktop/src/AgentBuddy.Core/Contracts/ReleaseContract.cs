using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace AgentBuddy.Core.Contracts;

/// <summary>
/// The published release contract: exactly nine assets, six downloads plus three
/// manifests. Shared by ab-tool and the guards so CI and the client cannot drift.
/// </summary>
public static partial class ReleaseContract
{
    /// <summary>Stable MSI UpgradeCode: changing it breaks in-place upgrades.</summary>
    public const string MsiUpgradeCode = "{6E1F4B82-3C7D-4A90-9B25-8D0F2C61E7A3}";

    public const string GithubBase = "https://github.com/ariacompute/agentbuddy/releases/download";
    public const string GiteeBase = "https://gitee.com/ariacompute/agentbuddy/releases/download";
    public const string GithubLatest = "https://github.com/ariacompute/agentbuddy/releases/latest/download/latest.json";
    public const string GiteeReleaseApi = "https://gitee.com/api/v5/repos/ariacompute/agentbuddy/releases/latest";

    public static readonly string[] Manifests = ["latest.json", "latest-gitee.json", "SHA256SUMS"];

    /// <summary>Exactly six downloads, in the order used by SHA256SUMS.</summary>
    public static string[] Downloads(string version) =>
    [
        $"agentbuddy-amd64-{version}.deb",
        $"agentbuddy-linux-x86_64-{version}.tar.gz",
        $"agentbuddy-aarch64-{version}.dmg",
        $"agentbuddy-macos-aarch64-{version}.tar.gz",
        $"agentbuddy-x64-{version}.msi",
        $"agentbuddy-windows-x86_64-{version}.zip"
    ];

    public static string[] AllAssets(string version) => [.. Downloads(version), .. Manifests];

    /// <summary>Only installable assets go into platforms; signatures cover all six downloads.</summary>
    public static readonly IReadOnlyDictionary<string, string> UpdaterAssetPatterns =
        new Dictionary<string, string>
        {
            ["windows-x86_64"] = @"^agentbuddy-x64-.+\.msi$",
            ["windows-aarch64"] = @"^agentbuddy-arm64-.+\.msi$",
            ["windows-i686"] = @"^agentbuddy-x86-.+\.msi$",
            ["darwin-x86_64"] = @"^agentbuddy-macos-x86_64-.+\.tar\.gz$",
            ["darwin-aarch64"] = @"^agentbuddy-macos-aarch64-.+\.tar\.gz$",
            ["linux-x86_64"] = @"^agentbuddy-amd64-.+\.deb$",
            ["linux-aarch64"] = @"^agentbuddy-arm64-.+\.deb$",
            ["linux-i686"] = @"^agentbuddy-i386-.+\.deb$",
            ["linux-armv7"] = @"^agentbuddy-armhf-.+\.deb$"
        };

    public static string? InstallableAsset(string version, string platformKey) => platformKey switch
    {
        "linux-x86_64" => Downloads(version)[0],
        "darwin-aarch64" => Downloads(version)[3],
        "windows-x86_64" => Downloads(version)[4],
        _ => null
    };

    public static string NormalizeVersion(string tag)
    {
        var v = tag.Trim().TrimStart('v', 'V');
        return Semver().IsMatch(v) ? v : throw new ArgumentException("invalid semver: " + tag, nameof(tag));
    }

    public static bool IsValidVersion(string tag) => Semver().IsMatch(tag.Trim().TrimStart('v', 'V'));

    [GeneratedRegex(@"^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.\-]+)?$")]
    private static partial Regex Semver();
}

/// <summary>Wire format of latest.json / latest-gitee.json.</summary>
public sealed class ReleaseManifest
{
    [JsonPropertyName("version")] public string Version { get; set; } = "";
    [JsonPropertyName("notes")] public string Notes { get; set; } = "";
    [JsonPropertyName("pub_date")] public string PubDate { get; set; } = "";
    public Dictionary<string, PlatformAsset> Platforms { get; set; } = [];
    public Dictionary<string, string> Signatures { get; set; } = [];
}

public sealed class PlatformAsset
{
    public string Url { get; set; } = "";
    public string Signature { get; set; } = "";
}
