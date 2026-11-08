using System.Text.Json;
using AgentBuddy.Core.Contracts;

namespace AgentBuddy.Core.Services;

public interface ILocalizationService
{
    string Lang { get; }
    bool IsRtl { get; }
    string Get(string key);
    string Get(string lang, string key);
    void SetLang(string lang);
    event Action<string>? LanguageChanged;
    IReadOnlyList<string> Keys { get; }
}

/// <summary>
/// Embedded copy.json, resolved exactly like use-copy.js: {...en, ...lang[lang]}
/// with en fallback. zh and zh-TW are distinct tables; only ar is RTL.
/// </summary>
public sealed class LocalizationService : ILocalizationService
{
    private readonly Dictionary<string, Dictionary<string, string>> _tables;
    private readonly string[] _keys;
    private string _lang = "en";

    public LocalizationService()
    {
        var assembly = typeof(LocalizationService).Assembly;
        var name = assembly.GetManifestResourceNames().FirstOrDefault(n => n.EndsWith("copy.json", StringComparison.Ordinal))
                   ?? throw new InvalidOperationException("embedded copy.json is missing");
        using var stream = assembly.GetManifestResourceStream(name)!;
        _tables = JsonSerializer.Deserialize<Dictionary<string, Dictionary<string, string>>>(stream)
                  ?? throw new InvalidOperationException("embedded copy.json is empty");
        _keys = _tables.TryGetValue("en", out var en) ? [.. en.Keys.OrderBy(k => k, StringComparer.Ordinal)] : [];
    }

    public string Lang => _lang;
    public bool IsRtl => LanguageCodes.IsRtl(_lang);
    public IReadOnlyList<string> Keys => _keys;
    public event Action<string>? LanguageChanged;

    public string Get(string key) => Get(_lang, key);

    public string Get(string lang, string key)
    {
        if (_tables.TryGetValue(lang, out var table) && table.TryGetValue(key, out var value) && value.Length > 0)
            return value;
        if (_tables.TryGetValue("en", out var english) && english.TryGetValue(key, out var fallback))
            return fallback;
        return key;
    }

    public void SetLang(string lang)
    {
        var normalized = LanguageCodes.All.Contains(lang) ? lang : LanguageCodes.Match(lang);
        if (normalized == _lang) return;
        _lang = normalized;
        LanguageChanged?.Invoke(normalized);
    }
}
