# TODO (Feature Backlog)

This file tracks high-level feature work (not individual bug fixes).

Status markers:

- ✅ Completed
- 🚧 In progress
- ⬜ Planned
- 🔄 Needs refactor
- ❌ Cancelled

---

## ✅ Implemented (current state)

### Core loop

- ✅ Procedural maze generation (with room map)
- ✅ Multiple base levels (`public/levels/*.json`) + endless generation (recipes/dynamic)
- ✅ Mission system (MissionDirector) + exit gating (required objectives)

### Player kit

- ✅ Weapons: fire/reload/switch/mode + skills (Q/X)
- ✅ Block/guard with stamina and break cooldown
- ✅ Tools:
  - ✅ Devices: lure/trap/jammer/sensor/mine
  - ✅ Throwables: decoy/smoke/flash
  - ✅ HUD shows fixed hotkeys + counts

### AI

- ✅ AI player (Autopilot): objectives + anti-oscillation/unstuck + combat cadence
- ✅ Autopilot tool strategy (PlayerToolAISystem)
- ✅ Enemy AI: brains + modules (noise/tactics/squad)
- ✅ Perception: vision (FOV/LOS/smoke), hearing (noise), smell (scent)
- ✅ Special monster: Weeping Angel
- ✅ SpawnDirector: waves + “variety protection” (avoid single-type runs)

### UX / navigation / performance

- ✅ Minimap always fits the full map (zoom scales markers, not tiles)
- ✅ 3D world markers (`M` toggle): pickups/devices/objectives
- ✅ Performance safety: far-AI throttling, hard caps for projectiles/VFX, pixel ratio cap
- ✅ Procedural SFX: tool throw/deploy/trigger + objective chime

---

## 🚧 In progress (near-term)

- 🚧 Balance: monster counts/damage/vision, tool durations and drop weights, mission pacing
- 🚧 Content expansion: more recipes, more mission combinations, more “non-mission” encounters
- 🚧 Performance target: ~60 FPS on mid-tier machines (reduce draw calls + per-frame scanning)

---

## ⬜ Planned (mid/long-term)

- ⬜ More tool variants (strong/weak smoke/flash, deployable markers, more trap types)
- ⬜ More AI rules and monster types (noise-only, smell-only, stronger cover/occlusion rules, special triggers)
- ⬜ Tutorial/UX: onboarding and consistent hotkey prompts
- ⬜ Optional non-procedural audio assets (ambient/monster/weapon sounds)
- ⬜ Settings persistence (localStorage)

---

## References

- Doc registry/governance: `docs/README.md`
- Assistant hub: `docs/assistant/README.md`
