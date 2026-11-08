using System.Diagnostics;

namespace AgentBuddy.Shell.Tests;

/// <summary>
/// Real child processes with a known outcome, built only from tools every
/// supported OS ships. Tests substitute them for ffmpeg, the notification
/// client, the installer and the executor command under test, so the same
/// assertions run on Windows, macOS and Linux. The previous substitutes
/// (where.exe / findstr.exe / ping.exe) exist only on Windows: on the other
/// two they failed to spawn and the machine code under test
/// (speech_disabled, no_app, denied) was asserted instead of the real path.
/// </summary>
internal static class TestProbe
{
    /// <summary>Exits 0 and writes one line to stdout.</summary>
    public static Process? Echo() => Start(OperatingSystem.IsWindows()
        ? new ProcessStartInfo("cmd.exe") { ArgumentList = { "/c", "echo", "probe" } }
        : new ProcessStartInfo("/bin/echo") { ArgumentList = { "probe" } },
        readsStdin: false);

    /// <summary>Exits non-zero: the "denied" / "rejected" branch.</summary>
    public static Process? Failer() => Start(OperatingSystem.IsWindows()
        ? new ProcessStartInfo("where.exe") { ArgumentList = { "definitely-not-a-program" } }
        : new ProcessStartInfo("/usr/bin/false"),
        readsStdin: false);

    /// <summary>Drains stdin to the end, so the writer never sees a broken pipe.</summary>
    public static Process? Sink(string marker) => Start(OperatingSystem.IsWindows()
        ? new ProcessStartInfo("findstr.exe") { ArgumentList = { marker } }
        : new ProcessStartInfo("/bin/cat"),
        readsStdin: true);

    /// <summary>Outlives any per-test budget until the code under test kills it.</summary>
    public static Process? Sleeper() => Start(OperatingSystem.IsWindows()
        ? new ProcessStartInfo("ping.exe") { ArgumentList = { "-n", "30", "127.0.0.1" } }
        : new ProcessStartInfo("/bin/sleep") { ArgumentList = { "30" } },
        readsStdin: false);

    private static Process? Start(ProcessStartInfo psi, bool readsStdin)
    {
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.RedirectStandardInput = readsStdin;
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        return Process.Start(psi);
    }
}
