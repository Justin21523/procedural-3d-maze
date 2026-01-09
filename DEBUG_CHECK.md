# Troubleshooting: Exit/Monsters Not Visible in 3D

If you can see entities on the minimap but not in the 3D view, this checklist helps determine whether the problem is rendering, placement, or visibility.

This file is intentionally narrow. For the full implementation map, see `docs/assistant/README.md`.

---

## 1) Quick reproduction

1. Run: `npm run dev -- --host --port 3002`
2. Open: `http://localhost:3002/`
3. Click: `Click to Start`

---

## 2) Check the scene contents in DevTools

The project exposes helper functions in `src/main.js`:

```js
debugScene();
debugMonsters();
```

Expect:

- `debugScene()` prints a non-trivial scene child count
- `debugMonsters()` shows a non-zero monster count when monsters have spawned

If the arrays are empty, the issue is likely spawning/initialization (not rendering).

---

## 3) Check exit placement

Exit mesh creation: `src/world/exitPoint.js`

Things to verify in code or logs:

- Exit ring/glow are positioned at a visible height (the portal visuals are at `y ≈ 1.5`)
- The group is added to the Three.js scene

---

## 4) Check monster placement

Monster entity: `src/entities/monster.js`  
Monster manager: `src/entities/monsterManager.js`

Things to verify:

- Model scale is sensible (see `src/ai/monsterTypes.js:stats.scale` and `public/models/<enemy>/meta.json`)
- Grounding offset is sensible (default fallback is small, e.g. `0.02`)
- Monsters aren’t being culled due to distance (see `CONFIG.MONSTER_RENDER_CULL_DISTANCE_TILES`)

---

## 5) If you still can’t see them

Collect:

1. Console output from `debugScene()` and `debugMonsters()`
2. Any errors during model loading (DevTools console)
3. Browser + OS
4. Repro steps and the level you were on (base level vs endless)
