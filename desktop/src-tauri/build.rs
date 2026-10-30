fn main() {
    // Re-run this build script when the checked-out commit changes, otherwise
    // cargo caches the `cargo:rustc-env` below and the stamped commit goes stale
    // after a new commit (no crate file changes, so the crate is never
    // recompiled and the old hash stays baked into `crate::COMMIT`).
    watch_git();
    stamp_commit();
    tauri_build::build()
}

/// Re-run the build script on branch switches (`.git/HEAD`) and on commits to
/// the current branch (the ref `HEAD` points at), so the stamp stays current.
fn watch_git() {
    let Some(git_dir) = git_output(&["rev-parse", "--absolute-git-dir"]) else {
        return;
    };
    println!("cargo:rerun-if-changed={git_dir}/HEAD");
    if let Some(refname) = git_output(&["rev-parse", "--symbolic-full-name", "HEAD"]) {
        println!("cargo:rerun-if-changed={git_dir}/{refname}");
    }
}

/// Stamp the build commit so the UI can report the exact revision it came
/// from, instead of the uninformative `unknown`. A CI-provided
/// `AGENTBUDDY_COMMIT` wins; otherwise derive it from the working tree's
/// HEAD so a local build is always identifiable.
fn stamp_commit() {
    let commit = std::env::var("AGENTBUDDY_COMMIT")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .or_else(git_commit)
        .unwrap_or_else(|| "unknown".to_string());
    println!("cargo:rustc-env=AGENTBUDDY_COMMIT={commit}");
}

fn git_commit() -> Option<String> {
    let output = std::process::Command::new("git")
        .args(["rev-parse", "--short=7", "HEAD"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8(output.stdout).ok()?;
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn git_output(args: &[&str]) -> Option<String> {
    let output = std::process::Command::new("git").args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let value = String::from_utf8(output.stdout).ok()?.trim().to_string();
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}
