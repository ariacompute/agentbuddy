using System.Runtime.InteropServices;
using Avalonia.Controls;

namespace AgentBuddy.App;

/// <summary>
/// Controls.axaml declares no transitions at all, so reduced motion holds by
/// construction. This service still detects the OS preference and tags the
/// window so a future animation can opt out explicitly.
/// </summary>
public static class ReducedMotionService
{
    private const uint SpiGetClientAreaAnimation = 0x1042;

    public static bool ReduceMotion { get; internal set; } = Detect();

    public static void Apply(Window window)
    {
        if (ReduceMotion) window.Classes.Add("reduce-motion");
    }

    /// <summary>
    /// <paramref name="overrideValue"/> and <paramref name="isWindows"/> default to the
    /// real environment and platform; tests pass them explicitly so every branch can be
    /// asserted on one host (the OS query itself is Windows-only).
    /// </summary>
    internal static bool Detect(string? overrideValue = null, bool? isWindows = null)
    {
        overrideValue ??= Environment.GetEnvironmentVariable("AGENTBUDDY_REDUCE_MOTION");
        if (overrideValue is "1" or "true" or "TRUE") return true;
        if (overrideValue is "0" or "false" or "FALSE") return false;
        if (!(isWindows ?? OperatingSystem.IsWindows())) return false;
        try
        {
            var enabled = 1;
            return SystemParametersInfo(SpiGetClientAreaAnimation, 0, ref enabled, 0) && enabled == 0;
        }
        catch (Exception) { return false; }
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SystemParametersInfo(uint action, uint parameter, ref int value, uint winIni);
}
