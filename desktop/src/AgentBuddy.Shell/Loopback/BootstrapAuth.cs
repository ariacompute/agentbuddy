using System.Security.Cryptography;
using System.Text;
using AgentBuddy.Core.Contracts;
using Microsoft.AspNetCore.Http;

namespace AgentBuddy.Shell.Loopback;

/// <summary>
/// Every launch mints a fresh 256-bit token and a one-shot nonce. The token
/// never reaches JS and is never forwarded upstream. Origin is checked BEFORE
/// authentication, matching the old proxy's ordering.
/// </summary>
public sealed class BootstrapAuth
{
    private readonly string _token = Convert.ToHexString(RandomNumberGenerator.GetBytes(Gateway.TokenBytes)).ToLowerInvariant();
    private readonly string _nonce = Convert.ToHexString(RandomNumberGenerator.GetBytes(Gateway.TokenBytes)).ToLowerInvariant();
    private readonly DateTimeOffset _created = DateTimeOffset.UtcNow;
    private int _nonceUsed;

    public string Token => _token;
    public string Nonce => _nonce;
    public string CookieHeader => Gateway.CookieName + "=" + _token + Gateway.CookieAttributes;

    public bool OriginAllowed(HttpContext context, string selfUrl)
    {
        var origin = context.Request.Headers.Origin.ToString();
        if (string.IsNullOrEmpty(origin)) return true; // native clients send no Origin
        if (!Uri.TryCreate(origin, UriKind.Absolute, out var candidate)) return false;
        var self = new Uri(selfUrl);
        var sameHost = candidate.Host == self.Host ||
                       (candidate.Host is "localhost" && self.Host is "127.0.0.1") ||
                       (candidate.Host is "127.0.0.1" && self.Host is "localhost");
        return candidate.Scheme == self.Scheme && candidate.Port == self.Port && sameHost;
    }

    public bool IsAuthorized(HttpContext context)
    {
        var cookie = context.Request.Cookies[Gateway.CookieName];
        if (!string.IsNullOrEmpty(cookie) && FixedEquals(cookie, _token)) return true;
        var auth = context.Request.Headers.Authorization.ToString();
        const string prefix = "Bearer ";
        if (auth.StartsWith(prefix, StringComparison.Ordinal) && FixedEquals(auth[prefix.Length..].Trim(), _token))
            return true;
        return false;
    }

    public bool TryConsumeNonce(string? supplied)
    {
        if (string.IsNullOrEmpty(supplied) || !FixedEquals(supplied, _nonce)) return false;
        if (DateTimeOffset.UtcNow - _created > TimeSpan.FromSeconds(Gateway.NonceTtlSeconds)) return false;
        return Interlocked.Exchange(ref _nonceUsed, 1) == 0;
    }

    private static bool FixedEquals(string left, string right)
    {
        var a = Encoding.UTF8.GetBytes(left);
        var b = Encoding.UTF8.GetBytes(right);
        return a.Length == b.Length && CryptographicOperations.FixedTimeEquals(a, b);
    }
}
