import { CONFIG } from '../../core/config.js';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function wrapAngle(a) {
  const twoPi = Math.PI * 2;
  let v = a;
  v = ((v + Math.PI) % twoPi + twoPi) % twoPi - Math.PI;
  return v;
}

function normalizeRole(role) {
  return String(role || '').trim().toLowerCase();
}

function toFiniteNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getMonsterYaw(monster) {
  if (!monster) return 0;
  if (typeof monster.getYaw === 'function') return monster.getYaw() || 0;
  if (typeof monster.yaw === 'number') return monster.yaw;
  return 0;
}

export class RangedCombatModule {
  constructor(worldState, monster, playerRef, options = {}) {
    this.worldState = worldState;
    this.monster = monster;
    this.playerRef = playerRef;
    this.options = options || {};

    this.shotCooldown = Math.random() * 0.4;
    this.burstShotsRemaining = 0;
    this.burstRestTimer = Math.random() * 0.35;
    this.magSize = 0;
    this.ammoInMag = 0;
    this.reloadTimer = 0;
    this.lastPlayerSample = null; // { x, y, z }
    this.playerVelocity = { x: 0, y: 0, z: 0 };

    // Cover suppression rhythm (role-based cadence).
    this.coverSuppressFiring = Math.random() < 0.7;
    this.coverSuppressTimer = Math.random() * 0.8;
  }

  updatePlayerVelocity(dt) {
    if (!this.playerRef) return;
    if (!(dt > 0)) return;

    const playerPos = this.playerRef?.getAIPerceivedWorldPosition
      ? this.playerRef.getAIPerceivedWorldPosition()
      : (this.playerRef?.position || (this.playerRef?.getPosition ? this.playerRef.getPosition() : null));
    if (!playerPos || !Number.isFinite(playerPos.x) || !Number.isFinite(playerPos.z)) {
      this.lastPlayerSample = null;
      return;
    }

    if (this.lastPlayerSample) {
      const vx = (playerPos.x - this.lastPlayerSample.x) / dt;
      const vy = (playerPos.y - this.lastPlayerSample.y) / dt;
      const vz = (playerPos.z - this.lastPlayerSample.z) / dt;
      const clamp = 14;
      this.playerVelocity = {
        x: Math.max(-clamp, Math.min(clamp, vx)),
        y: Math.max(-clamp, Math.min(clamp, vy)),
        z: Math.max(-clamp, Math.min(clamp, vz))
      };
    }
    this.lastPlayerSample = { x: playerPos.x, y: playerPos.y, z: playerPos.z };
  }

  decorateCommand(command, deltaTime) {
    const dt = deltaTime ?? 0;
    const base = command || { move: { x: 0, y: 0 }, lookYaw: 0, sprint: false };

    this.shotCooldown = Math.max(0, (this.shotCooldown || 0) - dt);
    this.burstRestTimer = Math.max(0, (this.burstRestTimer || 0) - dt);

    if (this.reloadTimer > 0) {
      this.reloadTimer = Math.max(0, (this.reloadTimer || 0) - dt);
      if (this.reloadTimer <= 0) {
        const refill = Math.max(1, this.magSize || 1);
        this.ammoInMag = refill;
        this.shotCooldown = Math.max(this.shotCooldown || 0, 0.15);
      }
    }

    this.updatePlayerVelocity(dt);

    const ranged = this.monster?.typeConfig?.combat?.ranged;
    if (!ranged?.enabled) return base;

    if (!CONFIG.AI_RANGED_GLOBAL_ENABLED) return base;

    // Focus-fire: when in a squad, only fire while the squad is actively engaged with the player.
    const nowSec = performance.now() / 1000;
    const role = normalizeRole(this.options?.role || this.monster?.typeConfig?.squad?.role);
    const focusFireEnabled = this.options?.focusFireEnabled ?? true;
    const squadCoordinator = this.options?.squadCoordinator || this.options?.coordinator || null;
    const squadIdRaw = this.options?.squadId ?? this.monster?.typeConfig?.squad?.squadId;
    const squadId = typeof squadIdRaw === 'string' && squadIdRaw.trim() ? squadIdRaw.trim() : null;
    if (focusFireEnabled && squadId && squadCoordinator?.getTarget) {
      const info = squadCoordinator.getTarget(squadId, nowSec);
      if (!info || info.targetKind !== 'player') {
        return base;
      }
    }

    const playerPos = this.playerRef?.getAIPerceivedWorldPosition
      ? this.playerRef.getAIPerceivedWorldPosition()
      : (this.playerRef?.position || (this.playerRef?.getPosition ? this.playerRef.getPosition() : null));
    const monsterPos = this.monster?.getWorldPosition ? this.monster.getWorldPosition() : null;
    if (!playerPos || !monsterPos) return base;

    const dx = playerPos.x - monsterPos.x;
    const dz = playerPos.z - monsterPos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    const range = ranged.range ?? Math.min(this.monster?.visionRange ?? 12, 18);
    const minRange = ranged.minRange ?? 3.5;
    if (dist < minRange || dist > range) return base;

    const tileSize = CONFIG.TILE_SIZE || 1;
    const mg = {
      x: Math.floor(monsterPos.x / tileSize),
      y: Math.floor(monsterPos.z / tileSize)
    };
    const pg = {
      x: Math.floor(playerPos.x / tileSize),
      y: Math.floor(playerPos.z / tileSize)
    };
    const hasLOS = this.worldState?.hasLineOfSight ? this.worldState.hasLineOfSight(mg, pg) : true;
    if (!hasLOS) return base;

    const difficulty = CONFIG.AI_DIFFICULTY ?? 1.0;
    const diff = clamp(difficulty, 0.6, 2.0);

    const aimYawAlignDeg = ranged.fireAlignDeg ?? CONFIG.MONSTER_RANGED_FIRE_ALIGN_DEG ?? 16;
    const aimYawAlignRad = (clamp(aimYawAlignDeg, 1, 60) * Math.PI) / 180;

    const turnSpeed = ranged.turnSpeed ?? CONFIG.MONSTER_RANGED_TURN_SPEED ?? 6.5; // rad/s

    const burstMin = Math.max(1, Math.round(ranged.burstMin ?? CONFIG.MONSTER_RANGED_BURST_MIN ?? 1));
    const burstMax = Math.max(burstMin, Math.round(ranged.burstMax ?? CONFIG.MONSTER_RANGED_BURST_MAX ?? 2));

    const magSize = Math.max(1, Math.round(ranged.magSize ?? CONFIG.MONSTER_RANGED_MAG_SIZE ?? 6));
    const reloadSeconds = clamp((ranged.reloadSeconds ?? CONFIG.MONSTER_RANGED_RELOAD_SECONDS ?? 1.65) / Math.sqrt(diff), 0.4, 8);

    const baseShotInterval = ranged.shotInterval ?? ranged.cooldown ?? 1.4;
    const minShotInterval = CONFIG.MONSTER_RANGED_MIN_SHOT_INTERVAL ?? 0.18;
    let shotInterval = Math.max(minShotInterval, (Number(baseShotInterval) || 1.4) / diff);

    const baseBurstRest = ranged.burstRestSeconds ?? ranged.burstRest ?? CONFIG.MONSTER_RANGED_BURST_REST_SECONDS ?? 0.7;
    let burstRestSeconds = clamp((Number(baseBurstRest) || 0.7) * (0.85 + Math.random() * 0.35), 0.15, 6);

    const roleShotMult = clamp(toFiniteNumber(this.options?.roleShotIntervalMult, 1.0) ?? 1.0, 0.5, 3.0);
    const roleBurstMult = clamp(toFiniteNumber(this.options?.roleBurstRestMult, 1.0) ?? 1.0, 0.5, 3.0);
    shotInterval = clamp(shotInterval * roleShotMult, minShotInterval, 60);
    burstRestSeconds = clamp(burstRestSeconds * roleBurstMult, 0.15, 12);

    const speed = ranged.speed ?? CONFIG.MONSTER_PROJECTILE_SPEED ?? 22;
    const timeToHit = dist / Math.max(6, speed);
    const lead = 0.55 + 0.35 * diff;
    const aimX = playerPos.x + (this.playerVelocity?.x || 0) * timeToHit * lead;
    const aimZ = playerPos.z + (this.playerVelocity?.z || 0) * timeToHit * lead;
    const aimY = playerPos.y - (CONFIG.PLAYER_HEIGHT ?? 1.7) * 0.35;

    const currentYaw = getMonsterYaw(this.monster);
    const desiredYaw = Math.atan2(aimX - monsterPos.x, aimZ - monsterPos.z);
    const yawDelta = wrapAngle(desiredYaw - currentYaw);

    if (dt > 0 && Number.isFinite(turnSpeed) && turnSpeed > 0) {
      const maxTurn = turnSpeed * dt;
      base.lookYaw = clamp(yawDelta, -maxTurn, maxTurn);
    } else {
      base.lookYaw = yawDelta;
    }

    // Reload/magazine rhythm (simple, infinite reserve).
    if (this.magSize !== magSize) {
      this.magSize = magSize;
      if (!(this.ammoInMag > 0)) {
        this.ammoInMag = magSize;
      } else {
        this.ammoInMag = clamp(this.ammoInMag, 0, magSize);
      }
    }

    if (this.reloadTimer > 0) return base;

    if (this.ammoInMag <= 0) {
      this.reloadTimer = reloadSeconds;
      this.burstShotsRemaining = 0;
      this.burstRestTimer = Math.max(this.burstRestTimer || 0, 0.25);
      return base;
    }

    const alignedYaw = Math.abs(yawDelta) <= aimYawAlignRad;
    if (!alignedYaw) return base;

    if (this.burstRestTimer > 0) return base;
    if (this.shotCooldown > 0) return base;

    if (this.burstShotsRemaining <= 0) {
      const span = burstMax - burstMin + 1;
      this.burstShotsRemaining = burstMin + Math.floor(Math.random() * span);
    }

    // Cover suppression cadence: alternate between "fire" and "rest" windows.
    let allowFire = true;
    const coverSuppressEnabled = !!this.options?.coverSuppressEnabled;
    if (coverSuppressEnabled && (role === 'cover' || role === 'support')) {
      const fireSeconds = clamp(toFiniteNumber(this.options?.coverSuppressFireSeconds, 1.5) ?? 1.5, 0.2, 8);
      const restSeconds = clamp(toFiniteNumber(this.options?.coverSuppressRestSeconds, 0.9) ?? 0.9, 0.1, 8);

      this.coverSuppressTimer = Math.max(0, (this.coverSuppressTimer || 0) - dt);
      if ((this.coverSuppressTimer || 0) <= 0) {
        this.coverSuppressFiring = !this.coverSuppressFiring;
        const baseWindow = this.coverSuppressFiring ? fireSeconds : restSeconds;
        this.coverSuppressTimer = baseWindow * (0.85 + Math.random() * 0.3);
      }

      if (!this.coverSuppressFiring) {
        allowFire = false;
      }
    }

    if (!allowFire) return base;

    // Squad focus-fire limiter: avoid every member firing at the same time.
    const squadFireLimiterEnabled = this.options?.squadFireLimiterEnabled ?? true;
    const monsterId = Number.isFinite(this.monster?.id) ? this.monster.id : null;
    if (squadFireLimiterEnabled && squadId && monsterId !== null && squadCoordinator?.allowRangedFire) {
      const ok = squadCoordinator.allowRangedFire(squadId, monsterId, nowSec, {
        role,
        maxShooters: this.options?.maxRangedShooters ?? this.options?.squadMaxRangedShooters,
        grantSeconds: this.options?.fireGrantSeconds ?? this.options?.squadFireGrantSeconds
      });
      if (!ok) {
        this.shotCooldown = Math.max(this.shotCooldown || 0, Math.max(0.08, shotInterval * 0.35));
        return base;
      }
    }

    const chance = Math.min(1.0, (ranged.fireChance ?? 1.0) * (0.7 + 0.3 * diff));
    if (chance < 1.0 && Math.random() > chance) {
      this.shotCooldown = Math.max(0.18, shotInterval * 0.55);
      return base;
    }

    base.fire = {
      kind: ranged.kind ?? 'bolt',
      aimAt: { x: aimX, y: aimY, z: aimZ },
      speed: ranged.speed,
      lifetime: ranged.lifetime,
      damage: ranged.damage,
      spread: ranged.spread ?? 0.035,
      color: ranged.color
    };

    this.ammoInMag = Math.max(0, (this.ammoInMag || 0) - 1);
    this.burstShotsRemaining = Math.max(0, (this.burstShotsRemaining || 0) - 1);
    this.shotCooldown = shotInterval * (0.85 + Math.random() * 0.25);

    if (this.ammoInMag <= 0) {
      this.reloadTimer = reloadSeconds;
      this.burstShotsRemaining = 0;
      this.burstRestTimer = Math.max(this.burstRestTimer || 0, 0.35);
      return base;
    }

    if (this.burstShotsRemaining <= 0) {
      this.burstRestTimer = burstRestSeconds;
    }

    return base;
  }
}
