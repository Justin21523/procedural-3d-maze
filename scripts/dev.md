# Development Setup Guide

This document explains how to set up the dev environment, run the game locally, and use the project’s helper scripts.

---

## Requirements

- Node.js 18+
- npm 9+
- A modern browser with WebGL + Pointer Lock

---

## Quick start

From the repo root:

```bash
npm install
npm run dev -- --host --port 3002
```

Open: `http://localhost:3002/`

---

## Manual validation pages

When the dev server is running, these pages are useful for quick checks:

- Main game: `http://localhost:3002/`
- AI import sanity: `http://localhost:3002/test-ai.html`
- Bootstrap sanity: `http://localhost:3002/diagnostic.html`
- Enemy Lab: `http://localhost:3002/enemy-lab.html`
- Level Lab: `http://localhost:3002/level-lab.html`

See also: `TESTING.md` and `TESTING_GUIDE.md`.

---

## Common npm scripts

### Production build

```bash
npm run build
```

- Output goes to `dist/`

### Preview the build

```bash
npm run preview
```

### Level JSON helpers

Level configs are stored in `public/levels/*.json` and tracked by `public/levels/manifest.json`.

```bash
# Validate all levels referenced by the manifest
npm run levels:validate

# Create a new level from the template (auto-updates the manifest, then validates)
npm run levels:new -- <slug> --name "L12 - My Level"

# Keep the manifest sorted/deduped (also reports missing/invalid files)
npm run levels:sync
```

### Model pipeline helpers

After adding/removing files under `public/models/`:

```bash
npm run models:sync
npm run models:sync:all
```

---

## Troubleshooting

### Pointer lock issues

- Make sure you clicked the game canvas (“Click to Start”).
- If the browser blocks pointer lock, check the DevTools console for the error.

### Low FPS

- Reduce monster counts (`public/levels/*.json` → `monsters.count/maxCount`).
- Reduce maze size (`public/levels/*.json` → `maze.width/maze.height`).
- Enable `CONFIG.LOW_PERF_MODE` in `src/core/config.js`.
