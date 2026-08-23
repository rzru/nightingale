# Building from Source

## Prerequisites

| Tool | Version |
|---|---|
| Rust | 1.85+ (workspace uses edition 2024) |
| Node.js | 20+ |
| pnpm | latest |
| Windows ASIO support | LLVM/Clang with `LIBCLANG_PATH`, Visual Studio C++ Build Tools, and the Steinberg ASIO SDK (set `CPAL_ASIO_DIR`) |
| Linux only | `libwebkit2gtk-4.1-dev`, `libssl-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `libxdo-dev`, `libasound2-dev` |

## Development

```bash
git clone <repo-url> nightingale
cd nightingale
cargo desktop dev
```

This starts the Tauri development server with hot-reload for the React frontend.

## Release Build

```bash
cargo desktop build
```

Builds the production app bundle for your current platform using Tauri's bundler.

## Re-running Setup

If something goes wrong with the vendor environment, you can force a fresh setup from the sidebar actions menu inside the app by selecting **Re-run Setup**.
