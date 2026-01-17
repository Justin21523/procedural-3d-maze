import { CONFIG } from '../../core/config.js';
import { manhattan, wrapAngle } from './perception.js';

export class FlankCoverTactics {
  constructor(worldState, monster, options = {}) {
    this.worldState = worldState;
    this.monster = monster;

    this.enabled = options.enabled ?? (CONFIG.AI_TACTICS_ENABLED ?? true);
    this.flankSlots = options.flankSlots ?? (CONFIG.AI_TACTICS_FLANK_SLOTS ?? 6);
    this.flankMinDist = options.flankMinDist ?? (CONFIG.AI_TACTICS_FLANK_MIN_DIST ?? 1);
    this.flankMaxDist = options.flankMaxDist ?? (CONFIG.AI_TACTICS_FLANK_MAX_DIST ?? 3);

    this.coverEnabled = options.coverEnabled ?? (CONFIG.AI_TACTICS_COVER_ENABLED ?? true);
    this.coverRadius = options.coverRadius ?? (CONFIG.AI_TACTICS_COVER_RADIUS ?? 6);
    this.coverHealthThreshold = options.coverHealthThreshold ?? (CONFIG.AI_TACTICS_COVER_HEALTH_THRESHOLD ?? 0.35);
    this.coverRecentHitSeconds = options.coverRecentHitSeconds ?? (CONFIG.AI_TACTICS_COVER_RECENT_HIT_SECONDS ?? 1.2);

    this.tacticTarget = null;
    this.tacticMode = null; // 'flank' | 'cover'
    this.tacticHoldUntil = 0;
    this.nextPickTime = 0;
  }

  reset() {
    this.tacticTarget = null;
    this.tacticMode = null;
    this.tacticHoldUntil = 0;
    this.nextPickTime = 0;
  }

  tick({ now, monsterGrid, playerGrid, isWalkableTile }) {
    if (!this.enabled) return { targetGrid: playerGrid, mode: null, holdPosition: false };
    if (!monsterGrid || !playerGrid) return { targetGrid: playerGrid, mode: null, holdPosition: false };

    const role = String(this.monster?.typeConfig?.squad?.role || '').trim() || 'leader';

    if (this.tacticTarget && now < (this.nextPickTime || 0)) {
      if (this.tacticMode === 'cover') {
        const distToCover = manhattan(monsterGrid, this.tacticTarget);
        if (distToCover <= 1 && now < (this.tacticHoldUntil || 0)) {
          return { targetGrid: null, mode: 'cover', holdPosition: true };
        }
      }
      return { targetGrid: this.tacticTarget, mode: this.tacticMode, holdPosition: false };
    }

    const healthRatio = this.getHealthRatio();
    const recentlyHit = now - (this.monster?.lastDamagedAt ?? -Infinity) <= this.coverRecentHitSeconds;
    const lowHp = healthRatio < this.coverHealthThreshold;

    if (this.coverEnabled && (lowHp || recentlyHit)) {
      const cover = this.pickCoverTarget(monsterGrid, playerGrid, isWalkableTile);
      if (cover) {
        this.tacticTarget = cover;
        this.tacticMode = 'cover';
        this.tacticHoldUntil = now + 1.2 + Math.random() * 0.5;
        this.nextPickTime = now + 1.6 + Math.random() * 0.6;
        return { targetGrid: cover, mode: 'cover', holdPosition: false };
      }
    }

    // Role-based behavior: leader/rusher tends to chase directly; flanker tries to cut off; cover prefers cover even when not low.
    if (role === 'leader' || role === 'rusher') {
      this.tacticTarget = { x: playerGrid.x, y: playerGrid.y };
      this.tacticMode = 'chase';
      this.tacticHoldUntil = 0;
      this.nextPickTime = now + 0.35 + Math.random() * 0.2;
      return { targetGrid: this.tacticTarget, mode: 'chase', holdPosition: false };
    }

    if (role === 'cover' && this.coverEnabled) {
      const cover = this.pickCoverTarget(monsterGrid, playerGrid, isWalkableTile);
      if (cover) {
        this.tacticTarget = cover;
        this.tacticMode = 'cover';
        this.tacticHoldUntil = now + 0.9 + Math.random() * 0.45;
        this.nextPickTime = now + 1.2 + Math.random() * 0.6;
        return { targetGrid: cover, mode: 'cover', holdPosition: false };
      }
    }

    const flank = this.pickFlankTarget(playerGrid, monsterGrid, isWalkableTile);
    this.tacticTarget = flank;
    this.tacticMode = 'flank';
    this.tacticHoldUntil = 0;
    this.nextPickTime = now + 0.95 + Math.random() * 0.55;
    return { targetGrid: flank, mode: 'flank', holdPosition: false };
  }

  getHealthRatio() {
    const hp = this.monster?.health;
    const max = this.monster?.maxHealth;
    if (!Number.isFinite(hp) || !Number.isFinite(max) || max <= 0) return 1.0;
    return hp / max;
  }

  pickFlankTarget(playerGrid, monsterGrid, isWalkableTile) {
    const slots = Math.max(1, Math.round(this.flankSlots || 6));
    const id = Number.isFinite(this.monster?.id) ? this.monster.id : Math.floor(Math.random() * 9999);
    const slotIndex = id % slots;
    const preferredAngle = (slotIndex / slots) * Math.PI * 2;
    return this.pickRingTargetAroundPlayer(playerGrid, monsterGrid, this.flankMinDist, this.flankMaxDist, preferredAngle, isWalkableTile) || playerGrid;
  }

  pickRingTargetAroundPlayer(playerGrid, monsterGrid, minD, maxD, preferredAngle, isWalkableTile) {
    if (typeof isWalkableTile !== 'function') return null;
    let best = null;
    const min = Math.max(1, minD);
    const max = Math.max(min, maxD);

    for (let r = min; r <= max; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const dist = Math.abs(dx) + Math.abs(dy);
          if (dist < min || dist > max) continue;

          const x = playerGrid.x + dx;
          const y = playerGrid.y + dy;
          if (!isWalkableTile(x, y)) continue;

          const dFromMonster = manhattan(monsterGrid, { x, y });
          if (dFromMonster < 1) continue;

          let score = -dFromMonster;
          if (Number.isFinite(preferredAngle)) {
            const ang = Math.atan2(dy, dx);
            const delta = Math.abs(wrapAngle(ang - preferredAngle));
            score -= delta * 2.2;
          }
          score += Math.random() * 0.25;

          if (!best || score > best.score) {
            best = { x, y, score };
          }
        }
      }
    }

    return best ? { x: best.x, y: best.y } : null;
  }

  pickCoverTarget(monsterGrid, playerGrid, isWalkableTile) {
    if (!this.worldState?.hasLineOfSight) return null;
    if (typeof isWalkableTile !== 'function') return null;

    const radius = Math.max(1, Math.round(this.coverRadius || 6));
    let best = null;
    const samples = 50;

    for (let i = 0; i < samples; i++) {
      const dx = Math.floor((Math.random() * 2 - 1) * radius);
      const dy = Math.floor((Math.random() * 2 - 1) * radius);
      const x = monsterGrid.x + dx;
      const y = monsterGrid.y + dy;
      if (!isWalkableTile(x, y)) continue;

      const tile = { x, y };
      const distM = manhattan(monsterGrid, tile);
      if (distM < 1) continue;

      const distP = manhattan(playerGrid, tile);
      if (distP < 2) continue;

      if (this.worldState.hasLineOfSight(tile, playerGrid)) continue;

      const score = (radius - distM) * 3.0 + distP * 0.6 + Math.random() * 1.5;
      if (!best || score > best.score) {
        best = { x, y, score };
      }
    }

    return best ? { x: best.x, y: best.y } : null;
  }
}
