import { CONFIG } from '../../core/config.js';
import { BaseMonsterBrain } from './baseBrain.js';
import { canSeePlayer } from '../components/perception/vision.js';
import { NoiseInvestigationModule } from '../components/perception/noiseInvestigation.js';
import { InvestigateModule } from '../components/perception/investigate.js';
import { FlankCoverTactics } from '../components/tactics/flankCoverTactics.js';
import { SearchModule } from '../components/perception/search.js';

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

    this.chaseCooldownSeconds =
      config.chaseCooldownSeconds ??
      (CONFIG.AI_CHASE_COOLDOWN_SECONDS ?? 6.0);

    this.investigateTimeSeconds =
      config.investigateTimeSeconds ??
      (CONFIG.AI_INVESTIGATE_TIME ?? 6.0);

    this.investigatePauseSeconds =
      config.investigatePauseSeconds ??
      (CONFIG.AI_INVESTIGATE_PAUSE_SECONDS ?? 0.45);

    this.searchRadius =
      config.searchRadius ??
      (CONFIG.AI_SEARCH_RADIUS ?? 4);

    this.searchDurationSeconds =
      config.searchDurationSeconds ??
      (CONFIG.AI_SEARCH_SECONDS ?? 7.0);

    this.interceptEnabled =
      config.interceptEnabled ??
      true;

    this.interceptLookahead =
      config.interceptLookahead ??
      (CONFIG.AI_INTERCEPT_LOOKAHEAD_TILES ?? 6);

    this.basePlanInterval = this.planInterval;
    this.chasePlanInterval =
      config.chasePlanInterval ??
      (CONFIG.AI_CHASE_REPLAN_INTERVAL ?? Math.min(this.basePlanInterval || 0.7, 0.45));

    this.explorationSamples =
      config.explorationSamples ??
      CONFIG.AUTOPILOT_EXPLORE_SAMPLES ??
      80;

    // FSM: patrol -> investigate -> chase -> search -> return
    this.state = 'patrol'; // 'patrol' | 'investigate' | 'chase' | 'search' | 'return'
    this.targetType = 'patrol';
    this.lastSeenPlayerTime = 0;
    this.lastSeenPlayerGrid = null;
    this.lastKnownPlayerGrid = null;
    this.lastKnownPlayerTime = 0;
    this.lostSearch = null;
    this.stateLockUntil = 0;
    this.chaseCooldownUntil = 0;
    this.searchUntil = 0;
    this.searchOriginGrid = null;
    this.searchRequireArrival = false;
    this.searchStartedAt = 0;
    this.searchSweepBaseDir = null;
    this.investigateModule = new InvestigateModule({
      enabled: config.investigateEnabled ?? true,
      durationSeconds: this.investigateTimeSeconds,
      pauseSeconds: this.investigatePauseSeconds
    });

    // Memory/confidence
    this.targetConfidence = 0;

    // Track player movement (used for intercept guesses).
    this.lastTrackedPlayerGrid = null;
    this.lastTrackedPlayerDir = { x: 0, y: 0 };
    this.lastTrackedPlayerMoveAt = 0;
    this.lastSeenMoveDir = null;
    this.playerTrail = [];

    this.investigationModule = new NoiseInvestigationModule({
      enabled: config.investigateEnabled ?? true,
      noiseMemorySeconds: config.noiseMemorySeconds,
      investigateTime: config.investigateTime,
      searchRadius: config.searchRadius,
      visitTTL: this.visitTTL
    });

    this.tactics = new FlankCoverTactics(worldState, monster, config.tactics || {});

    this.searchModule = new SearchModule({
      enabled: true,
      radius: this.searchRadius,
      repickSeconds: 1.05,
      visitTTL: this.visitTTL
    });
  }

  clamp01(v) {
    return Math.max(0, Math.min(1, Number(v) || 0));
  }

  lockState(now, seconds) {
    const t = Number.isFinite(now) ? now : this.now();
    const s = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
    this.stateLockUntil = Math.max(this.stateLockUntil || 0, t + s);
  }

  updateLastKnown(grid, now) {
    if (!grid || !Number.isFinite(grid.x) || !Number.isFinite(grid.y)) return;
    this.lastKnownPlayerGrid = { x: grid.x, y: grid.y };
    this.lastKnownPlayerTime = Number.isFinite(now) ? now : this.now();
    this.lostSearch = null;
    this.searchModule?.reset?.();
  }

  hasRecentNoise(now) {
    const noise = this.lastHeardNoise;
    if (!noise?.grid) return false;
    const memory = this.config.noiseMemorySeconds ?? (CONFIG.AI_NOISE_MEMORY ?? 2.0);
    return now - (noise.heardAt || 0) <= memory;
  }

  hasRecentScent(now) {
    const scent = this.lastSmelledScent;
    if (!scent?.grid) return false;
    const memory = this.config.scentMemorySeconds ?? (CONFIG.AI_SCENT_MEMORY ?? 8.0);
    if (now - (scent.smelledAt || 0) > memory) return false;
    const intensity = Number.isFinite(scent.intensity) ? scent.intensity : (Number.isFinite(scent.strength) ? scent.strength : 0);
    return intensity > 0.05;
  }

  trackPlayerMovement(playerGrid, now) {
    if (!playerGrid) return;
    const last = this.lastTrackedPlayerGrid;
    if (last && (playerGrid.x !== last.x || playerGrid.y !== last.y)) {
      const dx = playerGrid.x - last.x;
      const dy = playerGrid.y - last.y;
      const man = Math.abs(dx) + Math.abs(dy);
      if (man > 0) {
        this.lastTrackedPlayerDir = { x: Math.sign(dx), y: Math.sign(dy) };
        this.lastTrackedPlayerMoveAt = Number.isFinite(now) ? now : this.now();
      }
    }
    this.lastTrackedPlayerGrid = { x: playerGrid.x, y: playerGrid.y };

    // Keep a short trail for simple trajectory prediction.
    const t = Number.isFinite(now) ? now : this.now();
    const trail = this.playerTrail || [];
    const lastEntry = trail.length > 0 ? trail[trail.length - 1] : null;
    if (!lastEntry || lastEntry.x !== playerGrid.x || lastEntry.y !== playerGrid.y) {
      trail.push({ x: playerGrid.x, y: playerGrid.y, t });
      while (trail.length > 6) trail.shift();
      // Drop very old samples.
      while (trail.length > 2 && t - trail[0].t > 2.5) trail.shift();
      this.playerTrail = trail;
    }
  }

  getTrailDir() {
    const trail = this.playerTrail || [];
    if (trail.length < 2) return this.lastTrackedPlayerDir || { x: 0, y: 0 };
    const a = trail[0];
    const b = trail[trail.length - 1];
    const dx = Math.sign(b.x - a.x);
    const dy = Math.sign(b.y - a.y);
    if (dx === 0 && dy === 0) return this.lastTrackedPlayerDir || { x: 0, y: 0 };
    return { x: dx, y: dy };
  }

  countWalkableNeighbors(x, y) {
    let count = 0;
    if (this.isWalkableTile(x + 1, y)) count++;
    if (this.isWalkableTile(x - 1, y)) count++;
    if (this.isWalkableTile(x, y + 1)) count++;
    if (this.isWalkableTile(x, y - 1)) count++;
    return count;
  }

  isJunctionTile(x, y) {
    return this.countWalkableNeighbors(x, y) >= 3;
  }

  buildSearchQueue(originGrid, radius) {
    const origin = originGrid || null;
    if (!origin) return [];
    const r = Math.max(1, Math.min(10, Math.round(Number(radius) || 4)));
    const candidates = [];

    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const dist = Math.abs(dx) + Math.abs(dy);
        if (dist <= 0 || dist > r) continue;
        const x = origin.x + dx;
        const y = origin.y + dy;
        if (!this.isWalkableTile(x, y)) continue;
        const degree = this.countWalkableNeighbors(x, y);
        const isJunction = degree >= 3;
        candidates.push({ x, y, dist, degree, isJunction });
      }
    }

    // Prefer junctions, then farther tiles (reduces "dead-end dithering").
    candidates.sort((a, b) => {
      if (a.isJunction !== b.isJunction) return a.isJunction ? -1 : 1;
      if (a.degree !== b.degree) return b.degree - a.degree;
      return b.dist - a.dist;
    });

    return candidates.map((c) => ({ x: c.x, y: c.y }));
  }

  beginSearch(originGrid, now, options = {}) {
    if (!originGrid) return;
    const t = Number.isFinite(now) ? now : this.now();
    const radius = Math.max(1, Math.round(Number(options.radius ?? this.searchRadius) || 4));
    const preferredDir = options.preferredDir ?? this.lastSeenMoveDir ?? this.lastTrackedPlayerDir ?? null;
    this.searchModule?.begin?.(originGrid, { radius, preferredDir });
    this.searchOriginGrid = { x: originGrid.x, y: originGrid.y };
    this.searchRequireArrival = options.requireArrival !== false;
    this.searchStartedAt = t;
    this.searchSweepBaseDir = preferredDir ? { x: Number(preferredDir.x) || 0, y: Number(preferredDir.y) || 0 } : null;
    this.searchUntil = Math.max(this.searchUntil || 0, t + Math.max(0.5, Number(options.durationSeconds ?? this.searchDurationSeconds) || 7.0));
  }

  getSearchSweepDir(now) {
    const base = this.searchSweepBaseDir || this.lastSeenMoveDir || this.lastTrackedPlayerDir || null;
    if (!base) return null;
    const dx = Math.sign(Number(base.x) || 0);
    const dy = Math.sign(Number(base.y) || 0);
    if (dx === 0 && dy === 0) return null;
    const elapsed = Math.max(0, now - (this.searchStartedAt || now));
    if (elapsed < 1.2) return { x: dx, y: dy };
    if (elapsed < 2.4) return { x: -dy, y: dx }; // rotate left
    if (elapsed < 3.6) return { x: dy, y: -dx }; // rotate right
    return { x: -dx, y: -dy }; // opposite
  }

  tickSearch(monsterGrid, now) {
    return this.searchModule?.tick?.({
      now,
      monsterGrid,
      originGrid: this.searchModule?.plan?.originGrid || null,
      preferredDir: this.getSearchSweepDir(now) || this.searchModule?.plan?.preferredDir || this.lastSeenMoveDir || this.lastTrackedPlayerDir || null,
      radius: this.searchRadius,
      isWalkableTile: (x, y) => this.isWalkableTile(x, y),
      visitedTiles: this.visitedTiles,
      posKey: (pos) => this.posKey(pos)
    }) ?? null;
  }

  pickInterceptTarget(monsterGrid, anchorGrid, now) {
    if (!this.interceptEnabled) return null;
    if (!monsterGrid || !anchorGrid) return null;
    const lastMoveAt = Number(this.lastTrackedPlayerMoveAt) || 0;
    if (now - lastMoveAt > 1.25) return null;

    const dir = this.getTrailDir();
    const dx = Number(dir.x) || 0;
    const dy = Number(dir.y) || 0;
    if (dx === 0 && dy === 0) return null;

    const maxLook = Math.max(2, Math.min(10, Math.round(Number(this.interceptLookahead) || 6)));
    const id = Number(this.monster?.id);
    const bias = Number.isFinite(id) ? (Math.abs(Math.round(id)) % 3) : 0;
    let best = null;
    for (let i = 2 + bias; i <= maxLook; i++) {
      const x = anchorGrid.x + dx * i;
      const y = anchorGrid.y + dy * i;
      if (!this.isWalkableTile(x, y)) break;
      const isJunction = this.isJunctionTile(x, y);
      const score = (isJunction ? 100 : 0) - this.manhattan(monsterGrid, { x, y }) * 0.5 + i * 0.25;
      if (!best || score > best.score) best = { x, y, score };
      if (isJunction) break;
    }

    // If we didn't find a clear "ahead" junction by marching, try nearby junctions around the anchor.
    // This helps when the player turns just before a branch and the last direction becomes stale.
    if ((!best || best.score < 40) && this.pathfinder?.findPath) {
      const radius = Math.min(12, Math.max(4, maxLook + 4));
      const candidates = [];
      for (let oy = -radius; oy <= radius; oy++) {
        for (let ox = -radius; ox <= radius; ox++) {
          const man = Math.abs(ox) + Math.abs(oy);
          if (man < 2 || man > radius) continue;
          const x = anchorGrid.x + ox;
          const y = anchorGrid.y + oy;
          if (!this.isWalkableTile(x, y)) continue;
          if (!this.isJunctionTile(x, y)) continue;

          // Prefer tiles that are roughly "ahead" of the last observed movement.
          const dot = ox * dx + oy * dy;
          if (dot <= 0) continue;

          const path = this.pathfinder.findPath(anchorGrid, { x, y }, true, null) || [];
          const anchorDist = Array.isArray(path) && path.length > 0 ? Math.max(0, path.length - 1) : Infinity;
          if (!Number.isFinite(anchorDist) || anchorDist > radius) continue;

          const distMonster = this.manhattan(monsterGrid, { x, y });
          const jitter = ((Number.isFinite(id) ? (id % 7) : 0) - 3) * 0.03;
          const score =
            120 +                         // junction bonus
            dot * 0.25 +                  // more "ahead" is better
            -Math.abs(anchorDist - 4) * 4 + // prefer junction a few steps away from anchor
            -distMonster * 0.65 +
            jitter + Math.random() * 0.5;
          candidates.push({ x, y, score });
        }
      }

      if (candidates.length > 0) {
        candidates.sort((a, b) => b.score - a.score);
        const pick = candidates[0];
        best = pick;
      }
    }

    if (!best) return null;

    // Prefer "junction exit" (one step further in predicted direction), so intercepts feel like cut-offs.
    const exit = { x: best.x + dx, y: best.y + dy };
    if (this.isWalkableTile(exit.x, exit.y)) {
      return exit;
    }

    // Fallback: pick a neighboring walkable tile that continues "ahead" best.
    const neighbors = [
      { x: best.x + 1, y: best.y },
      { x: best.x - 1, y: best.y },
      { x: best.x, y: best.y + 1 },
      { x: best.x, y: best.y - 1 }
    ];
    let bestExit = null;
    for (const n of neighbors) {
      if (!this.isWalkableTile(n.x, n.y)) continue;
      const ox = n.x - best.x;
      const oy = n.y - best.y;
      const dot = ox * dx + oy * dy;
      if (dot <= 0) continue;
      const score = dot * 10 - this.manhattan(monsterGrid, n) * 0.25;
      if (!bestExit || score > bestExit.score) bestExit = { x: n.x, y: n.y, score };
    }
    return bestExit ? { x: bestExit.x, y: bestExit.y } : { x: best.x, y: best.y };
  }

  tickLostSearch(now, monsterGrid) {
    const inv = this.lostSearch;
    if (!inv?.originGrid || !monsterGrid) return null;
    if (now > inv.until) {
      this.lostSearch = null;
      return null;
    }

    const origin = inv.originGrid;
    const distToTarget = inv.targetGrid ? this.manhattan(monsterGrid, inv.targetGrid) : Infinity;
    if (!inv.targetGrid || distToTarget <= 1 || now >= (inv.nextPickTime || 0)) {
      inv.targetGrid = this.pickLocalSearchTarget(monsterGrid, origin, inv.searchRadius || 4);
      inv.nextPickTime = now + 1.2;
    }
    return inv.targetGrid || origin;
  }

  pickLocalSearchTarget(monsterGrid, originGrid, radius) {
    if (!originGrid || !monsterGrid) return originGrid;
    if (typeof this.isWalkableTile !== 'function') return originGrid;

    const r = Math.max(1, Math.min(8, Math.round(Number(radius) || 4)));
    const nowMs = Date.now();
    let best = null;

    for (let i = 0; i < 18; i++) {
      const dx = Math.floor((Math.random() * 2 - 1) * r);
      const dy = Math.floor((Math.random() * 2 - 1) * r);
      const x = originGrid.x + dx;
      const y = originGrid.y + dy;
      if (!this.isWalkableTile(x, y)) continue;

      const dist = this.manhattan(monsterGrid, { x, y });

      let novelty = 1.0;
      const key = this.posKey({ x, y });
      const lastVisit = this.visitedTiles.get(key);
      if (lastVisit) {
        const age = nowMs - lastVisit;
        novelty = Math.max(0, Math.min(1, age / (this.visitTTL || 45_000)));
      }

      const score = dist * 1.1 + novelty * 14 + Math.random() * 2;
      if (!best || score > best.score) {
        best = { x, y, score };
      }
    }

    return best ? { x: best.x, y: best.y } : { x: originGrid.x, y: originGrid.y };
  }

  /**
   * Patrol target: exploration-style picking but restricted to home region
   */
  pickPatrolTarget(monsterGrid) {
    const patrol = this.pickPatrolWaypoint(monsterGrid, { advanceOnDist: 1 });
    if (patrol) return patrol;

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

    const yaw = this.monster?.getYaw?.() ?? this.monster?.yaw;
    const visionFOV = this.monster?.visionFOV ?? this.monster?.typeConfig?.stats?.visionFOV;
    const canSee = playerGrid
      ? canSeePlayer(this.worldState, monsterGrid, playerGrid, this.visionRange, { monsterYaw: yaw, visionFOV, monster: this.monster })
      : false;

    if (playerGrid) {
      this.trackPlayerMovement(playerGrid, now);
    }

    const locked = (this.stateLockUntil || 0) > now;
    const suppressed = this.monster?.aiChaseSuppressed === true;

    if (canSee && playerGrid) {
      this.lastSeenPlayerTime = now;
      this.lastSeenPlayerGrid = { x: playerGrid.x, y: playerGrid.y };
      this.updateLastKnown(playerGrid, now);
      this.investigationModule.reset();
      this.investigateModule.reset();
      this.lostSearch = null;
      this.lastSeenMoveDir = this.lastTrackedPlayerDir ? { x: this.lastTrackedPlayerDir.x, y: this.lastTrackedPlayerDir.y } : null;

      if (suppressed && !locked) {
        // Fairness: if too many monsters are already chasing, fall back to a short local search near the sighting.
        this.state = 'search';
        this.searchModule?.reset?.();
        this.beginSearch(playerGrid, now, {
          radius: Math.max(2, this.searchRadius || 4),
          durationSeconds: Math.min(Number(this.searchDurationSeconds) || 7.0, 3.5),
          preferredDir: this.lastSeenMoveDir
        });
        this.lockState(now, 0.35);
        this.targetType = 'search';
        return this.tickSearch(monsterGrid, now) || playerGrid;
      }

      // Respect post-chase cooldown unless the player is extremely close.
      const dist = this.manhattan(monsterGrid, playerGrid);
      const canEngage = now >= (this.chaseCooldownUntil || 0) || dist <= 2;
      if (this.state !== 'chase' && canEngage && !locked) {
        this.state = 'chase';
        this.lockState(now, 0.35);
      } else if (this.state === 'patrol' && canEngage) {
        this.state = 'chase';
        this.lockState(now, 0.35);
      }
    }

    if (this.state === 'chase') {
      const hasNoise = this.hasRecentNoise(now);
      const noise = this.lastHeardNoise;
      if (hasNoise && noise?.grid) {
        if ((noise.priority || 0) >= 2) {
          this.lastSeenPlayerTime = now;
        }
        this.updateLastKnown(noise.grid, now);
      }

      const hasScent = this.hasRecentScent(now);
      const scent = this.lastSmelledScent;
      if (hasScent && scent?.grid) {
        this.lastSeenPlayerTime = now;
        this.updateLastKnown(scent.grid, now);
      }

      const confidenceDropEarly = (this.targetConfidence || 0) < 0.2;
      const timeout = confidenceDropEarly ? (this.chaseTimeout * 0.6) : this.chaseTimeout;

      if (now - this.lastSeenPlayerTime > timeout && !locked) {
        this.state = 'search';
        this.tactics.reset();
        this.investigationModule.reset();
        this.investigateModule.reset();
        this.lostSearch = null;
        this.chaseCooldownUntil = Math.max(this.chaseCooldownUntil || 0, now + Math.max(0, this.chaseCooldownSeconds || 0));
        const origin = this.lastSeenPlayerGrid || this.lastKnownPlayerGrid || monsterGrid;
        this.beginSearch(origin, now, { radius: this.searchRadius, durationSeconds: this.searchDurationSeconds, preferredDir: this.lastSeenMoveDir, requireArrival: true });
        this.lockState(now, 0.45);
      }
    }

    if (this.state === 'patrol' || this.state === 'return') {
      const noise = this.lastHeardNoise;
      const scent = this.lastSmelledScent;
      const hasNoise = this.hasRecentNoise(now);
      const hasScent = this.hasRecentScent(now);
      const jammed = (this.monster?.perceptionJammedTimer || 0) > 0;
      const threshold = jammed ? 1 : 2;

      const stimulusGrid =
        (hasNoise && noise?.grid && (noise.priority || 0) >= threshold) ? noise.grid :
        (hasScent && scent?.grid ? scent.grid : null);

      if (stimulusGrid && now >= (this.chaseCooldownUntil || 0) && !locked) {
        this.state = 'investigate';
        this.investigateModule.begin(stimulusGrid, now, { durationSeconds: Number(this.investigateTimeSeconds) || 6.0 });
        this.searchModule?.reset?.();
        this.lockState(now, 0.35);
      }
    }

    if (this.state === 'investigate') {
      const res = this.investigateModule.tick({ now, monsterGrid });
      const origin = res?.targetGrid || null;
      if (!origin || res?.status === 'done') {
        this.state = 'search';
        const start = origin || this.lastKnownPlayerGrid || monsterGrid;
        this.beginSearch(start, now, { radius: this.searchRadius, durationSeconds: this.searchDurationSeconds, preferredDir: this.lastSeenMoveDir, requireArrival: true });
        this.lockState(now, 0.35);
      } else if (res?.status === 'pause') {
        this.targetType = 'investigate_pause';
        return monsterGrid;
      } else {
        this.targetType = 'investigate';
        return origin;
      }
    }

    if (this.state === 'search') {
      if (now > (this.searchUntil || 0) && !locked) {
        this.state = 'return';
        this.searchModule?.reset?.();
        this.searchOriginGrid = null;
        this.searchRequireArrival = false;
        this.lockState(now, 0.35);
      } else {
        if (this.searchRequireArrival && this.searchOriginGrid && this.manhattan(monsterGrid, this.searchOriginGrid) > 1) {
          this.targetType = 'lastSeen';
          return this.searchOriginGrid;
        }
        if (this.searchRequireArrival && this.searchOriginGrid) {
          this.searchRequireArrival = false;
        }
        const t = this.tickSearch(monsterGrid, now);
        if (t) {
          this.targetType = 'search';
          return t;
        }
      }
    }

    if (this.state === 'chase') {
      if (canSee && playerGrid) {
        this.lostSearch = null;
        const tactic = this.tactics.tick({
          now,
          monsterGrid,
          playerGrid,
          isWalkableTile: (x, y) => this.isWalkableTile(x, y)
        });
        this.targetType = tactic.mode === 'cover' ? 'cover' : (tactic.mode === 'flank' ? 'flank' : 'chase');
        return tactic.targetGrid || playerGrid || this.lastKnownPlayerGrid || this.homeCenter;
      }

      // Lost sight: try to guess an intercept point based on recent player direction, otherwise investigate noises.
      const lastKnown = this.lastKnownPlayerGrid;
      const intercept = lastKnown ? this.pickInterceptTarget(monsterGrid, lastKnown, now) : null;
      if (intercept) {
        this.targetType = 'intercept';
        return intercept;
      }

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

      const scent = this.lastSmelledScent;
      if (this.hasRecentScent(now) && scent?.grid) {
        this.targetType = 'scent';
        return scent.grid;
      }

      if (lastKnown) {
        this.targetType = 'lastKnown';
        return lastKnown;
      }

      this.targetType = 'return';
      this.state = 'return';
      this.lockState(now, 0.25);
      return this.homeCenter;
    }

    if (this.state === 'return') {
      const distHome = this.manhattan(monsterGrid, this.homeCenter);
      if (distHome <= 1 && !locked) {
        this.state = 'patrol';
        this.lockState(now, 0.25);
      }
      this.targetType = 'return';
      return this.homeCenter;
    }

    this.state = 'patrol';
    this.targetType = 'patrol';
    return this.pickPatrolTarget(monsterGrid);
  }

  computeSprint(distToTarget, distToPlayer) {
    void distToTarget;
    if (!this.allowSprint) return false;
    if (this.state === 'chase') {
      const d = Number.isFinite(distToPlayer) ? distToPlayer : Infinity;
      return d <= 7 || (this.targetConfidence || 0) > 0.55;
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

    const yaw = this.monster?.getYaw?.() ?? this.monster?.yaw;
    const visionFOV = this.monster?.visionFOV ?? this.monster?.typeConfig?.stats?.visionFOV;
    const canSee = playerGrid
      ? canSeePlayer(this.worldState, monsterGrid, playerGrid, this.visionRange, { monsterYaw: yaw, visionFOV, monster: this.monster })
      : false;

    // Tune path planning cadence by state.
    this.planInterval = this.state === 'chase'
      ? this.chasePlanInterval
      : this.basePlanInterval;

    const dt = Number.isFinite(deltaTime) ? Math.max(0, deltaTime) : 0;
    if (canSee) {
      this.targetConfidence = this.clamp01((this.targetConfidence || 0) + dt * 0.75);
    } else {
      this.targetConfidence = this.clamp01((this.targetConfidence || 0) - dt * 0.22);
    }
    if (!canSee && this.hasRecentNoise(now)) {
      this.targetConfidence = this.clamp01((this.targetConfidence || 0) + dt * 0.14);
    }
    if (!canSee && this.hasRecentScent(now)) {
      this.targetConfidence = this.clamp01((this.targetConfidence || 0) + dt * 0.16);
    }

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

    const cmd = super.tick(deltaTime);
    if (!cmd) return cmd;
    if (this.state === 'search' || (this.state === 'investigate' && !canSee) || this.targetType === 'investigate_pause') {
      const lookJitter = Math.sin((now || 0) * 2.2) * 0.04;
      return { ...cmd, lookYaw: (Number(cmd.lookYaw) || 0) + lookJitter, sprint: false };
    }
    return cmd;
  }
}
