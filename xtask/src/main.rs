use std::process::{Command, ExitCode};

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();

    let (cmd, tauri_args) = match args.first().map(|s| s.as_str()) {
        Some("dev") => ("dev", &args[1..]),
        Some("build") => ("build", &args[1..]),
        _ => {
            eprintln!("Usage: cargo desktop <dev|build> [extra tauri args...]");
            return ExitCode::FAILURE;
        }
    };

    let workspace_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("xtask must live one level below workspace root");

    // Use "pnpm.cmd" on Windows (the batch wrapper) and "pnpm" on other platforms.
    let pnpm = if cfg!(target_os = "windows") {
        "pnpm.cmd"
    } else {
        "pnpm"
    };
    let mut command = Command::new(pnpm);
    command
        .current_dir(workspace_root.join("client"))
        .arg("tauri")
        .arg(cmd)
        .args(tauri_args);

    match command.status() {
        Ok(status) => {
            if status.success() {
                ExitCode::SUCCESS
            } else {
                ExitCode::FAILURE
            }
        }
        Err(e) => {
            eprintln!("Failed to run pnpm: {e}");
            ExitCode::FAILURE
        }
    }
}
