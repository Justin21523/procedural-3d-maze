#!/usr/bin/env bash
set -euo pipefail

# Installs Linux system dependencies needed to build Tauri apps on Ubuntu/Debian.
# This script requires sudo.
#
# References (for package names per distro):
# - https://tauri.app/v1/guides/getting-started/prerequisites/

if ! command -v sudo >/dev/null 2>&1; then
  echo "❌ sudo not found. Run as root or install sudo."
  exit 1
fi

if ! command -v apt-get >/dev/null 2>&1; then
  echo "❌ apt-get not found. This script targets Ubuntu/Debian."
  echo "See Tauri prerequisites for your distro: https://tauri.app/v1/guides/getting-started/prerequisites/"
  exit 1
fi

echo "🔎 Checking distro…"
if [ -f /etc/os-release ]; then
  # shellcheck disable=SC1091
  source /etc/os-release
  echo "✅ Detected: ${PRETTY_NAME:-unknown}"
fi

pick_webkit_pkg() {
  local pkg=""
  for candidate in libwebkit2gtk-4.1-dev libwebkit2gtk-4.0-dev; do
    if apt-cache show "$candidate" >/dev/null 2>&1; then
      pkg="$candidate"
      break
    fi
  done
  echo "$pkg"
}

maybe_install() {
  local pkg="$1"
  if [ -z "$pkg" ]; then return 0; fi
  if apt-cache show "$pkg" >/dev/null 2>&1; then
    sudo apt-get install -y "$pkg"
  fi
}

ensure_universe() {
  if [ "${ID:-}" != "ubuntu" ]; then
    return 0
  fi
  if command -v add-apt-repository >/dev/null 2>&1; then
    sudo add-apt-repository -y universe >/dev/null 2>&1 || true
  else
    sudo apt-get install -y software-properties-common >/dev/null 2>&1 || true
    if command -v add-apt-repository >/dev/null 2>&1; then
      sudo add-apt-repository -y universe >/dev/null 2>&1 || true
    fi
  fi
}

echo "🔎 Resolving WebKit2GTK dev package…"
webkit_pkg="$(pick_webkit_pkg)"
if [ -z "$webkit_pkg" ]; then
  echo "ℹ️ WebKit2GTK dev package not found yet. Enabling Ubuntu 'universe' (if available) and re-checking…"
  ensure_universe
  sudo apt-get update
  webkit_pkg="$(pick_webkit_pkg)"
fi

if [ -z "$webkit_pkg" ]; then
  echo "❌ Could not find libwebkit2gtk dev package (tried 4.1 and 4.0)."
  echo "Try:"
  echo "- sudo apt-get update"
  echo "- On Ubuntu: enable 'universe' repository"
  echo "- Or check Tauri prerequisites for your distro:"
  echo "  https://tauri.app/v1/guides/getting-started/prerequisites/"
  exit 1
fi
echo "✅ Using: $webkit_pkg"

echo "📦 Installing system dependencies for Tauri builds…"
sudo apt-get update
sudo apt-get install -y \
  build-essential \
  curl \
  pkg-config \
  libssl-dev \
  libgtk-3-dev \
  "$webkit_pkg" \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  patchelf \
  ca-certificates

if [ "$webkit_pkg" = "libwebkit2gtk-4.0-dev" ]; then
  # WebKitGTK 4.0 stack (older distros): libsoup2 + javascriptcoregtk-4.0
  maybe_install libsoup2.4-dev
  maybe_install libjavascriptcoregtk-4.0-dev
else
  # WebKitGTK 4.1 stack (newer distros): libsoup3 + javascriptcoregtk-4.1
  maybe_install libsoup-3.0-dev
  maybe_install libjavascriptcoregtk-4.1-dev
fi

echo "✅ System dependencies installed."
echo "Next: run ./scripts/install-rust.sh"
