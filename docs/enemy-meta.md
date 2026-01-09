# Enemy Model Metadata (`meta.json`)

This document describes how to use `public/models/<enemy>/meta.json` to tune enemy model transforms (scale, grounding, facing) and optionally override some gameplay knobs (AI/combat/stats), so you can add/tune models without changing runtime code.

---

## Location

- `public/models/<enemy>/meta.json`

Example:

```json
{
  "scaleMultiplier": 1.0,
  "groundOffset": 0.02
}
```

---

## Supported fields

### 1) Top-level

- `aiType` (string): override which brain to use (e.g. `hunter`, `roomHunter`, `autopilotWanderer`, `distanceStalker`, `speedJitter`, `teleportStalker`, `greeter`, `weepingAngel`…).
- `scaleMultiplier` (number): multiplied with monster type `stats.scale` to keep different models visually consistent.
- `groundOffset` (number): vertical offset to “plant feet on the floor”.
- `hitRadius` (number): bullet hit radius override.
- `correctionOffset` (object, optional): `{x,y,z}` offset applied to recenter the model (prevents odd pivoting).
- `correctionRotationDeg` (object, optional): `{x,y,z}` degrees, for fixing upright/forward.
- `correctionRotationRad` (object, optional): `{x,y,z}` radians, same intent as the degree version.

Notes:

- If no correction rotation is provided, the loader’s auto-upright result is used.
- If you only need to fix “forward”, usually adjust `y` and keep `x/z` unchanged.

### 2) `stats` (shallow-merged into monster type stats)

Common fields:

- `health` (number)
- `scale` (number)
- `speedFactor` (number)
- `visionRange` (number)
- `visionFOV` (number, radians)
- `hearingRange` (number)
- `hitRadius` (number)

### 3) `combat` (shallow-merged into monster type combat)

Common fields:

- `contactDamage` (number)
- `hitStunSeconds` (number)
- `deathDelay` (number)
- `deathExplosionRadius` (number)
- `deathExplosionDamage` (number)

Nested:

- `combat.ranged`: ranged tuning (validated + best-effort clamped)

#### `combat.ranged` (cadence and performance live here)

Common fields:

- `enabled` (boolean)
- `kind` (string, e.g. `"bolt"`)
- `range` / `minRange` (number)
- `damage` (number)
- `cooldown` or `shotInterval` (seconds)
- `fireChance` (0..1)
- `spread` (0..1)

Cadence fields (reduce spam / avoid FPS collapse):

- `magSize` (integer)
- `reloadSeconds` (seconds)
- `burstMin` / `burstMax` (shots per burst)
- `burstRestSeconds` (seconds)
- `fireAlignDeg` (required yaw alignment before firing)
- `turnSpeed` (rad/s)

### 4) `brain` (merged into MonsterManager brainConfig)

Used for brain/modules wiring:

```json
{
  "brain": {
    "modules": {
      "squadCoordination": true,
      "noiseInvestigation": true,
      "flankCoverTactics": true
    }
  }
}
```

---

## Important notes

- `meta.json` is sanitized at runtime: invalid types are ignored and numeric values are clamped to safe ranges.
- Recommended tuning pages:
  - `enemy-lab.html`: first-person testing + live tuning (can save)
  - `test-enemy-meta.html`: lightweight transform preview (scale/upright/groundOffset)

---

## Saving meta via the dev server

When running Vite dev server (`npm run dev`), `enemy-lab.html` can write to disk:

- `POST /api/enemy-meta` with `{ modelPath: "/models/...", meta: {...} }`
- Writes to:
  - Folder models: `public/models/<folder>/meta.json`
  - Root models: `public/models/<file>.meta.json`

---

## Model pipeline automation

After adding/removing files under `public/models/`, you can regenerate manifests / meta stubs:

- `npm run models:sync` (folder `meta.json` only)
- `npm run models:sync:all` (also generates root `*.meta.json`)
