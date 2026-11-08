//! Process-group termination is not available here, and this module says so.
//!
//! Windows has no POSIX process groups. `CREATE_NEW_PROCESS_GROUP` plus
//! `GenerateConsoleCtrlEvent` only reaches console processes attached to the
//! same console, and the real answer — one job object per job — needs a handle
//! kept per child plus new unsafe FFI. Returning `false` is honest: the caller
//! falls back to `start_kill` on the direct child and does not claim a cleanup it
//! did not perform.

pub(crate) fn terminate_group(_pgid: i32) -> bool {
    false
}

pub(crate) fn kill_group(_pgid: i32) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn this_platform_never_claims_a_group_kill() {
        // The fallback branch in `spawn` depends on this answer.
        assert!(!terminate_group(1234));
        assert!(!kill_group(1234));
    }
}
