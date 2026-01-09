# Assistant Instructions (Procedural 3D Maze / Three.js Prototype)

**Audience:** coding assistants (Claude / ChatGPT / Codex)  
**Scope:** a procedural first-person maze game prototype with missions, tools, Autopilot (AI player), and perception-driven enemy AI.

If you need an implementation-accurate map of the project, start with `docs/assistant/README.md`.

---

## Non-negotiable rules

1. **Single Source of Truth (SSOT)**
   - Update the canonical file for a topic; do not create variants like `*_v2.md`, `*_final.md`, `notes.md`, etc.
   - The doc registry is `docs/README.md`.

2. **No scratch docs/folders**
   - Don’t create `tmp/`, `scratch/`, `misc/`, `notes/`, or generic “draft” docs.
   - Keep diagnostic/test HTML pages at the repo root focused and stable.

3. **English-only docs**
   - All Markdown documentation is English-only.
   - Code, identifiers, filenames, and comments are English-only.

4. **Readable, modular code**
   - Prefer clear functions and small modules over “clever” one-liners.
   - Don’t couple AI/gameplay logic to the DOM. Emit events and let `UIManager` render UI.

5. **Conventional Commits**
   - Use `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.
   - Keep commits scoped to a single intent.

---

## Project structure (runtime)

- `src/` runtime code:
  - `core/`: config, game loop, level director, spawn director, tool system, inventory, events
  - `world/`: maze generation, collision, LOS, exit
  - `rendering/`: scene, camera, minimap, world markers
  - `entities/`: monsters, projectiles, pickups, model loading
  - `ai/`: Autopilot + monster brains + pathfinding + modules
  - `ui/`: HUD/prompts/results/input modes
  - `audio/`: AudioManager (procedural SFX)
- `public/` static assets:
  - `levels/` level JSON + manifest
  - `level-recipes/` optional endless recipes
  - `models/` models + `meta.json`

---

## Architectural guardrails

- **System order matters**: new per-frame systems must be registered in `src/core/gameLoop.js` with an explicit `order`.
- **Event-driven wiring**: event names are in `src/core/events.js`; prefer emitting events over direct cross-system coupling.
- **Content is JSON-driven**: per-level knobs live in `public/levels/*.json`; normalization/clamping lives in `src/core/levelDirector.js`.

---

## Validation expectations

There is no automated test suite yet.

- Run the smoke checklist in `TESTING.md`.
- For deeper checks, use `TESTING_GUIDE.md` and the dedicated pages (`/test-ai.html`, `/diagnostic.html`, `/enemy-lab.html`, `/level-lab.html`).
