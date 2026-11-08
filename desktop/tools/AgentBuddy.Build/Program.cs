using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using AgentBuddy.Core.Contracts;
using Org.BouncyCastle.Crypto.Parameters;
using Org.BouncyCastle.Crypto.Signers;

namespace AgentBuddy.Build;

/// <summary>
/// ab-tool is the single build CLI: icons / stamp / inject-pubkey /
/// sign / manifest / verify. It has no external scripting runtime
/// dependency and keeps the "exactly nine release assets" contract in one place.
/// </summary>
public static class Program
{
    private static readonly JsonSerializerOptions Json = new() { WriteIndented = true };

    public static int Main(string[] args)
    {
        try { return Run(args); }
        catch (Exception error)
        {
            Console.Error.WriteLine("ab-tool: " + error.Message);
            return 1;
        }
    }

    private static int Run(string[] args)
    {
        if (args.Length == 0) { Usage(); return 2; }
        return args[0] switch
        {
            "icons" => Icons(),
            "stamp" => Stamp(args),
            "inject-pubkey" => InjectPubkey(args),
            "sign" => Sign(args),
            "manifest" => Manifest(args),
            "wix" => Wix(args),
            "verify" => Verify(args),
            _ => Usage()
        };
    }

    private static int Usage()
    {
        Console.Error.WriteLine("""
            ab-tool — agentbuddy release helper
              icons
              stamp <semver>
              inject-pubkey [base64-minisign-public-key]   (or UPDATER_PUBKEY env)
              sign <asset> --key <base64-minisign-secret-key> --out <file>
              manifest --version <semver> --meta <dir> --out <dir> [--notes <text>]
              wix --dir <publish-dir> --out <Product.wxs>
              verify <assets-dir> <semver>
            """);
        return 2;
    }

    private static string Root()
    {
        var dir = new DirectoryInfo(Environment.CurrentDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "AGENTS.md")))
            dir = dir.Parent;
        return dir?.FullName ?? throw new InvalidOperationException("run ab-tool from inside the repository");
    }

    // ------------------------------------------------------------------ icons

    private static int Icons()
    {
        var source = Path.Combine(Root(), "desktop/assets/app-icon.png");
        if (!File.Exists(source)) throw new FileNotFoundException("missing " + source);
        var png = File.ReadAllBytes(source);
        var targetDir = Path.Combine(Root(), "desktop/src/AgentBuddy.App/Assets/Icons");
        Directory.CreateDirectory(targetDir);
        File.WriteAllBytes(Path.Combine(targetDir, "app-icon.png"), png);

        // ICO is a container that may hold PNG bytes verbatim (Vista+).
        using (var ico = new MemoryStream())
        using (var writer = new BinaryWriter(ico))
        {
            writer.Write((ushort)0); writer.Write((ushort)1); writer.Write((ushort)1);
            writer.Write((byte)0); writer.Write((byte)0);   // 256x256 is encoded as 0
            writer.Write((byte)0); writer.Write((byte)0);
            writer.Write((ushort)1); writer.Write((ushort)32);
            writer.Write((uint)png.Length); writer.Write((uint)22);
            writer.Write(png);
            File.WriteAllBytes(Path.Combine(targetDir, "app.ico"), ico.ToArray());
        }

        // ICNS "ic08" chunk (256x256 PNG), little header + big-endian lengths.
        using (var icns = new MemoryStream())
        using (var writer = new BinaryWriter(icns))
        {
            writer.Write(Encoding.ASCII.GetBytes("icns"));
            WriteBigEndian(writer, (uint)(16 + png.Length));
            writer.Write(Encoding.ASCII.GetBytes("ic08"));
            WriteBigEndian(writer, (uint)(8 + png.Length));
            writer.Write(png);
            File.WriteAllBytes(Path.Combine(targetDir, "app.icns"), icns.ToArray());
        }
        Console.WriteLine("ab-tool icons: png + ico + icns derived from the single source");
        return 0;
    }

    private static void WriteBigEndian(BinaryWriter writer, uint value)
    {
        writer.Write((byte)(value >> 24)); writer.Write((byte)(value >> 16));
        writer.Write((byte)(value >> 8)); writer.Write((byte)value);
    }

    // ------------------------------------------------------------------ stamp

    private static int Stamp(string[] args)
    {
        if (args.Length < 2 || !ReleaseContract.IsValidVersion(args[1]))
            throw new ArgumentException("stamp needs a valid semver");
        var version = ReleaseContract.NormalizeVersion(args[1]);
        var file = Path.Combine(Root(), "desktop/Directory.Build.props");
        var text = File.ReadAllText(file);
        var updated = Regex.Replace(text, @"<Version>[^<]*</Version>", "<Version>" + version + "</Version>");
        if (updated == text && !text.Contains("<Version>" + version + "</Version>"))
            throw new InvalidOperationException("<Version> not found in Directory.Build.props");
        File.WriteAllText(file, updated);
        Console.WriteLine("ab-tool stamp: " + version + " written to Directory.Build.props");
        return 0;
    }

    // -------------------------------------------------------------- public key

    private static int InjectPubkey(string[] args)
    {
        var value = args.Length > 1 ? args[1] : Environment.GetEnvironmentVariable("UPDATER_PUBKEY") ?? "";
        if (value.Length > 0 && DecodeBox(value, 42) is not { Length: >= 42 })
            throw new InvalidOperationException("UPDATER_PUBKEY is not a minisign public key box");
        var file = Path.Combine(Root(), "desktop/src/AgentBuddy.Shell/Upgrade/Pubkey.g.cs");
        var literal = JsonSerializer.Serialize(value);
        var content = "// Generated by `ab-tool inject-pubkey`. Never commit a real public key.\n"
                    + "namespace AgentBuddy.Shell.Upgrade;\n\n"
                    + "public static class UpdaterKeys\n{\n"
                    + "    public const string PublicKey = " + literal + ";\n}\n";
        File.WriteAllText(file, content);
        Console.WriteLine(value.Length == 0
            ? "ab-tool inject-pubkey: no secret configured, not_configured stays in force"
            : "ab-tool inject-pubkey: public key injected");
        return 0;
    }

    // ------------------------------------------------------------------- sign

    private static int Sign(string[] args)
    {
        if (args.Length < 2) throw new ArgumentException("sign needs an asset path");
        var asset = args[1];
        var key = Option(args, "--key") ?? Environment.GetEnvironmentVariable("UPDATER_PRIVATE_KEY") ?? "";
        var output = Option(args, "--out") ?? asset + ".sig";
        if (key.Length == 0) throw new InvalidOperationException("no signing key provided");
        var secret = DecodeBox(key, 74);
        var seed = secret[10..42];
        var keyId = secret[2..10];
        var payload = File.ReadAllBytes(asset);
        var signer = new Ed25519Signer();
        signer.Init(true, new Ed25519PrivateKeyParameters(seed, 0));
        signer.BlockUpdate(payload, 0, payload.Length);
        var signature = signer.GenerateSignature();

        var box = new byte[74];
        box[0] = (byte)'E'; box[1] = (byte)'d';
        keyId.CopyTo(box, 2);
        signature.CopyTo(box, 10);
        var text = "untrusted comment: agentbuddy release signature\n"
                   + Convert.ToBase64String(box) + "\n"
                   + "trusted comment: file:" + Path.GetFileName(asset) + "\n";
        File.WriteAllText(output, text);
        Console.WriteLine("ab-tool sign: " + Path.GetFileName(asset));
        return 0;
    }

    // --------------------------------------------------------------- manifest

    private static int Manifest(string[] args)
    {
        var version = ReleaseContract.NormalizeVersion(Option(args, "--version")
            ?? throw new ArgumentException("--version is required"));
        var meta = Option(args, "--meta") ?? throw new ArgumentException("--meta is required");
        var output = Option(args, "--out") ?? throw new ArgumentException("--out is required");
        var notes = Option(args, "--notes") ?? Environment.GetEnvironmentVariable("RELEASE_NOTES") ?? "";
        var pubDate = Option(args, "--pub-date") ?? DateTime.UtcNow.ToString("O", CultureInfo.InvariantCulture);
        Directory.CreateDirectory(output);

        var signatures = new Dictionary<string, string>();
        if (Directory.Exists(meta))
        {
            foreach (var file in Directory.GetFiles(meta, "*.sig"))
                signatures[Path.GetFileNameWithoutExtension(file)] = File.ReadAllText(file).Trim();
        }
        foreach (var (file, _) in signatures)
            if (!ReleaseContract.Downloads(version).Contains(file))
                throw new InvalidOperationException("signature for an unpublished asset: " + file);

        foreach (var (source, baseUrl, fileName) in new[]
                 {
                     ("github", ReleaseContract.GithubBase, "latest.json"),
                     ("gitee", ReleaseContract.GiteeBase, "latest-gitee.json")
                 })
        {
            var platforms = new Dictionary<string, object>();
            foreach (var key in PlatformKeys.Published)
            {
                var asset = ReleaseContract.InstallableAsset(version, key);
                if (asset is null || !signatures.TryGetValue(asset, out var signature)) continue;
                platforms[key] = new
                {
                    url = baseUrl + "/v" + version + "/" + Uri.EscapeDataString(asset),
                    signature
                };
            }
            var body = new Dictionary<string, object>
            {
                ["version"] = version,
                ["notes"] = notes,
                ["pub_date"] = pubDate,
                ["platforms"] = platforms,
                ["signatures"] = signatures
            };
            File.WriteAllText(Path.Combine(output, fileName), JsonSerializer.Serialize(body, Json));
        }
        Console.WriteLine("ab-tool manifest: latest.json + latest-gitee.json (" + sourceLabel(signatures.Count) + ")");
        return 0;

        static string sourceLabel(int count) => count == 0 ? "unsigned" : count + " signatures";
    }

    // ------------------------------------------------------------------- wix

    private sealed class WixDirectory
    {
        public string Id = "INSTALLFOLDER";
        public string Name = "";
        public Dictionary<string, WixDirectory> Children = new(StringComparer.Ordinal);
        public List<string> Files = [];
    }

    /// <summary>
    /// WiX v4 has no wildcard harvest in core, so author one Component per
    /// published file. Deterministic ids keep repeated builds byte-identical.
    /// </summary>
    private static int Wix(string[] args)
    {
        var dir = Option(args, "--dir") ?? throw new ArgumentException("--dir is required");
        var output = Option(args, "--out") ?? throw new ArgumentException("--out is required");
        if (!Directory.Exists(dir)) throw new DirectoryNotFoundException(dir);

        var root = new WixDirectory();
        var nextDirectory = 1;
        foreach (var file in Directory.GetFiles(dir, "*", SearchOption.AllDirectories)
                     .OrderBy(x => x, StringComparer.Ordinal))
        {
            var parts = Path.GetRelativePath(dir, file)
                .Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            var node = root;
            for (var i = 0; i < parts.Length - 1; i++)
            {
                if (!node.Children.TryGetValue(parts[i], out var child))
                {
                    child = new WixDirectory { Id = "D" + nextDirectory++, Name = parts[i] };
                    node.Children[parts[i]] = child;
                }
                node = child;
            }
            node.Files.Add(Path.GetFullPath(file));
        }

        var xml = new StringBuilder();
        xml.AppendLine("<?xml version=\"1.0\" encoding=\"utf-8\"?>");
        xml.AppendLine("<Wix xmlns=\"http://wixtoolset.org/schemas/v4/wxs\">");
        xml.AppendLine("  <Package Name=\"agentbuddy\" Manufacturer=\"Aria Compute\" Version=\"$(var.Version)\" " +
                       "UpgradeCode=\"" + ReleaseContract.MsiUpgradeCode + "\" Scope=\"perMachine\" Compressed=\"yes\">");
        xml.AppendLine("    <MajorUpgrade DowngradeErrorMessage=\"A newer version of agentbuddy is already installed.\" />");
        xml.AppendLine("    <MediaTemplate EmbedCab=\"yes\" />");
        xml.AppendLine("    <Feature Id=\"Main\" Title=\"agentbuddy\" Level=\"1\">");
        xml.AppendLine("      <ComponentGroupRef Id=\"ProductFiles\" />");
        xml.AppendLine("    </Feature>");
        xml.AppendLine("  </Package>");
        xml.AppendLine("  <Fragment>");
        xml.AppendLine("    <StandardDirectory Id=\"ProgramFiles64Folder\">");
        xml.AppendLine("      <Directory Id=\"INSTALLFOLDER\" Name=\"agentbuddy\">");
        EmitDirectories(xml, root, 8);
        xml.AppendLine("      </Directory>");
        xml.AppendLine("    </StandardDirectory>");
        xml.AppendLine("  </Fragment>");
        xml.AppendLine("  <Fragment>");
        xml.AppendLine("    <ComponentGroup Id=\"ProductFiles\" Directory=\"INSTALLFOLDER\">");
        var component = 1;
        var fileId = 1;
        EmitComponents(xml, root, "INSTALLFOLDER", ref component, ref fileId);
        xml.AppendLine("    </ComponentGroup>");
        xml.AppendLine("  </Fragment>");
        xml.AppendLine("</Wix>");
        File.WriteAllText(output, xml.ToString());
        Console.WriteLine($"ab-tool wix: authored {component - 1} components in {Path.GetFileName(output)}");
        return 0;
    }

    private static void EmitDirectories(StringBuilder xml, WixDirectory node, int indent)
    {
        foreach (var child in node.Children.Values.OrderBy(x => x.Name, StringComparer.Ordinal))
        {
            xml.Append(' ', indent).Append("<Directory Id=\"").Append(child.Id)
               .Append("\" Name=\"").Append(Esc(child.Name)).Append('"');
            if (child.Children.Count == 0) { xml.AppendLine(" />"); continue; }
            xml.AppendLine(">");
            EmitDirectories(xml, child, indent + 2);
            xml.Append(' ', indent).AppendLine("</Directory>");
        }
    }

    private static void EmitComponents(StringBuilder xml, WixDirectory node, string directoryId,
        ref int component, ref int fileId)
    {
        foreach (var file in node.Files.OrderBy(x => x, StringComparer.Ordinal))
        {
            xml.Append("      <Component Id=\"C").Append(component++)
               .Append("\" Directory=\"").Append(directoryId).Append("\" Guid=\"*\">\n");
            xml.Append("        <File Id=\"F").Append(fileId++)
               .Append("\" Source=\"").Append(Esc(file)).Append("\" KeyPath=\"yes\" />\n");
            xml.AppendLine("      </Component>");
        }
        foreach (var child in node.Children.Values.OrderBy(x => x.Name, StringComparer.Ordinal))
            EmitComponents(xml, child, child.Id, ref component, ref fileId);
    }

    private static string Esc(string value) => value
        .Replace("&", "&amp;").Replace("\"", "&quot;").Replace("<", "&lt;")
        .Replace(">", "&gt;").Replace("'", "&apos;");

    // ----------------------------------------------------------------- verify

    private static int Verify(string[] args)
    {
        if (args.Length < 3) throw new ArgumentException("verify <assets-dir> <semver>");
        var dir = args[1];
        var version = ReleaseContract.NormalizeVersion(args[2]);
        var expected = ReleaseContract.AllAssets(version).OrderBy(x => x, StringComparer.Ordinal).ToArray();
        var actual = Directory.GetFiles(dir).Select(Path.GetFileName).OfType<string>()
            .OrderBy(x => x, StringComparer.Ordinal).ToArray();
        Assert(actual.SequenceEqual(expected), "release must contain exactly nine assets: " + string.Join(", ", actual));

        var downloads = ReleaseContract.Downloads(version);
        foreach (var (fileName, host) in new[] { ("latest.json", "github.com"), ("latest-gitee.json", "gitee.com") })
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(Path.Combine(dir, fileName)));
            var root = doc.RootElement;
            Assert(root.GetProperty("version").GetString() == version, fileName + ": version mismatch");
            var platforms = root.GetProperty("platforms").EnumerateObject().ToDictionary(p => p.Name, p => p.Value);
            var signatures = root.GetProperty("signatures").EnumerateObject()
                .ToDictionary(p => p.Name, p => p.Value.GetString() ?? "");
            var platformKeys = platforms.Keys.OrderBy(x => x, StringComparer.Ordinal).ToArray();
            var signatureKeys = signatures.Keys.OrderBy(x => x, StringComparer.Ordinal).ToArray();
            Assert(platformKeys.Length == 0 || platformKeys.SequenceEqual(PlatformKeys.Published.OrderBy(x => x)),
                fileName + ": incomplete platform set");
            Assert(signatureKeys.Length == 0 || signatureKeys.SequenceEqual(downloads.OrderBy(x => x, StringComparer.Ordinal)),
                fileName + ": signatures must cover all six downloads");
            Assert(platforms.Count == 0 || signatures.Count == 6, fileName + ": partial signing is not allowed");
            var prefix = "https://" + host + "/ariacompute/agentbuddy/releases/download/v" + version + "/";
            foreach (var (key, entry) in platforms)
            {
                var url = entry.GetProperty("url").GetString() ?? "";
                Assert(url.StartsWith(prefix, StringComparison.Ordinal), fileName + ": cross-mirror URL");
                var name = Uri.UnescapeDataString(Path.GetFileName(new Uri(url).AbsolutePath));
                Assert(downloads.Contains(name), fileName + ": URL does not point to a published asset");
                Assert(entry.GetProperty("signature").GetString() == signatures[name],
                    fileName + ": platform signature mismatch");
            }
        }

        var sums = File.ReadAllLines(Path.Combine(dir, "SHA256SUMS"));
        var sumNames = new List<string>();
        foreach (var line in sums)
        {
            var match = Regex.Match(line, @"^([0-9a-f]{64})  (.+)$");
            Assert(match.Success, "SHA256SUMS must use two spaces between digest and name");
            sumNames.Add(match.Groups[2].Value);
        }
        Assert(sumNames.OrderBy(x => x, StringComparer.Ordinal)
                .SequenceEqual(downloads.OrderBy(x => x, StringComparer.Ordinal)),
            "SHA256SUMS must cover exactly the six downloads");
        Console.WriteLine("ab-tool: verified exactly nine release assets");
        return 0;
    }

    private static void Assert(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException(message);
    }

    private static string? Option(string[] args, string name)
    {
        var index = Array.IndexOf(args, name);
        return index >= 0 && index + 1 < args.Length ? args[index + 1] : null;
    }

    /// <summary>Accepts either the two-line text box or its base64 wrapper.</summary>
    private static byte[] DecodeBox(string box, int minimumLength)
    {
        var text = box.Contains('\n') || box.StartsWith("untrusted comment", StringComparison.Ordinal)
            ? box
            : Encoding.UTF8.GetString(Convert.FromBase64String(box.Trim()));
        var payloadLine = text.Split('\n').Select(l => l.Trim())
            .Where(l => l.Length > 0 && !l.StartsWith("untrusted comment", StringComparison.Ordinal)
                                     && !l.StartsWith("trusted comment", StringComparison.Ordinal))
            .Last();
        var bytes = Convert.FromBase64String(payloadLine);
        if (bytes.Length < minimumLength) throw new FormatException("minisign box too short");
        return bytes;
    }

    private static string Sha256(string file)
    {
        using var stream = File.OpenRead(file);
        return Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
    }
}
