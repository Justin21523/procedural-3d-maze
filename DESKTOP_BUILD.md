# Desktop builds (Tauri)

This project is a Vite + Three.js web game. For a single-file desktop app experience (no Node required for players), we wrap the built `dist/` output in a Tauri shell.

## Requirements (for builders only)

- Node.js 18+ (dev/build machine only)
- Rust toolchain (stable)
  - Install via `rustup` (recommended by Tauri docs)
- Platform build tools:
  - Windows: MSVC build tools
  - macOS: Xcode command line tools
  - Linux: WebKit2GTK + common build deps (Tauri docs list the exact package names per distro)

Players do **not** need Node or Rust.

## One-time setup

```bash
npm install
```

If you don't have Rust yet, install `rustup` + `stable` first.

### Helper scripts (Ubuntu/Debian)

```bash
./scripts/install-desktop-deps-ubuntu.sh
./scripts/install-rust.sh
```

## Dev (desktop window)

Runs Vite on `http://localhost:3002` and opens the Tauri window:

```bash
npm run desktop:dev
```

If you see `failed to get cargo metadata`, install Rust (cargo/rustc) and restart the terminal.
If you see `listen EPERM ... 0.0.0.0:3002`, remove `--host` (desktop dev only needs localhost).

## Build installers / executables

Builds `dist/` then bundles an installer/executable:

```bash
npm run desktop:build
```

Outputs are placed under `src-tauri/target/release/bundle/`.

### Bundle targets

By default `npm run desktop:build` selects a stable bundle per platform:

- Linux: `deb`
- macOS: `dmg`
- Windows: `nsis`

Override with:

```bash
TAURI_BUNDLES=all npm run desktop:build
```

## Windows + macOS downloads (GitHub Releases)

This repo ships desktop builds via GitHub Actions:

1. Create and push a version tag (example):

```bash
git tag v0.1.0
git push origin v0.1.0
```

2. GitHub Actions workflow `Desktop Builds` builds:
   - Windows: NSIS `.exe`
   - macOS: `.dmg`
3. These files are attached to the GitHub Release for that tag.

### If a tag already exists (re-publish)

If you already pushed the tag but the release has no `.exe`, go to:
GitHub → Actions → `Desktop Builds` → Run workflow, and set `release_tag` to that tag (e.g. `v0.1.0`).

## Notes

- This repo uses absolute asset paths like `/models/...` and `/textures/...`.
  - Tauri's `custom-protocol` serves the app under an internal origin so these paths work without changing the game code.
- Diagnostic/test pages in the repo root (e.g. `diagnostic.html`, `test-ai.html`) are included in the Vite multi-page build so they work inside the packaged Tauri app too.
- Linux note: newer distros (e.g. Ubuntu 24.04) ship WebKitGTK 4.1 (libsoup3). This repo uses Tauri v2 to match that stack.
