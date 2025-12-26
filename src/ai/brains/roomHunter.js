import { CONFIG } from '../../core/config.js';
import { BaseMonsterBrain } from './baseBrain.js';
import { canSeePlayer } from '../components/perception/vision.js';
import { NoiseInvestigationModule } from '../components/perception/noiseInvestigation.js';
import { FlankCoverTactics } from '../components/tactics/flankCoverTactics.js';

/**
 * RoomHunterBrain
 * - Stays inside a home room/region and patrols.
 * - If player enters vision range & (optionally) line of sight, it chases.
 * - Loses interest after chaseTimeout without seeing the player, then returns home.
 */
export class RoomHunterBrain extends BaseMonsterBrain {
  constructor(worldState, pathfinder, monster, playerRef, config = {}) {
    super(worldState, pathfinder, monster, playerRef, config);

    const startGrid = this.getMonsterGridPosition();

    this.homeCenter =
      config.homeCenter ||
      monster.homeCenter ||
      { x: startGrid.x, y: startGrid.y };

    this.homeRadius =
      config.homeRadius ??
      monster.homeRadius ??
      7;

    this.visionRange =
      config.visionRange ??
      monster.visionRange ??
      12;

    this.chaseTimeout =
      config.chaseTimeout ??
      6.0;

    this.explorationSamples =
      config.explorationSamples ??
      CONFIG.AUTOPILOT_EXPLORE_SAMPLES ??
      80;

    this.state = 'patrol'; // 'patrol' | 'chase' | 'returning'
    this.targetType = 'patrol';
    this.lastSeenPlayerTime = 0;

    this.investigationModule = new NoiseInvestigationModule({
      enabled: config.investigateEnabled ?? true,
      noiseMemorySeconds: config.noiseMemorySeconds,
      investigateTime: config.investigateTime,
      searchRadius: config.searchRadius,
      visitTTL: this.visitTTL
    });

    this.tactics = new FlankCoverTactics(worldState, monster, config.tactics || {});
  }

  /**
   * Patrol target: exploration-style picking but restricted to home region
   */
  pickPatrolTarget(monsterGrid) {
    // Prefer explicit tiles if provided
    const tiles =
      this.config.homeTiles ||
      this.monster.homeTiles;

    const pickRandomHomeTile = () => {
      if (Array.isArray(tiles) && tiles.length > 0) {
        const t = tiles[Math.floor(Math.random() * tiles.length)];
        return { x: t.x, y: t.y };
      }

      if (!this.worldState || typeof this.worldState.findRandomWalkableTile !== 'function') {
        return { x: this.homeCenter.x, y: this.homeCenter.y };
      }

      for (let i = 0; i < 40; i++) {
        const tile = this.worldState.findRandomWalkableTile();
        if (!tile) continue;
        const d = this.manhattan(tile, this.homeCenter);
        if (d <= this.homeRadius) {
          return { x: tile.x, y: tile.y };
        }
      }

      return { x: this.homeCenter.x, y: this.homeCenter.y };
    };

    if (!this.worldState || typeof this.worldState.findRandomWalkableTile !== 'function') {
      return pickRandomHomeTile();
    }

    const now = Date.now();
    let best = null;

    for (let i = 0; i < this.explorationSamples; i++) {
      const tile = pickRandomHomeTile();
      if (!tile) continue;

      const dist = this.manhattan(monsterGrid, tile);
      const key = this.posKey(tile);
      const lastVisit = this.visitedTiles.get(key);

      let novelty = 2.0;
      if (lastVisit) {
        const age = now - lastVisit;
        novelty = Math.max(0, Math.min(1, age / this.visitTTL));
      }

      const score = dist * 0.8 + novelty * 20;
      if (!best || score > best.score) {
        best = { x: tile.x, y: tile.y, score };
      }
    }

    if (!best) {
      return pickRandomHomeTile();
    }
    return { x: best.x, y: best.y };
  }

  pickTarget(monsterGrid) {
    const playerGrid = this.getPlayerGridPosition();
    const now = this.now();

    const canSee = playerGrid
      ? canSeePlayer(this.worldState, monsterGrid, playerGrid, this.visionRange)
      : false;

    if (canSee && playerGrid) {
      this.lastSeenPlayerTime = now;
      this.state = 'chase';
      this.investigationModule.reset();
    } else if (this.state === 'chase') {
      const noise = this.lastHeardNoise;
      const noiseMemory = this.config.noiseMemorySeconds ?? (CONFIG.AI_NOISE_MEMORY ?? 2.0);
      if (noise && noise.grid && (now - (noise.heardAt || 0)) <= noiseMemory) {
        if ((noise.priority || 0) >= 2) {
          this.lastSeenPlayerTime = now;
        }
      }
      if (now - this.lastSeenPlayerTime > this.chaseTimeout) {
        this.state = 'returning';
        this.tactics.reset();
        this.investigationModule.reset();
      }
    }

    if (this.state === 'returning') {
      const distHome = this.manhattan(monsterGrid, this.homeCenter);
      if (distHome <= 1) {
        this.state = 'patrol';
      }
    }

    if (this.state === 'chase' && playerGrid) {
      if (canSee) {
        const tactic = this.tactics.tick({
          now,
          monsterGrid,
          playerGrid,
          isWalkableTile: (x, y) => this.isWalkableTile(x, y)
        });
        this.targetType = tactic.mode === 'cover' ? 'cover' : (tactic.mode === 'flank' ? 'flank' : 'chase');
        return tactic.targetGrid || playerGrid;
      }

      // Lost sight: investigate noises if available, otherwise go to last known player tile.
      const invTarget = this.investigationModule.tick({
        now,
        monsterGrid,
        lastHeardNoise: this.lastHeardNoise,
        isWalkableTile: (x, y) => this.isWalkableTile(x, y),
        visitedTiles: this.visitedTiles,
        posKey: (pos) => this.posKey(pos)
      });

      if (invTarget) {
        this.targetType = 'investigate';
        return invTarget;
      }

      this.targetType = 'chase';
      return playerGrid;
    }

    if (this.state === 'returning') {
      this.targetType = 'returning';
      return this.homeCenter;
    }

    this.state = 'patrol';
    this.targetType = 'patrol';
    return this.pickPatrolTarget(monsterGrid);
  }

  computeSprint(distToTarget, distToPlayer) {
    void distToTarget;
    if (!this.allowSprint) return false;
    if (this.targetType === 'chase' || this.targetType === 'flank' || this.targetType === 'investigate') {
      return distToPlayer > 3;
    }
    return false;
  }

  tick(deltaTime) {
    if (!this.enabled || (this.monster && this.monster.isDead)) {
      return { move: { x: 0, y: 0 }, lookYaw: 0, sprint: false };
    }

    const now = this.now();
    const monsterGrid = this.getMonsterGridPosition();
    const playerGrid = this.getPlayerGridPosition();

    const canSee = playerGrid
      ? canSeePlayer(this.worldState, monsterGrid, playerGrid, this.visionRange)
      : false;

    if (this.state === 'chase' && canSee && playerGrid) {
      const tactic = this.tactics.tick({
        now,
        monsterGrid,
        playerGrid,
        isWalkableTile: (x, y) => this.isWalkableTile(x, y)
      });
      if (tactic.holdPosition) {
        this.recordVisit(monsterGrid);
        return { move: { x: 0, y: 0 }, lookYaw: this.computeLookYawToPlayer(), sprint: false };
      }
    }

    return super.tick(deltaTime);
  }
}
