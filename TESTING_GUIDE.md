# Testing Guide

This document provides a more complete manual testing checklist (useful after changing AI/tools/minimap/levels).

For the quick smoke test, see `TESTING.md`.

---

## 0) Start

```bash
npm install
npm run dev -- --host --port 3002
```

---

## 1) Required pages and expected results

### 1.1 `test-ai.html`: module import sanity

- Open: `http://localhost:3002/test-ai.html`
- Expect:
  - console logs show core modules loaded
  - final “All modules loaded successfully” (or equivalent)

### 1.2 `diagnostic.html`: bootstrap sanity

- Open: `http://localhost:3002/diagnostic.html`
- Click: `Test Main Game`
- Expect:
  - `main.js loaded successfully` (or equivalent)
  - on failure: stack trace shown (copy it into the issue)

### 1.3 `/`: main gameplay smoke + UX

- Open: `http://localhost:3002/`
- Click: `Click to Start` (pointer lock)
- Expect:
  - WASD movement + mouse look
  - HUD shows objective, HP, weapon/ammo, tool counts
  - Minimap is visible and always fits the entire map thumbnail
  - Monsters spawn and move (far monsters should not stutter/teleport)

---

## 2) Main game checklist (recommended)

### 2.1 Minimap (full-map thumbnail)

After changing the minimap size/layout:

- The map is **not cropped** (still the full map)
- Zoom only affects marker size (not map cropping)

### 2.2 World markers (3D)

- Press `M` to toggle
- Expect: nearby pickups / deployed devices / mission targets show 3D sprite markers

### 2.3 Tools

Perform each action at least once:

- Throwables: `7/8/9` (decoy/smoke/flash)
- Devices: `4/5/6/0/V` (lure/trap/jammer/sensor/mine)

Expect:

- Inventory counts decrease (HUD updates)
- Matching SFX plays (procedural)
- Effects influence enemy pressure (smoke breaks LOS, flash blinds, jammer weakens perception)

### 2.4 Missions / interactables

At mission objects, press `E`:

- Prompt appears only when looking at the target (raycast hover)
- If an item/condition is required, a clear “missing requirement” prompt appears
- The exit remains locked until required objectives are completed

### 2.5 Autopilot

In the settings panel (`Tab`):

- Enable Autopilot (if disabled)
- Set delay to `0` for immediate takeover (optional)

Then stop using keyboard/mouse:

- Expect: the character explores, solves objectives, fights/blocks, and uses tools strategically

---

## 3) Dedicated pages (as needed)

### 3.1 Enemy Lab

- Open: `http://localhost:3002/enemy-lab.html`
- Use cases:
  - test enemy ranged/melee pacing
  - tune and save enemy meta to `public/models/<enemy>/meta.json` (dev server required)

### 3.2 Test Enemy Meta

- Open: `http://localhost:3002/test-enemy-meta.html`
- Use cases:
  - tune model facing/scale/grounding and generate meta JSON

### 3.3 Level Lab

- Open: `http://localhost:3002/level-lab.html`
- Use cases:
  - validate `public/levels/*.json` and `public/level-recipes/*.json`

---

## 4) Build verification (before merging)

```bash
npm run build
```

Expect: build succeeds (outputs to `dist/`) with no module resolution errors.
