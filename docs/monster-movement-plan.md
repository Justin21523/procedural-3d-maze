# Monster Movement Improvement Plan (Working Notes)

This is a scratchpad for movement quality and “unstuck” strategies.

---

## Improve path quality

- **Dynamic avoidance**: add lightweight steering in `MonsterManager.applyBrainCommand` to avoid nearby monsters/player/props, reducing head-on jams.
- **Path retry strategy**: when `Pathfinding` fails, quickly try 2–3 candidate fallback targets (e.g., nearby room centers) before giving up.
- **Wider-body planning**: inflate obstacles on the grid (or allow limited diagonal smoothing) to reduce corner-sticking and wall scraping.

---

## Stronger stuck detection and self-recovery

- Add “no distance-to-target change + speed < ε” detection; after ~0.7–1.0s, clear path, pick a new room-center target, and increase nudge distance.
- Temporary avoid zones: if stuck on a tile, temporarily mark that tile and its neighbors as avoided, then replan to avoid returning to the same trap.
- Doorway prioritization: when two monsters compete for a doorway, grant short-lived priority to one and force the other to yield briefly.

---

## Proposed implementation order (internal)

1. Command-layer dynamic avoidance + smoothing knobs.
2. Pathfinding retry + room-center fallback targets.
3. New stuck detector (speed + distance) + temporary avoid zones + doorway priority.
