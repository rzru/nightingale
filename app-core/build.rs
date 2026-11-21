use std::env;
use std::path::PathBuf;

/// Compile-time env vars that get baked into the binary via `option_env!`.
/// Each is sourced from the process env first, then from a `.env` at the
/// workspace root. Missing values are silently skipped so `option_env!`
/// resolves to `None` and the code falls back to runtime lookups.
const FORWARDED_KEYS: &[&str] = &[
    "PIXABAY_API_KEY",
    "YOUTUBE_CLIENT_ID",
    "YOUTUBE_CLIENT_SECRET",
];

fn main() {
    let manifest_dir =
        PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let dotenv_path = manifest_dir
        .parent()
        .map(|p| p.join(".env"))
        .unwrap_or_else(|| PathBuf::from(".env"));

    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed={}", dotenv_path.display());

    for key in FORWARDED_KEYS {
        println!("cargo:rerun-if-env-changed={key}");
    }

    let from_file = dotenvy::from_path_iter(&dotenv_path)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .collect::<std::collections::HashMap<_, _>>();

    for key in FORWARDED_KEYS {
        let value = env::var(key)
            .ok()
            .filter(|v| !v.is_empty())
            .or_else(|| from_file.get(*key).cloned());

        if let Some(value) = value
            && !value.is_empty()
        {
            println!("cargo:rustc-env={key}={value}");
        }
    }
}
