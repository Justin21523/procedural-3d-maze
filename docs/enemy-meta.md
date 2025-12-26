# Enemy Model Metadata (`meta.json`)

Each enemy model folder under `public/models/<enemy>/` can include an optional `meta.json` to normalize:
- Model scale (so every model feels ~1:1 in-world)
- Upright orientation / axis correction
- Ground offset (so feet touch the floor)
- Optional gameplay overrides (health, hit radius, ranged combat tuning, brain/modules)

This lets you add new models by adding data, without touching runtime code.

## Location

- `public/models/<enemy>/meta.json`

Example:

```json
{
  "scaleMultiplier": 1.0,
  "groundOffset": 0.02
}
```

## Supported Fields

### Top-level

- `aiType` (string): override which brain to use (`hunter`, `roomHunter`, `autopilotWanderer`, `distanceStalker`, `speedJitter`, `teleportStalker`, `greeter`, …).
- `scaleMultiplier` (number): multiplies the selected monster type’s `stats.scale`.
- `groundOffset` (number): vertical offset so the model sits on the floor (meters-ish units).
- `hitRadius` (number): bullet collision radius override.
- `correctionOffset` (object, optional): `{x,y,z}` offset (world units) applied to `__monsterInner.position` (useful to recenter models that “orbit” when turning).
- `correctionRotationDeg` (object, optional): `{x,y,z}` in degrees, applied after the loader’s auto-upright.
- `correctionRotationRad` (object, optional): `{x,y,z}` in radians (alternative to degrees).

If you omit `correctionRotation*`, the loader’s auto-upright result is used as-is.
If you only want to fix “forward direction”, you can set only `y` and omit `x/z` so the auto-upright tilt is preserved.

### `stats` (shallow merge into monster type stats)

Common:
- `health` (number)
- `scale` (number)
- `speedFactor` (number)
- `visionRange` (number)
- `visionFOV` (number in radians)
- `hearingRange` (number)
- `groundOffset` (number)
- `hitRadius` (number)

### `combat` (shallow merge into monster type combat)

Common:
- `contactDamage` (number)
- `hitStunSeconds` (number)
- `deathDelay` (number)
- `deathExplosionRadius` (number)
- `deathExplosionDamage` (number)

Nested:
- `combat.ranged` (object): ranged tuning for bolt/projectile attacks.

#### `combat.ranged` (validated + best-effort clamped)

Typical fields:
- `enabled` (boolean)
- `kind` (string, e.g. `"bolt"`)
- `range` / `minRange` (numbers, in world units)
- `damage` (number)
- `cooldown` or `shotInterval` (seconds between shots)
- `fireChance` (0..1)
- `spread` (0..1)

Rhythm fields (reduce “endless spam” + improve FPS):
- `magSize` (integer)
- `reloadSeconds` (seconds)
- `burstMin` / `burstMax` (shots per burst)
- `burstRestSeconds` (seconds between bursts)
- `fireAlignDeg` (required yaw alignment before firing)
- `turnSpeed` (rad/s)

### `brain` (merged into MonsterManager brainConfig)

This is for brain/modules wiring (tactics, squad coordination, etc).

Examples:

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

## Notes

- `meta.json` values are sanitized at runtime: invalid types are ignored and numeric values are clamped to safe ranges.
- Use `enemy-lab.html` for first-person testing + live tuning (and saving via dev server).
- Use `test-enemy-meta.html` for a lightweight transform preview (scale/upright/groundOffset).

### Saving (dev server)

When running with Vite dev server, `enemy-lab.html` can save directly to disk:

- `POST /api/enemy-meta` with `{ modelPath: "/models/...", meta: {...} }`
- Writes to:
  - Folder models: `public/models/<folder>/meta.json`
  - Top-level models: `public/models/<file>.meta.json`

### Model Pipeline Automation

After adding/removing files under `public/models/`, you can regenerate the manifest and create missing meta stubs:

- `npm run models:sync` (folder `meta.json` stubs only)
- `npm run models:sync:all` (also creates root `*.meta.json` stubs)
