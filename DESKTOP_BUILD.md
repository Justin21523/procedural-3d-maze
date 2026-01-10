# Desktop builds (Tauri)

This project is a Vite + Three.js web game. For a single-file desktop app experience (no Node required for players), we wrap the built `dist/` output in a Tauri shell.

## Requirements (for builders only)

- Node.js 18+ (dev/build machine only)
- Rust toolchain (stable)
  - Install via `rustup` (recommended by Tauri docs)
- Platform build tools:
  - Windows: MSVC build tools
  - macOS: Xcode command line tools
  - Linux: WebKit2GTK + common build deps

Players do **not** need Node or Rust.

## One-time setup

```bash
npm install
```

If you don't have Rust yet, install `rustup` + `stable` first.

## Dev (desktop window)

Runs Vite on `http://localhost:3002` and opens the Tauri window:

```bash
npm run desktop:dev
```

## Build installers / executables

Builds `dist/` then bundles an installer/executable:

```bash
npm run desktop:build
```

Outputs are placed under `src-tauri/target/release/bundle/`.

## Notes

- This repo uses absolute asset paths like `/models/...` and `/textures/...`.
  - Tauri's `custom-protocol` serves the app under an internal origin so these paths work without changing the game code.

