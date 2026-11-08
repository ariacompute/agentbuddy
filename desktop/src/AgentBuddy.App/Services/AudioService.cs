using System.Diagnostics;
using AgentBuddy.Core.Contracts;

namespace AgentBuddy.App;

public interface IAudioService
{
    Task<byte[]> RecordAsync(TimeSpan duration, CancellationToken ct = default);
    Task PlayAsync(Stream audio, CancellationToken ct = default);
}

/// <summary>
/// Avalonia has no built-in capture/playback. ffmpeg is used as an optional
/// cross-platform backend (argv only, never a shell). If it is missing the
/// caller gets the machine code speech_disabled instead of a silent failure.
/// The capture device is platform-specific and configurable via
/// AGENTBUDDY_AUDIO_DEVICE; the default is the OS recording default.
/// </summary>
public sealed class FfmpegAudioService : IAudioService
{
    /// <summary>Test seam: the one place a player/recorder process is started.</summary>
    internal static Func<ProcessStartInfo, Process?> StartProcess { get; set; } = static psi => Process.Start(psi);

    public async Task<byte[]> RecordAsync(TimeSpan duration, CancellationToken ct = default)
    {
        var (format, device) = InputDevice();
        var psi = new ProcessStartInfo("ffmpeg")
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        foreach (var arg in new[]
                 {
                     "-hide_banner", "-loglevel", "error", "-f", format, "-i", device,
                     "-t", Math.Max(1, (int)duration.TotalSeconds).ToString(),
                     "-c:a", "libopus", "-f", "webm", "pipe:1"
                 })
            psi.ArgumentList.Add(arg);
        try
        {
            using var process = StartProcess(psi) ?? throw new HubApiException(ErrorCodes.SpeechDisabled);
            using var output = new MemoryStream();
            await process.StandardOutput.BaseStream.CopyToAsync(output, ct).ConfigureAwait(false);
            await process.WaitForExitAsync(ct).ConfigureAwait(false);
            if (process.ExitCode != 0) throw new HubApiException(ErrorCodes.SpeechDisabled);
            return output.ToArray();
        }
        catch (HubApiException) { throw; }
        catch (Exception) { throw new HubApiException(ErrorCodes.SpeechDisabled); }
    }

    public async Task PlayAsync(Stream audio, CancellationToken ct = default)
    {
        var psi = new ProcessStartInfo("ffplay")
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardInput = true,
            RedirectStandardError = true
        };
        foreach (var arg in new[] { "-hide_banner", "-loglevel", "error", "-nodisp", "-autoexit", "-" })
            psi.ArgumentList.Add(arg);
        try
        {
            using var process = StartProcess(psi) ?? throw new HubApiException(ErrorCodes.SpeechDisabled);
            await audio.CopyToAsync(process.StandardInput.BaseStream, ct).ConfigureAwait(false);
            process.StandardInput.Close();
            await process.WaitForExitAsync(ct).ConfigureAwait(false);
        }
        catch (Exception) { throw new HubApiException(ErrorCodes.SpeechDisabled); }
    }

    /// <summary>
    /// <paramref name="os"/> defaults to the running platform; tests pass it so all
    /// three capture defaults can be asserted on one host.
    /// </summary>
    internal static (string Format, string Device) InputDevice(string? os = null)
    {
        var configured = Environment.GetEnvironmentVariable("AGENTBUDDY_AUDIO_DEVICE");
        if (!string.IsNullOrEmpty(configured)) return ("pulse", configured);
        os ??= OperatingSystem.IsWindows() ? "windows" : OperatingSystem.IsMacOS() ? "macos" : "linux";
        if (os == "windows") return ("dshow", "audio=default");
        if (os == "macos") return ("avfoundation", ":default");
        return ("pulse", "default");
    }
}
