# Changelog

This file tracks major system changes and breaking changes (small bugfixes should be tracked by git commits).

Format reference: [Keep a Changelog](https://keepachangelog.com/)

Note: this repo does not strictly use release tags yet; the primary section is `[Unreleased]`.

---

## [Unreleased]

### Added

- Endless levels + difficulty scaling (`LevelDirector`): `src/core/levelDirector.js`
- Expanded mission system + required exit gating + Autopilot targets/state (`MissionDirector`): `src/core/missions/missionDirector.js`
- Wave spawns + tool drops + “variety protection” (`SpawnDirector`): `src/core/spawnDirector.js`
- Tools (deploy + throw) + tool pickups: `src/core/toolSystem.js`, `src/entities/pickupManager.js`
- Autopilot tool strategy (`PlayerToolAISystem`): `src/core/playerToolAISystem.js`
- Perception suite: noise/scent, smoke blocks LOS, flash blindness, jammer perception debuff: `src/entities/monsterManager/perception.js`
- Special monster: Weeping Angel brain: `src/ai/brains/weepingAngel.js`
- 3D world markers (`M` toggle): `src/rendering/worldMarkerSystem.js`
- Procedural SFX: tool throw/deploy/trigger + objective chime: `src/audio/audioManager.js`
- LLM/assistant handoff docs: `docs/assistant/*`

### Changed

- Minimap now always fits the full map thumbnail; zoom scales markers only; added base-layer caching: `src/rendering/minimap.js`
- Far monster throttling now throttles “thinking” but still applies movement every frame; added render culling: `src/entities/monsterManager.js`
- GameLoop now uses `SystemRegistry` to make update order explicit; added no-progress unstuck and melee global limiter: `src/core/gameLoop.js`

### Performance

- Renderer pixel ratio cap + shadows disabled: `src/rendering/scene.js`
- Hard caps for projectiles/effects + far tick intervals: `src/core/config.js`, `src/entities/projectileManager.js`
