# Game Design Document

This document describes gameplay from the **player perspective**: the core loop, objectives, tools, enemy pressure, and navigation UX. For code-level wiring (file paths, system order, event flows), see `docs/assistant/README.md`.

---

## Vision

A backrooms-like first-person procedural maze survival/objective prototype:

- Each level generates a new maze + room layout
- Levels define a mission list (objectives)
- Players complete objectives under monster pressure
- Required objectives unlock the exit (no “rush exit”)
- Endless progression with difficulty scaling

The repo includes an AI player (**Autopilot**) as a demo/testing harness: when the human player is idle, it can explore, solve objectives, fight, and use tools.

---

## Core loop

1. Generate a level (maze + rooms)
2. Show objectives on the HUD
3. Explore and manage resources (ammo/health/tools)
4. Handle enemy pressure (LOS, stealth/noise, tools, combat)
5. Complete required objectives
6. Unlock and reach the exit
7. Advance to the next level (difficulty increases)

---

## Player kit

### Movement & survival

- First-person movement (WASD + mouse)
- Sprint for speed (often increases noise)
- Block/guard (Right Click / `F`) reduces incoming damage, but uses stamina and has a “break” cooldown

### Combat

- Weapons: fire/reload/switch (1/2/3), optional mode toggle (`B`)
- Skills: grenade (`Q`), EMP (`X`)

### Tools

Tools exist to create “gameplay solutions” beyond pure gunplay: disengage, control space, misdirect, and scout.

- **Lure (device)**: pull monsters away to open a safe route
- **Trap (device)**: short stun to create distance
- **Jammer (device)**: reduce hearing/smell so monsters re-acquire less reliably
- **Sensor (device)**: early warning ping when monsters approach
- **Mine (device)**: area damage + noise (hold points or cover retreat)
- **Smoke (throwable)**: blocks LOS (break chase / reset pressure)
- **Flash (throwable)**: blinds/stuns (emergency save)
- **Decoy (throwable)**: loud noise + scent (strong misdirection)

---

## Objectives (missions)

Objectives are configured in `public/levels/*.json`. Design principles:

- **Composable**: templates can be mixed to create varied pacing
- **Gated**: required objectives lock the exit until completed
- **Strategy-forcing**: some objectives constrain behavior (e.g., “Stay Quiet” rewards stillness and tool-based control)

Examples of common objective flavors:

- Collect and deliver/upload (evidence, keycards, etc)
- Power restoration (fuses / panels)
- Sequence/lock puzzles (keypads, terminals)
- Stealth/hold objectives (stay quiet, hide for seconds, survive without damage)
- Combat objectives (kill count)

---

## Enemy pressure

Goals:

- Avoid a single “always chase” loop: different monster types should feel different
- Make tools materially change outcomes (smoke/flash/jammer/lure are not cosmetic)
- Avoid immersion-breaking movement: far-AI throttling reduces “thinking”, not movement application

Current monster types are data-driven in `src/ai/monsterTypes.js` (e.g. `HUNTER`, `WANDERER`, `SENTINEL`, `STALKER`, `RUSHER`, `WEEPING_ANGEL`, `GREETER`).

---

## UX and navigation

- **Minimap** always fits the entire map thumbnail (never cropped)
- **World markers** can be toggled with `M` to highlight nearby objectives/pickups/devices in 3D
- HUD emphasizes:
  - current objective + prompts
  - tool counts + fixed hotkeys
  - noise meter (so the player understands “how loud” they were)

---

## Difficulty and endless progression

Design intent:

- No upper limit on level count
- Difficulty increases with level index and can be tuned with performance scoring
- Variety (monster pools, tool drops, limits) should be driven by per-level JSON; systems include guardrails when configs are too narrow

---

## Revision history

| Date | Version | Notes |
|---|---|---|
| 2025-11-20 | v0.1 | Initial GDD draft |
