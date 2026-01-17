import { CONFIG } from '../../../core/config.js';

function normalizeRole(role) {
  return String(role || '').trim().toLowerCase();
}

function manhattan(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function isValidGrid(grid) {
  if (!grid) return false;
  return Number.isFinite(grid.x) && Number.isFinite(grid.y);
}

function hasAdjacentWall(isWalkableTile, x, y) {
  if (typeof isWalkableTile !== 'function') return false;
  const neighbors = [
    { x: x + 1, y },
    { x: x - 1, y },
    { x, y: y + 1 },
    { x, y: y - 1 },
  ];
  for (const n of neighbors) {
    if (!isWalkableTile(n.x, n.y)) return true;
  }
  return false;
}

function countWalkableNeighbors(isWalkableTile, x, y) {
  if (typeof isWalkableTile !== 'function') return 0;
  let count = 0;
  if (isWalkableTile(x + 1, y)) count++;
  if (isWalkableTile(x - 1, y)) count++;
  if (isWalkableTile(x, y + 1)) count++;
  if (isWalkableTile(x, y - 1)) count++;
  return count;
}

function isJunctionTile(isWalkableTile, x, y) {
  return countWalkableNeighbors(isWalkableTile, x, y) >= 3;
}

export class SquadCoordinationModule {
  constructor(worldState, monster, options = {}) {
    this.worldState = worldState || null;
    this.monster = monster || null;

    this.enabled = options.enabled ?? true;
    this.coordinator = options.coordinator || null;
    this.squadId = options.squadId || null;
    this.role = options.role || null;

    this.memorySeconds =
      options.memorySeconds ??
      (CONFIG.AI_SQUAD_MEMORY_SECONDS ?? 6.5);

    this.noiseShareSeconds =
      options.noiseShareSeconds ??
      (CONFIG.AI_SQUAD_NOISE_SHARE_SECONDS ?? 2.0);

    this.coverFireEnabled =
      options.coverFireEnabled ??
      true;

    this.coverFireRadius =
      options.coverFireRadius ??
      (CONFIG.AI_SQUAD_COVER_RADIUS ?? 9);

    this.coverFireMinDist =
      options.coverFireMinDist ??
      5;

    this.coverFireMaxDist =
      options.coverFireMaxDist ??
      14;

    this.coverFireHoldSeconds =
      options.coverFireHoldSeconds ??
      1.25;

    this.coverFireRepickSeconds =
      options.coverFireRepickSeconds ??
      2.2;

    this.coverFireTarget = null;
    this.coverFireUntil = 0;

    // Flanker cadence (avoid rapidly swapping flank direction/tiles).
    this.flankSlotKeepSeconds =
      options.flankSlotKeepSeconds ??
      (CONFIG.AI_SQUAD_FLANK_SLOT_KEEP_SECONDS ?? 8.0);

    this.flankTargetKeepSeconds =
      options.flankTargetKeepSeconds ??
      2.6;

    this.flankTarget = null;
    this.flankTargetUntil = 0;
  }

  getSquadRole() {
    const fromType = this.monster?.typeConfig?.squad?.role;
    return normalizeRole(this.role || fromType || '');
  }

  getSquadId() {
    const fromType = this.monster?.typeConfig?.squad?.squadId;
    const id = String(this.squadId || fromType || '');
    return id || null;
  }

  getMonsterId() {
    const id = this.monster?.id;
    return Number.isFinite(id) ? id : null;
  }

  getHealthRatio() {
    const hp = this.monster?.health;
    const max = this.monster?.maxHealth;
    if (!Number.isFinite(hp) || !Number.isFinite(max) || max <= 0) return 1.0;
    return hp / max;
  }

  shouldHide(now) {
    const hp = this.getHealthRatio();
    const low = hp < 0.45;
    const recentlyHit = now - (this.monster?.lastDamagedAt ?? -Infinity) <= 1.6;
    return low || recentlyHit;
  }

  updateKnowledge({ now, playerGrid, canSee, lastHeardNoise }) {
    if (!this.enabled) return;
    if (!this.coordinator?.updateMember || !this.coordinator?.reportTarget) return;

    const squadId = this.getSquadId();
    if (!squadId) return;

    const monsterId = this.getMonsterId();
    const role = this.getSquadRole();

    this.coordinator.updateMember(squadId, monsterId, role, now);

    if (canSee && isValidGrid(playerGrid)) {
      const priority =
        (role === 'leader' || role === 'rusher') ? 20 :
        (role === 'flanker' || role === 'scout') ? 12 :
        (role === 'cover' || role === 'support') ? 11 :
        10;

      const memoryMult = (role === 'leader' || role === 'rusher') ? 1.15 : 1.0;

      this.coordinator.reportTarget(squadId, playerGrid, now, {
        kind: 'player',
        priority,
        reporterId: monsterId,
        reporterRole: role,
        memorySeconds: (this.memorySeconds || 6.5) * memoryMult
      });
      return;
    }

    const noise = lastHeardNoise;
    if (!noise?.grid) return;

    const heardAt = Number.isFinite(noise.heardAt) ? noise.heardAt : -Infinity;
    if (now - heardAt > this.noiseShareSeconds) return;

    const kind = String(noise.kind || '').toLowerCase();
    const priority = Number.isFinite(noise.priority) ? noise.priority : 0;
    const isHighSignal = priority >= 2 || kind.includes('alert') || kind.includes('gun');
    if (!isHighSignal) return;

    this.coordinator.reportTarget(squadId, noise.grid, now, {
      kind: 'noise',
      priority,
      reporterId: monsterId,
      reporterRole: role,
      memorySeconds: Math.min(this.memorySeconds, 3.5)
    });
  }

  getSharedTarget(now) {
    if (!this.enabled) return null;
    if (!this.coordinator?.getTarget) return null;
    const squadId = this.getSquadId();
    if (!squadId) return null;
    const info = this.coordinator.getTarget(squadId, now);
    return info?.targetGrid || null;
  }

  pickCoverFireTarget(monsterGrid, playerGrid, isWalkableTile, now) {
    if (!this.coverFireEnabled) return null;
    if (!this.worldState?.hasLineOfSight) return null;
    if (!isValidGrid(monsterGrid) || !isValidGrid(playerGrid)) return null;
    if (typeof isWalkableTile !== 'function') return null;

    const t = Number.isFinite(now) ? now : (performance.now() / 1000);
    if (
      this.coverFireTarget &&
      t < (this.coverFireUntil || 0) &&
      isWalkableTile(this.coverFireTarget.x, this.coverFireTarget.y)
    ) {
      return this.coverFireTarget;
    }

    const radius = Math.max(2, Math.round(this.coverFireRadius || 9));
    const minDist = Math.max(2, Math.round(this.coverFireMinDist || 5));
    const maxDist = Math.max(minDist, Math.round(this.coverFireMaxDist || 14));
    const ideal = (minDist + maxDist) * 0.5;

    let best = null;
    const samples = 90;

    for (let i = 0; i < samples; i++) {
      const dx = Math.floor((Math.random() * 2 - 1) * radius);
      const dy = Math.floor((Math.random() * 2 - 1) * radius);
      const x = monsterGrid.x + dx;
      const y = monsterGrid.y + dy;
      if (!isWalkableTile(x, y)) continue;

      const tile = { x, y };
      const dMonster = manhattan(monsterGrid, tile);
      if (dMonster < 2) continue;

      const dPlayer = manhattan(playerGrid, tile);
      if (dPlayer < minDist || dPlayer > maxDist) continue;

      // Needs line of sight for "cover fire".
      if (!this.worldState.hasLineOfSight(tile, playerGrid)) continue;

      // Must be near a wall/obstacle to feel like cover.
      if (!hasAdjacentWall(isWalkableTile, x, y)) continue;

      const distScore = -Math.abs(dPlayer - ideal) * 1.2;
      const travelPenalty = -dMonster * 0.25;
      const wallBonus = 2.2;
      const jitter = Math.random() * 0.35;
      const score = distScore + travelPenalty + wallBonus + jitter;

      if (!best || score > best.score) {
        best = { x, y, score };
      }
    }

    if (!best) return null;

    this.coverFireTarget = { x: best.x, y: best.y };
    this.coverFireUntil = t + this.coverFireRepickSeconds + Math.random() * 0.9;
    return this.coverFireTarget;
  }

  pickJunctionFlankTarget(monsterGrid, targetGrid, isWalkableTile) {
    if (!isValidGrid(monsterGrid) || !isValidGrid(targetGrid)) return null;
    if (typeof isWalkableTile !== 'function') return null;

    const radius = Math.max(2, Math.round(Number(CONFIG.AI_SQUAD_FLANK_JUNCTION_RADIUS) || 7));
    const minDist = Math.max(1, Math.round(Number(CONFIG.AI_SQUAD_FLANK_JUNCTION_MIN_DIST) || 2));

    let best = null;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const dist = Math.abs(dx) + Math.abs(dy);
        if (dist < minDist || dist > radius) continue;
        const x = targetGrid.x + dx;
        const y = targetGrid.y + dy;
        if (!isWalkableTile(x, y)) continue;
        if (!isJunctionTile(isWalkableTile, x, y)) continue;

        const dMonster = manhattan(monsterGrid, { x, y });
        const dTarget = manhattan(targetGrid, { x, y });
        // Prefer junctions close to the target (to "cut off"), but still reachable.
        const score = -dMonster * 0.25 - Math.abs(dTarget - 3) * 1.25 + Math.random() * 0.35;
        if (!best || score > best.score) {
          best = { x, y, score };
        }
      }
    }
    if (!best) return null;

    // Prefer standing on a "junction exit" that blocks escape routes: step away from the target if possible.
    const neighbors = [
      { x: best.x + 1, y: best.y },
      { x: best.x - 1, y: best.y },
      { x: best.x, y: best.y + 1 },
      { x: best.x, y: best.y - 1 }
    ];
    let bestExit = null;
    for (const n of neighbors) {
      if (!isWalkableTile(n.x, n.y)) continue;
      const delta = manhattan(targetGrid, n) - manhattan(targetGrid, best);
      if (delta < 1) continue;
      const score = delta * 10 - manhattan(monsterGrid, n) * 0.35 + Math.random() * 0.2;
      if (!bestExit || score > bestExit.score) bestExit = { x: n.x, y: n.y, score };
    }

    return bestExit ? { x: bestExit.x, y: bestExit.y } : { x: best.x, y: best.y };
  }

  getDirective({ now, monsterGrid, playerGrid, canSee, isWalkableTile, tactics, lastHeardNoise }) {
    if (!this.enabled) return null;
    const role = this.getSquadRole();
    if (!role) return null;

    this.updateKnowledge({ now, playerGrid, canSee, lastHeardNoise });

    const sharedTarget = this.getSharedTarget(now);
    if (!isValidGrid(sharedTarget)) return null;

    // Leader: push directly towards shared target (player/noise).
    if (role === 'leader' || role === 'rusher') {
      return { targetGrid: sharedTarget, holdPosition: false, lookAtGrid: sharedTarget, mode: 'lead' };
    }

    // Flanker: ring around shared target.
    if (role === 'flanker' || role === 'scout') {
      const tNow = Number.isFinite(now) ? now : (performance.now() / 1000);

      if (
        this.flankTarget &&
        tNow < (this.flankTargetUntil || 0) &&
        isValidGrid(this.flankTarget) &&
        (typeof isWalkableTile !== 'function' || isWalkableTile(this.flankTarget.x, this.flankTarget.y))
      ) {
        return { targetGrid: this.flankTarget, holdPosition: false, lookAtGrid: sharedTarget, mode: 'flank' };
      }

      const squadId = this.getSquadId();
      const monsterId = this.getMonsterId();

      const slots = Math.max(1, Math.round(tactics?.flankSlots ?? (CONFIG.AI_TACTICS_FLANK_SLOTS ?? 6)));
      const preferredSlot = squadId && Number.isFinite(monsterId) && this.coordinator?.getFlankSlot
        ? this.coordinator.getFlankSlot(squadId, monsterId, slots, tNow, { keepSeconds: this.flankSlotKeepSeconds })
        : null;
      const preferredAngle = Number.isFinite(preferredSlot)
        ? (preferredSlot / slots) * Math.PI * 2
        : null;

      if (tactics?.pickRingTargetAroundPlayer) {
        const minD = tactics.flankMinDist ?? (CONFIG.AI_TACTICS_FLANK_MIN_DIST ?? 1);
        const maxD = tactics.flankMaxDist ?? (CONFIG.AI_TACTICS_FLANK_MAX_DIST ?? 3);
        const flank = tactics.pickRingTargetAroundPlayer(sharedTarget, monsterGrid, minD, maxD, preferredAngle, isWalkableTile);
        if (flank) {
          this.flankTarget = flank;
          this.flankTargetUntil = tNow + Math.max(0.6, (this.flankTargetKeepSeconds || 2.6) * (0.85 + Math.random() * 0.3));
          return { targetGrid: flank, holdPosition: false, lookAtGrid: sharedTarget, mode: 'flank' };
        }
      }

      // Corridors: if we can't flank as a ring, try to grab a nearby junction to cut off the target.
      const junction = this.pickJunctionFlankTarget(monsterGrid, sharedTarget, isWalkableTile);
      if (junction) {
        this.flankTarget = junction;
        this.flankTargetUntil = tNow + Math.max(0.9, (this.flankTargetKeepSeconds || 2.6) * (0.9 + Math.random() * 0.35));
        return { targetGrid: junction, holdPosition: false, lookAtGrid: sharedTarget, mode: 'flank_junction' };
      }

      if (tactics?.tick) {
        const tactic = tactics.tick({
          now,
          monsterGrid,
          playerGrid: sharedTarget,
          isWalkableTile
        });
        if (tactic?.targetGrid) {
          return { targetGrid: tactic.targetGrid, holdPosition: false, lookAtGrid: sharedTarget, mode: 'flank' };
        }
      }

      return { targetGrid: sharedTarget, holdPosition: false, lookAtGrid: sharedTarget, mode: 'flank' };
    }

    // Cover: try to keep a firing lane; if hurt, take hard cover and hold.
    if (role === 'cover' || role === 'support') {
      const hide = this.shouldHide(now);

      if (hide && tactics?.tick) {
        const tactic = tactics.tick({
          now,
          monsterGrid,
          playerGrid: sharedTarget,
          isWalkableTile
        });

        if (tactic?.holdPosition) {
          return { targetGrid: monsterGrid, holdPosition: true, lookAtGrid: sharedTarget, mode: 'cover_hold' };
        }
        if (tactic?.targetGrid) {
          return { targetGrid: tactic.targetGrid, holdPosition: false, lookAtGrid: sharedTarget, mode: 'cover_hide' };
        }
      }

      const firePos = this.pickCoverFireTarget(monsterGrid, sharedTarget, isWalkableTile, now);
      if (firePos) {
        const atPos = manhattan(monsterGrid, firePos) <= 1;
        if (atPos) {
          this.coverFireUntil = Math.max(this.coverFireUntil || 0, now + this.coverFireHoldSeconds);
        }
        return {
          targetGrid: atPos ? monsterGrid : firePos,
          holdPosition: atPos,
          lookAtGrid: sharedTarget,
          mode: atPos ? 'cover_fire_hold' : 'cover_fire_move'
        };
      }

      return { targetGrid: sharedTarget, holdPosition: false, lookAtGrid: sharedTarget, mode: 'cover' };
    }

    return null;
  }
}
