using System.Globalization;
using System.Text.RegularExpressions;
using AgentBuddy.Core.Contracts;
using CommunityToolkit.Mvvm.ComponentModel;

namespace AgentBuddy.App.ViewModels;

/// <summary>Native route registry (17 routes) with the same authentication guard as the old router.</summary>
public sealed partial class NavigationService : ObservableObject
{
    private readonly Dictionary<string, ScreenViewModel> _routes = new(StringComparer.Ordinal);
    private ScreenViewModel? _current;
    private static readonly string[] AnonymousRoutes = ["/login", "/__shell/connect", "/__shell/about"];

    public ScreenViewModel? Current { get => _current; private set => SetProperty(ref _current, value); }
    public bool IsAuthenticated { get; private set; }
    public string? ReturnRoute { get; private set; }
    public event Action<ScreenViewModel?>? CurrentChanged;

    /// <summary>
    /// The per-entity event stream the new screen needs ("/api/tasks/7/events"), or null
    /// when the screen has none. Templated paths are never raised: the server has no such
    /// route, so subscribing to one would 404 forever.
    /// </summary>
    public event Action<string?>? EntityStreamChanged;

    public void Register(string route, ScreenViewModel screen) => _routes[route] = screen;
    public IReadOnlyDictionary<string, ScreenViewModel> Routes => _routes;

    public void SetAuthenticated(bool value)
    {
        IsAuthenticated = value;
        if (!value) ReturnRoute = null;
    }

    public async Task<string> NavigateAsync(string route)
    {
        var normalized = Normalize(route);
        if (!IsAuthenticated && !AnonymousRoutes.Contains(normalized))
        {
            ReturnRoute = normalized;
            normalized = "/login";
        }
        else if (IsAuthenticated && normalized == "/login")
        {
            normalized = ReturnRoute ?? "/";
            ReturnRoute = null;
        }
        if (!_routes.ContainsKey(normalized)) normalized = "/";
        Current = _routes[normalized];
        string? stream = null;
        if (Current is IEntityScreen entity)
        {
            if (TryParseEntityId(route, out var id)) entity.EntityId = id;
            if (entity.EntityId > 0) stream = Endpoints.Format(entity.StreamTemplate, ("id", entity.EntityId));
        }
        EntityStreamChanged?.Invoke(stream);
        CurrentChanged?.Invoke(Current);
        await Current.RefreshAsync().ConfigureAwait(false);
        return normalized;
    }

    /// <summary>Detail routes carry the id before normalization maps them to a template.</summary>
    internal static bool TryParseEntityId(string route, out long id)
    {
        var parts = route.Split('#')[0].Split('?')[0].Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length == 2 && (parts[0] == "threads" || parts[0] == "tasks"))
            return long.TryParse(parts[1], NumberStyles.None, CultureInfo.InvariantCulture, out id);
        id = 0;
        return false;
    }

    public static string Normalize(string route)
    {
        var value = route.Split('#')[0].Split('?')[0];
        if (value.Length == 0) return "/";
        if (NumberedRoute().IsMatch(value)) return "/threads/:id";
        if (TaskRoute().IsMatch(value)) return "/tasks/:id";
        return value;
    }

    [GeneratedRegex(@"^/threads/\d+$")]
    private static partial Regex NumberedRoute();

    [GeneratedRegex(@"^/tasks/\d+$")]
    private static partial Regex TaskRoute();
}
