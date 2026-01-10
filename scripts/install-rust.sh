#!/usr/bin/env bash
set -euo pipefail

# Installs Rust toolchain (rustup + stable) for the current user.
# This is required for Tauri desktop builds.

if command -v cargo >/dev/null 2>&1 && command -v rustc >/dev/null 2>&1; then
  echo "✅ Rust already installed:"
  cargo --version
  rustc --version
  exit 0
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "❌ curl not found. Install curl first (e.g. sudo apt-get install -y curl)."
  exit 1
fi

echo "📦 Installing rustup (stable toolchain)…"
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y

# shellcheck disable=SC1091
source "$HOME/.cargo/env"

echo "🔧 Ensuring stable toolchain is installed…"
rustup toolchain install stable
rustup default stable

echo "✅ Rust installed:"
cargo --version
rustc --version

cat <<'EOF'

Next steps:
- Restart your terminal, or run:
  source "$HOME/.cargo/env"

Then you can run:
  npm run desktop:dev
  npm run desktop:build
EOF

