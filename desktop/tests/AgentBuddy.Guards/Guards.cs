using System.Text.Json;
using System.Text.RegularExpressions;
using AgentBuddy.Core.Contracts;
using Xunit;

namespace AgentBuddy.Guards;

/// <summary>Static contract guards: 13-language parity, monochrome XAML, contracts, tooling.</summary>
public class StaticGuards
{
    private static string Root()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "AGENTS.md")))
            dir = dir.Parent;
        return dir?.FullName ?? throw new InvalidOperationException("repository root not found");
    }

    private static string[] SourceFiles(params string[] subdirs) => subdirs
        .SelectMany(sub => Directory.GetFiles(Path.Combine(Root(), sub), "*.*", SearchOption.AllDirectories))
        .Where(f => f.EndsWith(".cs", StringComparison.OrdinalIgnoreCase) ||
                    f.EndsWith(".axaml", StringComparison.OrdinalIgnoreCase) ||
                    f.EndsWith(".json", StringComparison.OrdinalIgnoreCase))
        .Where(f => !f.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}") &&
                    !f.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}"))
        .ToArray();

    [Fact]
    public void ThirteenLanguagesHaveIdenticalKeySetsAndRealTranslations()
    {
        var path = Path.Combine(Root(), "desktop/src/AgentBuddy.Core/I18n/copy.json");
        using var doc = JsonDocument.Parse(File.ReadAllText(path));
        var languages = doc.RootElement.EnumerateObject().ToDictionary(p => p.Name, p => p.Value);
        Assert.Equal(13, languages.Count);
        Assert.Equal(LanguageCodes.All.OrderBy(x => x), languages.Keys.OrderBy(x => x));
        var english = languages["en"].EnumerateObject().ToDictionary(p => p.Name, p => p.Value.GetString()!);
        Assert.True(english.Count >= 58, "the frozen copy surface must not shrink");
        foreach (var (lang, table) in languages)
        {
            var keys = table.EnumerateObject().Select(p => p.Name).OrderBy(x => x).ToArray();
            Assert.Equal(english.Keys.OrderBy(x => x), keys);
            var differing = table.EnumerateObject()
                .Count(p => p.Name.StartsWith("brand.", StringComparison.Ordinal) is false &&
                            p.Value.GetString() != english[p.Name]);
            Assert.True(lang == "en" || differing > english.Count / 2, $"{lang} looks like an untranslated copy of English");
        }
        Assert.NotEqual(languages["zh"].GetProperty("nav.settings").GetString(),
                        languages["zh-TW"].GetProperty("nav.settings").GetString());
    }

    [Fact]
    public void EveryColourInXamlIsOnTheBlackWhiteAxis()
    {
        var files = SourceFiles("desktop/src/AgentBuddy.App").Where(f => f.EndsWith(".axaml")).ToArray();
        Assert.NotEmpty(files);
        var hex = new Regex(@"#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})\b");
        var named = new Regex(@"\b(red|green|blue|orange|purple|pink|cyan|magenta|yellow|teal|indigo|violet|brown)\b",
            RegexOptions.IgnoreCase);
        foreach (var file in files)
        {
            var text = File.ReadAllText(file);
            Assert.DoesNotContain("rgb(", text.ToLowerInvariant());
            Assert.DoesNotContain("hsl(", text.ToLowerInvariant());
            Assert.False(named.IsMatch(text), $"chromatic colour word in {file}");
            foreach (Match match in hex.Matches(text))
            {
                var value = match.Groups[1].Value.Length == 8 ? match.Groups[1].Value[2..] : match.Groups[1].Value;
                if (value.Length == 3)
                {
                    Assert.True(value[0] == value[1] && value[1] == value[2], $"chromatic hex {match.Value} in {file}");
                    continue;
                }
                var r = value[..2]; var g = value[2..4]; var b = value[4..6];
                Assert.True(r == g && g == b, $"chromatic hex {match.Value} in {file}");
            }
        }
    }

    [Fact]
    public void ViewsNeverHardcodeNaturalLanguage()
    {
        var views = Directory.GetFiles(Path.Combine(Root(), "desktop/src/AgentBuddy.App/Views"), "*.axaml");
        var literal = new Regex(@"(?:Text|Content|Watermark|Header)\s*=\s*""(?!\{Binding)[^""]*[A-Za-z]{2,}[^""]*""");
        foreach (var view in views)
            Assert.False(literal.IsMatch(File.ReadAllText(view)), $"hardcoded text in {Path.GetFileName(view)}");
    }

    [Fact]
    public void AllFifteenScreensHaveAViewAndALocatorEntry()
    {
        var viewsDir = Path.Combine(Root(), "desktop/src/AgentBuddy.App/Views");
        var names = Directory.GetFiles(viewsDir, "*View.axaml").Select(Path.GetFileNameWithoutExtension).ToArray();
        Assert.Equal(17, names.Length); // 15 workbench screens + Connect + About
        foreach (var expected in new[]
                 {
                     "LoginView", "WorkspaceView", "ThreadListView", "ThreadView", "TaskListView",
                     "TaskTraceView", "OrgView", "ChannelsView", "ConnectorsView", "SettingsView",
                     "ComputersView", "SchedulesView", "PersonaView", "KnowledgeView", "FilesView",
                     "ConnectView", "AboutView"
                 })
            Assert.Contains(expected, names);
        var locator = File.ReadAllText(Path.Combine(Root(), "desktop/src/AgentBuddy.App/ViewLocator.cs"));
        foreach (var name in names) Assert.Contains("new " + name, locator);
        var codeBehind = File.ReadAllText(Path.Combine(viewsDir, "ViewClasses.cs"));
        foreach (var name in names) Assert.Contains("partial class " + name, codeBehind);
    }

    [Fact]
    public void EveryFrozenEndpointConstantIsReferencedOutsideItsDefinition()
    {
        var contract = File.ReadAllText(Path.Combine(Root(), "desktop/src/AgentBuddy.Core/Contracts/Endpoints.cs"));
        var others = SourceFiles("desktop/src", "desktop/tests", "desktop/tools")
            .Where(f => !f.EndsWith("Endpoints.cs", StringComparison.OrdinalIgnoreCase) && f.EndsWith(".cs"))
            .Select(File.ReadAllText).ToArray();
        var all = string.Join("\n", others);
        var constants = new Regex(@"public\s+const\s+string\s+(\w+)\s*=").Matches(contract)
            .Select(m => m.Groups[1].Value).Distinct().ToArray();
        Assert.True(constants.Length >= 70, "endpoint catalogue shrank");
        foreach (var name in constants)
            Assert.Contains(name, all); // no wrapper without a caller (the old api-usage guard)
    }

    [Fact]
    public void SharedControlsAreDeclaredAndEveryScreenReusesThem()
    {
        var app = Path.Combine(Root(), "desktop/src/AgentBuddy.App");
        var controlFiles = Directory.GetFiles(Path.Combine(app, "Controls"), "*Control.axaml");
        var names = controlFiles.Select(Path.GetFileNameWithoutExtension).ToArray();
        Assert.Equal(6, names.Length);
        var codeBehind = File.ReadAllText(Path.Combine(app, "Controls/ControlClasses.cs"));
        foreach (var name in names) Assert.Contains("partial class " + name, codeBehind);

        var literal = new Regex(@"(?:Text|Content|Watermark|Header)\s*=\s*""(?!\{Binding)[^""]*[A-Za-z]{2,}[^""]*""");
        foreach (var file in controlFiles)
            Assert.False(literal.IsMatch(File.ReadAllText(file)), $"hardcoded text in {Path.GetFileName(file)}");

        foreach (var view in Directory.GetFiles(Path.Combine(app, "Views"), "*View.axaml"))
            Assert.Contains("<c:PageHeaderControl", File.ReadAllText(view)); // one header, 17 screens

        var window = File.ReadAllText(Path.Combine(app, "MainWindow.axaml"));
        Assert.Contains("<c:TopBarControl", window);
        Assert.Contains("<c:SidebarControl", window);
        Assert.Contains("<c:FileTransferControl", File.ReadAllText(Path.Combine(app, "Views/FilesView.axaml")));
        Assert.Contains("<c:VoiceControl", File.ReadAllText(Path.Combine(app, "Views/ThreadView.axaml")));
        Assert.Contains("<c:TaskActionsControl", File.ReadAllText(Path.Combine(app, "Views/TaskTraceView.axaml")));
    }

    [Fact]
    public void LightAndDarkThemeDictionariesExposeTheSameKeys()
    {
        var theme = File.ReadAllText(Path.Combine(Root(), "desktop/src/AgentBuddy.App/Styles/Theme.axaml"));
        var keys = new Regex(@"x:Key=""(Brush\.[^""]+)""").Matches(theme).Select(m => m.Groups[1].Value).ToArray();
        Assert.NotEmpty(keys);
        foreach (var key in keys.Distinct())
            Assert.Equal(2, keys.Count(k => k == key)); // exactly one Light + one Dark value
        Assert.Contains("RequestedThemeVariant=\"Light\"",
            File.ReadAllText(Path.Combine(Root(), "desktop/src/AgentBuddy.App/App.axaml")));
        Assert.Contains("MinHeight", File.ReadAllText(
            Path.Combine(Root(), "desktop/src/AgentBuddy.App/Styles/Controls.axaml")));
        Assert.Contains("RightToLeft", File.ReadAllText(
            Path.Combine(Root(), "desktop/src/AgentBuddy.App/Composition.cs")));
    }

    [Fact]
    public void NewSourceHasNoTauriOrBunOrCargoReferences()
    {
        var legacy = new Regex(@"\b(tauri|cargo|bun|vite|vue|vitest|rust-embed)\b", RegexOptions.IgnoreCase);
        foreach (var file in SourceFiles("desktop/src", "desktop/tools").Where(f => f.EndsWith(".cs") || f.EndsWith(".axaml")))
            Assert.False(legacy.IsMatch(File.ReadAllText(file)), $"legacy tooling reference in {file}");
    }

    [Fact]
    public void BuildAndReleaseToolingIsDotnetOnly()
    {
        var legacy = new Regex(@"\b(tauri|cargo|bun|vite|vue|vitest|rust-embed)\b", RegexOptions.IgnoreCase);
        foreach (var relative in new[]
                 {
                     ".github/workflows/ci.yml", ".github/workflows/release.yml",
                     "Makefile", ".gitignore"
                 })
        {
            var text = File.ReadAllText(Path.Combine(Root(), relative));
            Assert.False(legacy.IsMatch(text), $"legacy tooling reference in {relative}");
        }

        var ci = File.ReadAllText(Path.Combine(Root(), ".github/workflows/ci.yml"));
        Assert.Contains("actions/setup-dotnet@v4", ci);
        Assert.Contains("global-json-file: desktop/global.json", ci);
        Assert.Contains("dotnet test", ci);
        Assert.Contains("XPlat Code Coverage", ci);

        var release = File.ReadAllText(Path.Combine(Root(), ".github/workflows/release.yml"));
        Assert.Contains("dotnet publish", release);
        Assert.Contains("tools/AgentBuddy.Build", release);
        Assert.Contains("--self-contained true", release);
        foreach (var name in ReleaseContract.Downloads("V"))
            Assert.Contains(name.Replace("-V.", "-*."), release); // six glob allowlist entries
        Assert.Contains("fail_on_unmatched_files: true", release);

        var makefile = File.ReadAllText(Path.Combine(Root(), "Makefile"));
        Assert.Contains("dotnet-test", makefile);
        Assert.Contains("dotnet-coverage", makefile);
        Assert.Contains("dotnet-smoke", makefile);
        Assert.DoesNotContain("web-test", makefile);
        Assert.DoesNotContain("desktop-test", makefile);

        var props = File.ReadAllText(Path.Combine(Root(), "desktop/Directory.Build.props"));
        Assert.Contains("<Version>", props);
        Assert.Contains("net10.0", props);
        Assert.Contains("ReleaseContract.MsiUpgradeCode", File.ReadAllText(
            Path.Combine(Root(), "desktop/tools/AgentBuddy.Build/Program.cs")));
    }

    [Fact]
    public void MainDocumentationDescribesTheCurrentStackOnly()
    {
        var stale = new Regex(
            @"tauri\.conf\.json|src-tauri/|frontend-stub/|web/src/|web/dist/index\.html|" +
            @"bun run|cargo test|make web-|make desktop-|vitest|theme-init\.js|" +
            @"window\.location\.hash|tauri-plugin-|setTrayBadge|ProxyState\.unread|" +
            @"纯 Web 构建|createWebHashHistory", RegexOptions.IgnoreCase);
        var docs = new[]
        {
            "AGENTS.md", "README.md", "README_cn.md", "requirements.md",
            "releasenotes.md", "releasenotes_cn.md", "releasenotes_emoji.md",
            "docs/index.html"
        };
        foreach (var relative in docs)
        {
            var text = File.ReadAllText(Path.Combine(Root(), relative));
            Assert.False(stale.IsMatch(text), $"legacy implementation detail in {relative}");
        }
        foreach (var relative in new[] { "README.md", "README_cn.md", "AGENTS.md", "requirements.md" })
        {
            var text = File.ReadAllText(Path.Combine(Root(), relative));
            Assert.Contains(".NET 10", text);
            Assert.Contains("Avalonia", text);
        }
    }

    [Fact]
    public void ReleaseContractStillMeansExactlyNineAssets()
    {
        var assets = ReleaseContract.AllAssets("1.0.0");
        Assert.Equal(9, assets.Length);
        Assert.Equal(6, ReleaseContract.Downloads("1.0.0").Length);
        Assert.Equal(3, ReleaseContract.Manifests.Length);
        Assert.Equal(3, PlatformKeys.Published.Length);
        Assert.Equal(12, ShellEndpoints.All.Length);
        Assert.Equal(8, SseEvents.All.Length);
    }
}
