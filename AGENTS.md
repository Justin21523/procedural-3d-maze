# Repository Guidelines

## Project Structure & Module Organization
- `src/` holds all runtime code: `core/` (config, loop, state), `rendering/` (scene, camera, minimap), `world/` (maze grid, exit), `entities/` (monsters, AI wiring), `player/` (input, controller), `audio/` (AudioManager), `utils/` (helpers). `main.js` wires systems together.
- `public/` contains static assets served by Vite (audio, models); keep paths absolute from `/`.
- `assets/` and `screenshots/` store reference media for docs; keep heavy files out of git where possible.
- Diagnostic pages (`diagnostic.html`, `test-ai.html`, `test-*.html`) live in the repo root for manual checks; leave them untouched when changing gameplay UI.

## Build, Test, and Development Commands
- Install deps once: `npm install`.
- Start dev server: `npm run dev` (use `--host --port 3002` to match testing docs). Serves `index.html` plus test pages.
- Production build: `npm run build` (outputs to `dist/`).
- Preview built assets: `npm run preview` (serves the `dist/` build locally).

## Coding Style & Naming Conventions
- ES modules with Three.js; prefer `const`/`let`, 2-space indentation, and semicolons (match existing files).
- Classes and exported types use `PascalCase`; instances and functions use `camelCase`; config constants live in `CONFIG` (`src/core/config.js`).
- Keep rendering/gameplay logic modular: mutate state in `world/` or `core/`, draw in `rendering/`, and avoid coupling AI to DOM.
- Log with concise, structured messages (existing emoji tags are fine for clarity).

## Testing Guidelines
- No automated test suite yet; run manual checks documented in `TESTING.md`.
- For AI import sanity: open `http://localhost:3002/test-ai.html` while dev server runs; expect green “All modules loaded successfully” logs.
- For game boot validation: open `diagnostic.html` and press “Test Main Game” to confirm `main.js` loads.
- For gameplay sanity: open `/` and verify console logs for monster spawning, minimap render, and pointer lock behavior. Capture console output when reporting issues.

## Commit & Pull Request Guidelines
- Follow the existing history: `feat:`, `fix:`, `docs:` prefixes and imperative summaries (e.g., `feat: improve monster patrol timing`). Keep scopes small; avoid mixing refactors with gameplay changes.
- PRs should describe intent, key files touched, and user-facing impact. Link issues when present and include before/after screenshots for visual changes.
- List the manual test pages you exercised (`test-ai.html`, `diagnostic.html`, main game) and any deviations (e.g., reduced `CONFIG.MONSTER_COUNT` for performance).
