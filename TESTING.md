# Manual Testing

There is no automated test suite yet. After changing gameplay/AI/levels/rendering, run at least one smoke pass from this document.

---

## 0) Start the dev server (use a fixed port)

```bash
npm install
npm run dev -- --host --port 3002
```

---

## 1) Smoke test (5–10 minutes)

### 1.1 AI module import sanity

- Open: `http://localhost:3002/test-ai.html`
- Expect: console shows “All modules loaded successfully” (or equivalent success output)

### 1.2 Main bootstrap sanity

- Open: `http://localhost:3002/diagnostic.html`
- Click: `Test Main Game`
- Expect: `main.js loaded successfully` (or equivalent)

### 1.3 Main gameplay sanity

- Open: `http://localhost:3002/`
- Click: `Click to Start` (pointer lock)
- Expect:
  - Minimap is visible and **always shows the full map thumbnail**
  - HUD shows objective text and tool counts (fixed hotkeys)
  - Monsters spawn and move (far monsters should not “teleport”)
  - `M` toggles 3D world markers
  - Throw at least one tool (e.g. `8` smoke) and verify SFX + effect
  - No recurring console errors

---

## 2) Extra pages (as needed)

### 2.1 Enemy Lab (combat + meta save)

- Open: `http://localhost:3002/enemy-lab.html`
- Use cases:
  - test combat pacing and enemy ranged/melee behavior
  - tune and save `public/models/<enemy>/meta.json` (via dev server API)

### 2.2 Level Lab (levels/recipes iteration)

- Open: `http://localhost:3002/level-lab.html`
- Use cases:
  - validate `public/levels/*.json` and `public/level-recipes/*.json` behavior

---

## 3) When reporting issues, include

1. The page you used (`/`, `test-ai.html`, `diagnostic.html`, `enemy-lab.html`, `level-lab.html`)
2. Console errors and relevant logs (text or screenshots)
3. Browser + OS
4. Exact steps to reproduce
