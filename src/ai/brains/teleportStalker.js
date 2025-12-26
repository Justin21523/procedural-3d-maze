import { BaseMonsterBrain } from './baseBrain.js';

/**
 * TeleportStalkerBrain
 * - Slowly wanders / chases the player.
 * - If player is very far and cooldown is ready, it teleports to a ring around the player.
 * - Teleport never puts it inside walls (walkability check).
 */
export class TeleportStalkerBrain extends BaseMonsterBrain {
  constructor(worldState, pathfinder, monster, playerRef, config = {}) {
    super(worldState, pathfinder, monster, playerRef, config);

    this.teleportCooldown =
      config.teleportCooldown ??
      12.0;

    this.lastTeleportTime = this.now();

    this.minTeleportDist =
      config.minTeleportDist ??
      3;

    this.maxTeleportDist =
      config.maxTeleportDist ??
      8;

    this.teleportTriggerDistance =
      config.teleportTriggerDistance ??
      18;

    this.chaseRange =
      config.chaseRange ??
      12;

    this.mode = 'wander'; // 'wander' | 'chase'
  }

  pickTeleportTargetAroundPlayer(playerGrid, monsterGrid) {
    const minD = this.minTeleportDist;
    const maxD = this.maxTeleportDist;
    const candidates = [];

    for (let r = minD; r <= maxD; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const dist = Math.abs(dx) + Math.abs(dy);
          if (dist < minD || dist > maxD) continue;

          const x = playerGrid.x + dx;
          const y = playerGrid.y + dy;

          if (!this.isWalkableTile(x, y)) continue;

          const dFromMonster = this.manhattan(monsterGrid, { x, y });
          if (dFromMonster < 2) continue; // avoid "fake" teleports

          candidates.push({ x, y });
        }
      }
    }

    if (candidates.length === 0) return null;
    const index = Math.floor(Math.random() * candidates.length);
    return candidates[index];
  }

  pickTarget(monsterGrid) {
    const playerGrid = this.getPlayerGridPosition();
    if (!playerGrid) {
      if (this.worldState && typeof this.worldState.findRandomWalkableTile === 'function') {
        return this.worldState.findRandomWalkableTile();
      }
      return monsterGrid;
    }

    const distToPlayer = this.manhattan(monsterGrid, playerGrid);
    if (distToPlayer <= this.chaseRange) {
      this.mode = 'chase';
      return playerGrid;
    }

    this.mode = 'wander';

    if (this.worldState && typeof this.worldState.findRandomWalkableTile === 'function') {
      let best = null;
      for (let i = 0; i < 40; i++) {
        const tile = this.worldState.findRandomWalkableTile();
        if (!tile) continue;

        const distToPlayerCandidate = this.manhattan(playerGrid, tile);
        const score = -distToPlayerCandidate;

        if (!best || score > best.score) {
          best = { x: tile.x, y: tile.y, score };
        }
      }
      if (best) return { x: best.x, y: best.y };
    }

    return playerGrid;
  }

  computeSprint(distToTarget, distToPlayer) {
    void distToTarget;
    if (!this.allowSprint) return false;
    if (this.mode === 'chase') {
      return distToPlayer > 4;
    }
    return false;
  }

  tick(deltaTime) {
    void deltaTime;

    if (!this.enabled || (this.monster && this.monster.isDead)) {
      return { move: { x: 0, y: 0 }, lookYaw: 0, sprint: false };
    }

    const monsterGrid = this.getMonsterGridPosition();
    this.recordVisit(monsterGrid);

    const playerGrid = this.getPlayerGridPosition();
    let specialAction = null;
    const now = this.now();

    if (playerGrid) {
      const distToPlayer = this.manhattan(monsterGrid, playerGrid);

      if (
        distToPlayer > this.teleportTriggerDistance &&
        now - this.lastTeleportTime >= this.teleportCooldown
      ) {
        const teleportTarget = this.pickTeleportTargetAroundPlayer(playerGrid, monsterGrid);
        if (teleportTarget) {
          this.setMonsterGridPosition(teleportTarget);
          this.currentPath = [];
          this.currentTarget = null;
          this.lastTeleportTime = now;
          specialAction = 'teleport';
        }
      }
    }

    const newGrid = this.getMonsterGridPosition();
    this.plan(newGrid);

    const { move, targetGrid } = this.stepAlongPath(newGrid);
    const lookYaw = this.computeLookYawToGrid(targetGrid);

    const distToTarget = this.currentTarget
      ? this.manhattan(newGrid, this.currentTarget)
      : Infinity;

    const distToPlayer = playerGrid
      ? this.manhattan(newGrid, playerGrid)
      : Infinity;

    const sprint = this.computeSprint(distToTarget, distToPlayer);

    return { move, lookYaw, sprint, specialAction };
  }
}

