//! Keeping the helper programs the shell spawns out of sight.
//!
//! `agentbuddy` is a GUI-subsystem executable: it owns no console. Windows then
//! gives every console program it starts a *new* console window, which the user
//! sees as a black box flashing over the workbench. `icacls` did exactly that on
//! every settings save — and a theme switch is a save — so the window appeared
//! out of nowhere in the middle of the workbench. A job of the execution node
//! would do the same once a second.
//!
//! `CREATE_NO_WINDOW` starts the child with no console at all, so there is no
//! window to flash. Output is unaffected: everything the shell reads from a
//! child travels through `Stdio::piped` handles, never through a console.
//!
//! The `windows_subsystem = "windows"` in `main.rs` is the other half of it: a
//! release build is GUI-subsystem (no console, hence the flash), while a debug
//! build keeps the console and the child inherits it — so the symptom shows up
//! only in packaged builds.
//!
//! Two helpers rather than one because `std` and `tokio` own separate `Command`
//! types. Both are no-ops away from Windows, so call sites stay free of `cfg`.

/// `CREATE_NO_WINDOW` from `<winbase.h>`. Spelled out instead of taking a direct
/// dependency on `windows-sys` for a single flag; the value is part of the Win32
/// ABI and has never changed.
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Starts `command` without a console window. No-op away from Windows.
pub fn hide(command: &mut std::process::Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    {
        let _ = command;
    }
}

/// The same for a child started by the async runtime.
pub fn hide_async(command: &mut tokio::process::Command) {
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    #[cfg(not(windows))]
    {
        let _ = command;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A wrong flag is worse than no flag: `0x0800_000` would be a reserved bit
    /// that `CreateProcess` rejects, and the failure would look like the helper
    /// program being broken.
    #[test]
    fn the_no_console_flag_is_the_documented_win32_value() {
        assert_eq!(CREATE_NO_WINDOW, 0x0800_0000);
        // `EXTENDED_STARTUPINFO_PRESENT` (0x0000_0800) is the neighbouring bit
        // someone reaches for first; picking it would still open a console.
        assert_ne!(CREATE_NO_WINDOW, 0x0000_0800);
    }

    /// The rule that keeps the bug from coming back: every child process in the
    /// shell has to be started hidden. Reading the sources is the only way to
    /// prove it — the flag leaves no trace a unit test could inspect, and the
    /// flash itself is visible only on a desktop.
    #[test]
    fn every_child_the_shell_starts_hides_its_console() {
        for (name, source) in [
            ("session.rs", include_str!("session.rs")),
            ("executor/spawn.rs", include_str!("executor/spawn.rs")),
        ] {
            let mut rest = source;
            while let Some(at) = rest.find("Command::new(") {
                rest = &rest[at + "Command::new(".len()..];
                // The call has to be right next to the construction: the further
                // it drifts, the easier it is to drop while editing the argument
                // block in between.
                let window: String = rest.chars().take(400).collect();
                assert!(
                    window.contains("console::hide"),
                    "{name} starts a child without `console::hide`: a console program \
                     spawned from this GUI app gets a window of its own"
                );
            }
        }
    }
}
