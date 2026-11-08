//! Signalling a whole process group, so a timed-out job cannot leave work behind.
//!
//! Every job gets its own group (`process_group(0)` in `spawn`), which makes the
//! direct child its leader. From there a *negative* pid addresses every process
//! in that tree — including the grandchildren a compiler, a test runner or a
//! language server starts. Killing only the direct child was the old behaviour:
//! the child died, its children kept the CPU and, worse, kept the pipes open, so
//! the output readers only saw EOF once those grandchildren finished.
//!
//! Two constants and one libc function are declared here rather than pulling in
//! a dependency for them; both are POSIX and stable ABI on Linux and macOS.

use std::ffi::c_int;

/// `SIGTERM`: ask the tree to stop.
const SIGTERM: c_int = 15;
/// `SIGKILL`: stop it.
const SIGKILL: c_int = 9;

extern "C" {
    fn kill(pid: c_int, signal: c_int) -> c_int;
}

/// Asks every process in the group led by `pgid` to terminate.
pub(crate) fn terminate_group(pgid: i32) -> bool {
    signal_group(pgid, SIGTERM)
}

/// Terminates every process in the group led by `pgid`, unconditionally.
pub(crate) fn kill_group(pgid: i32) -> bool {
    signal_group(pgid, SIGKILL)
}

fn signal_group(pgid: i32, signal: c_int) -> bool {
    // pid 1 is init, and 0 or a negative pid addresses our own group (or every
    // process we are allowed to signal) — the one mistake that would take the
    // app down together with the job it was trying to stop.
    if pgid <= 1 {
        return false;
    }
    // SAFETY: `kill` takes two integers and has no memory contract; a negative
    // pid is the documented way to address a process group.
    unsafe { kill(-pgid, signal) == 0 }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::process::{Command, Stdio};
    use std::os::unix::process::CommandExt;
    use std::time::{Duration, Instant};

    fn alive(pid: i32) -> bool {
        // SAFETY: signal 0 performs the existence check without delivering.
        unsafe { kill(pid, 0) == 0 }
    }

    /// Polls until `pid` is gone, so a kernel that reaps lazily does not turn a
    /// correct kill into a flaky assertion.
    fn wait_until_gone(pid: i32) -> bool {
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            if !alive(pid) {
                return true;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        false
    }

    #[test]
    fn the_guard_refuses_pids_that_would_hit_our_own_group() {
        // 0 is "my group", 1 is init, and a negative pid is invalid input: none
        // may be signalled.
        assert!(!terminate_group(0));
        assert!(!kill_group(0));
        assert!(!terminate_group(1));
        assert!(!kill_group(1));
        assert!(!kill_group(-42));
    }

    #[test]
    fn a_group_kill_reaches_the_grandchild() {
        let dir = std::env::temp_dir().join(format!("agentbuddy-procgroup-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let pid_file = dir.join("grandchild.pid");

        // `sh` on purpose: this exercises the OS primitive, not the command
        // whitelist (which refuses shells by construction). The shell backgrounds
        // a `sleep` — a grandchild in the same group — then waits for it.
        let mut child = Command::new("sh")
            .arg("-c")
            .arg("sleep 30 & echo $! > grandchild.pid; wait")
            .current_dir(&dir)
            .process_group(0)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("sh must be available on the test host");
        let pgid = child.id() as i32;
        assert!(pgid > 1);

        // Wait for the grandchild to exist before signalling: a kill that lands
        // before the fork would make this a test of nothing.
        let deadline = Instant::now() + Duration::from_secs(5);
        let grandchild = loop {
            if let Some(pid) = fs::read_to_string(&pid_file)
                .ok()
                .and_then(|text| text.trim().parse::<i32>().ok())
            {
                break pid;
            }
            assert!(Instant::now() < deadline, "the grandchild never started");
            std::thread::sleep(Duration::from_millis(20));
        };
        assert!(alive(grandchild), "the grandchild must be running before the test acts");

        assert!(terminate_group(pgid), "TERM must reach the group");
        std::thread::sleep(Duration::from_millis(250));
        // The leader is not reaped yet, so the group still exists even if every
        // member already died from TERM.
        assert!(kill_group(pgid), "KILL must still be accepted");
        let _ = child.wait();

        assert!(wait_until_gone(grandchild), "the timeout must not leave the grandchild behind");
        assert!(!alive(pgid), "the direct child must be reaped, not left as a zombie");
        let _ = fs::remove_dir_all(&dir);
    }
}
