//! `rust-embed` needs `../dist/` to exist at compile time, and the desktop app
//! depends on this crate, so a checkout without a frontend build used to break
//! every `cargo build`/`tauri dev` before a single line of Rust was at fault.
//!
//! A debug build only needs the folder to be there: the static handler already
//! reports a missing bundle at runtime, so an empty directory is enough. Release
//! builds keep the hard error rather than embed nothing.

use std::path::Path;

fn main() {
    // Rerun when the bundle appears or changes; otherwise a cached build keeps
    // compiling against a directory this script no longer creates.
    println!("cargo:rerun-if-changed=../dist");

    if Path::new("../dist").exists() {
        return;
    }

    if std::env::var("PROFILE").as_deref() != Ok("debug") {
        return;
    }

    let _ = std::fs::create_dir_all("../dist");
}
