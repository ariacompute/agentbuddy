fn main() {
    // Stamp the build commit so the UI can report the exact revision it came
    // from, instead of the uninformative `unknown`. A CI-provided
    // `AGENTBUDDY_COMMIT` wins; otherwise derive it from the working tree's
    // HEAD so a local build is always identifiable. (The Makefile no longer
    // needs to forward it — `cargo:rustc-env` makes it reach the crate no
    // matter how the build is launched: `make desktop-*`, `bun run dev`, or a
    // bare `cargo build`.)
    stamp_commit();
    tauri_build::build()
}

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
