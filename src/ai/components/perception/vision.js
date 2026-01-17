import { CONFIG } from '../../../core/config.js';

export function manhattan(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function wrapAngle(delta) {
  return Math.atan2(Math.sin(delta), Math.cos(delta));
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function toFiniteNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function segmentIntersectsCircleXZ(ax, az, bx, bz, cx, cz, radius) {
  const r = Number.isFinite(radius) ? radius : 0;
  if (!(r > 0)) return false;
  const abx = bx - ax;
  const abz = bz - az;
  const abLenSq = abx * abx + abz * abz;
  if (abLenSq <= 1e-8) {
    const dx = ax - cx;
    const dz = az - cz;
    return dx * dx + dz * dz <= r * r;
  }
  let t = ((cx - ax) * abx + (cz - az) * abz) / abLenSq;
  t = Math.max(0, Math.min(1, t));
  const px = ax + abx * t;
  const pz = az + abz * t;
  const dx = px - cx;
  const dz = pz - cz;
  return dx * dx + dz * dz <= r * r;
}

function defaultMonsterFovRad() {
  // CONFIG.MONSTER_FOV is stored in radians.
  const fov = toFiniteNumber(CONFIG.MONSTER_FOV);
  return Number.isFinite(fov) ? fov : (Math.PI * 2 / 3);
}

/**
 * Vision check with optional FOV cone.
 *
 * Notes:
 * - Uses manhattan distance on grid for speed and consistency with existing AI.
 * - Optional FOV uses monster yaw (radians) in the same convention as BaseMonsterBrain:
 *   yaw = atan2(dx, dz), where +Z is forward and +X is right.
 */
export function canSeePlayer(worldState, monsterGrid, playerGrid, visionRange = null, options = {}) {
  if (!monsterGrid || !playerGrid) return false;
  let vr = Number.isFinite(visionRange)
    ? visionRange
    : (CONFIG.MONSTER_VISION_RANGE ?? 12);

  const dist = manhattan(monsterGrid, playerGrid);
  const opts = options && typeof options === 'object' ? options : {};
  const monster = opts.monster || null;

  if (monster && (monster.perceptionBlindedTimer || 0) > 0) return false;

  // Jammed: shorter effective vision (lose target, rely on noise/search).
  if (monster && (monster.perceptionJammedTimer || 0) > 0) {
    const m = Number(CONFIG.AI_JAMMED_VISION_MULT);
    const mult = Number.isFinite(m) ? clamp(m, 0.15, 1.0) : 0.65;
    vr *= mult;
  }

  // Darkness zones: reduce effective vision when either actor is inside a dark region.
  const darkZones = typeof worldState?.getDarkZones === 'function'
    ? worldState.getDarkZones()
    : (Array.isArray(worldState?.darkZones) ? worldState.darkZones : []);
  if (Array.isArray(darkZones) && darkZones.length > 0) {
    const tileSize = CONFIG.TILE_SIZE || 1;
    const mx = (monsterGrid.x + 0.5) * tileSize;
    const mz = (monsterGrid.y + 0.5) * tileSize;
    const px = (playerGrid.x + 0.5) * tileSize;
    const pz = (playerGrid.y + 0.5) * tileSize;

    let inDark = false;
    for (const z of darkZones) {
      if (!z) continue;
      const r = Number(z.radius) || 0;
      if (!(r > 0)) continue;
      const cx = Number.isFinite(z.x) ? z.x : (Number.isFinite(z.position?.x) ? z.position.x : 0);
      const cz = Number.isFinite(z.z) ? z.z : (Number.isFinite(z.position?.z) ? z.position.z : 0);
      const dxm = mx - cx;
      const dzm = mz - cz;
      const dxp = px - cx;
      const dzp = pz - cz;
      if (dxm * dxm + dzm * dzm <= r * r || dxp * dxp + dzp * dzp <= r * r) {
        inDark = true;
        break;
      }
    }
    if (inDark) {
      const m = Number(CONFIG.AI_DARK_VISION_MULT);
      const mult = Number.isFinite(m) ? clamp(m, 0.15, 1.0) : 0.55;
      vr *= mult;
    }
  }

  if (dist > vr) return false;

  const requireLineOfSight = opts.requireLineOfSight !== false;

  if (requireLineOfSight && worldState && typeof worldState.hasLineOfSight === 'function') {
    if (!worldState.hasLineOfSight(monsterGrid, playerGrid)) return false;
  }

  const enforceFov = opts.enforceFov !== false;
  const yaw = toFiniteNumber(opts.monsterYaw);

  // If yaw isn't provided, keep legacy behavior (no cone check).
  if (enforceFov && Number.isFinite(yaw)) {
    const rawFov = toFiniteNumber(opts.visionFOV);
    const fov = clamp(rawFov ?? defaultMonsterFovRad(), 0, Math.PI * 2);
    const eps = 1e-4;

    // Full 360 vision: skip cone test.
    if (fov < Math.PI * 2 - eps) {
      const dx = playerGrid.x - monsterGrid.x;
      const dz = playerGrid.y - monsterGrid.y;

      // Same tile => treat as visible regardless of facing.
      if (dx !== 0 || dz !== 0) {
        const angleToPlayer = Math.atan2(dx, dz);
        const delta = wrapAngle(angleToPlayer - yaw);
        if (Math.abs(delta) > fov * 0.5) return false;
      }
    }
  }

  const clouds = typeof worldState?.getSmokeClouds === 'function'
    ? worldState.getSmokeClouds()
    : (Array.isArray(worldState?.smokeClouds) ? worldState.smokeClouds : []);
  if (Array.isArray(clouds) && clouds.length > 0) {
    const tileSize = CONFIG.TILE_SIZE || 1;
    const ax = (monsterGrid.x + 0.5) * tileSize;
    const az = (monsterGrid.y + 0.5) * tileSize;
    const bx = (playerGrid.x + 0.5) * tileSize;
    const bz = (playerGrid.y + 0.5) * tileSize;
    for (const cloud of clouds) {
      if (!cloud) continue;
      const life = Number(cloud.life);
      if (!(life > 0)) continue;
      const radius = Number(cloud.radius) || 0;
      if (!(radius > 0)) continue;
      const cx = Number.isFinite(cloud.x)
        ? cloud.x
        : (Number.isFinite(cloud.position?.x) ? cloud.position.x : (Number.isFinite(cloud.world?.x) ? cloud.world.x : 0));
      const cz = Number.isFinite(cloud.z)
        ? cloud.z
        : (Number.isFinite(cloud.position?.z) ? cloud.position.z : (Number.isFinite(cloud.world?.z) ? cloud.world.z : 0));
      if (segmentIntersectsCircleXZ(ax, az, bx, bz, cx, cz, radius)) return false;
    }
  }
  return true;
}
