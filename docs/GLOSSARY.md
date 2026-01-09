# Glossary

This file defines canonical terms used across docs and code. Keep entries in **English**, and prefer the exact identifier names when pointing to runtime code.

---

## Gameplay & content

| Term | Meaning |
|---|---|
| Maze | The grid-based layout generated per level. |
| Tile / Cell | The fundamental unit in the maze grid. |
| Wall / Floor | Non-walkable vs walkable tiles. |
| Room / Room type | Higher-level areas inside the maze used for mission placement and theming. |
| Mission | A configured set of objectives that must be completed to unlock the exit. |
| Objective | The current mission step shown on the HUD. |
| Interactable | An object the player (or Autopilot) can interact with (usually with `E`). |
| Exit gating | The exit remains locked until required objectives are completed. |
| Pickup | A world item that can be collected (ammo/health/tools). |
| Inventory | The player’s item counters stored in `GameState`. |
| Tool | A consumable tactical resource (smoke, trap, etc). |
| Device | A deployed tool that persists in the world (lure/trap/jammer/sensor/mine). |
| Throwable | A tool thrown as a projectile (decoy/smoke/flash). |
| Endless levels | After base levels, level configs can be generated indefinitely with scaling. |
| Difficulty scaling | Level knobs that grow with level index and/or player performance. |

---

## AI & perception

| Term | Meaning |
|---|---|
| Autopilot | The AI player that takes over when the human player is idle. |
| Enemy AI | Monster decision-making logic (brains + perception + modules). |
| Brain | A per-monster behavior implementation that produces per-frame commands. |
| Monster type | A data-driven configuration for stats/combat/brain wiring. |
| Perception | The sensory model used by monsters: vision, hearing, smell. |
| FOV (Field of View) | An angular cone used for vision checks. |
| LOS (Line of Sight) | Whether a segment between two points is occluded by walls/obstacles. |
| Noise | A hearing event (footsteps, gunshots, tools, explosions). |
| Scent | A smell event (player trail “breadcrumbs”, lure/decoy scent). |
| Alert broadcast | A noise emitted by monsters when they see the player to help other monsters converge. |
| Blindness | A temporary perception debuff (e.g., caused by flash). |
| Jammed | A temporary perception debuff (e.g., caused by jammer). |
| Weeping Angel | A special monster rule: it freezes when the player is looking at it (FOV + LOS). |

---

## Rendering & UI

| Term | Meaning |
|---|---|
| Minimap | A 2D overview that always fits the entire map (no cropping). |
| World markers | Optional 3D sprites that highlight nearby objectives/pickups/devices. |
| Base layer cache | Minimap optimization: pre-render walls/floors to an offscreen canvas and only redraw markers each frame. |
| Culling | Hiding far-away objects (or throttling AI) to reduce CPU/GPU work. |

---

## Abbreviations

| Abbrev | Meaning |
|---|---|
| FPS | Frames per second. |
| FOV | Field of View. |
| LOS | Line of Sight. |
| HMR | Hot Module Replacement (Vite dev mode). |
| SSOT | Single Source of Truth (one canonical doc per topic). |
| AI | Artificial Intelligence. |
| A* | A* pathfinding algorithm. |
