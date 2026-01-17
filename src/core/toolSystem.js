import * as THREE from 'three';
import { CONFIG } from './config.js';
import { EVENTS } from './events.js';
import { TILE_TYPES } from '../world/tileTypes.js';

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function normalizeItemId(itemId) {
  const id = String(itemId || '').trim();
  return id ? id : null;
}

function toCount(value, fallback = 1) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, n);
}

function isVec3(v) {
  return !!v && typeof v.x === 'number' && typeof v.y === 'number' && typeof v.z === 'number';
}

function vec3From(v) {
  if (v?.isVector3) return v.clone();
  if (isVec3(v)) return new THREE.Vector3(v.x, v.y, v.z);
  return new THREE.Vector3();
}

export class ToolSystem {
  constructor(options = {}) {
    this.scene = options.scene || null;
    this.player = options.player || null;
    this.worldState = options.worldState || null;
    this.monsterManager = options.monsterManager || null;
    this.eventBus = options.eventBus || null;
    this.gameState = options.gameState || null;
    this.projectileManager = options.projectileManager || null;
    this.audioManager = options.audioManager || null;

    this.devices = [];
    this.smokeClouds = [];
    this.decoyGhosts = [];
    this.delayedNoises = [];
    this.tempObstacles = [];
    this.maxDevices = Math.max(0, Math.round(CONFIG.TOOL_MAX_ACTIVE_DEVICES ?? 6));
    this.levelConfig = null;

    this.unsubs = [];
    this.bindEvents();

    this._tmpForward = new THREE.Vector3();
    this._tmpPos = new THREE.Vector3();
    this._tmpDir = new THREE.Vector3();
    this._tmpOrigin = new THREE.Vector3();
  }

  setRefs({ scene, player, worldState, monsterManager, eventBus, gameState, projectileManager, audioManager } = {}) {
    if (scene) this.scene = scene;
    if (player) this.player = player;
    if (worldState) this.worldState = worldState;
    if (monsterManager) this.monsterManager = monsterManager;
    if (eventBus) this.eventBus = eventBus;
    if (gameState) this.gameState = gameState;
    if (projectileManager) this.projectileManager = projectileManager;
    if (audioManager) this.audioManager = audioManager;
    if (worldState) {
      this.worldState.smokeClouds = this.smokeClouds;
    }
    this.bindEvents();
  }

  bindEvents() {
    this.unsubs.forEach((fn) => fn?.());
    this.unsubs = [];

    const bus = this.eventBus;
    if (!bus?.on) return;

    const onImpact = (payload) => this.onProjectileImpact(payload);
    this.unsubs.push(bus.on(EVENTS.PROJECTILE_HIT_WALL, onImpact));
    this.unsubs.push(bus.on(EVENTS.PLAYER_HIT_MONSTER, onImpact));
  }

  clear() {
    // Restore temporary obstacles (e.g. door wedges).
    if (this.worldState?.setObstacle && Array.isArray(this.tempObstacles)) {
      for (const o of this.tempObstacles) {
        if (!o) continue;
        this.worldState.setObstacle(o.x, o.y, false);
      }
    }
    this.tempObstacles = [];

    for (const d of this.devices) {
      if (d?.mesh) {
        try {
          this.scene?.remove?.(d.mesh);
        } catch {
          // ignore
        }
      }
    }
    this.devices = [];

    for (const cloud of this.smokeClouds) {
      if (cloud?.mesh) {
        try {
          this.scene?.remove?.(cloud.mesh);
        } catch {
          // ignore
        }
      }
    }
    this.smokeClouds = [];
    this.decoyGhosts = [];
    this.delayedNoises = [];
    if (this.worldState) {
      this.worldState.smokeClouds = this.smokeClouds;
    }
  }

  startLevel(levelConfig = null) {
    this.clear();
    this.levelConfig = levelConfig || null;
    const rawMax =
      this.levelConfig?.pickups?.tools?.maxDevices ??
      this.levelConfig?.tools?.maxDevices ??
      null;
    const fallback = CONFIG.TOOL_MAX_ACTIVE_DEVICES ?? 6;
    const n = Math.round(Number(rawMax));
    this.maxDevices = Number.isFinite(n) ? Math.max(0, n) : Math.max(0, Math.round(Number(fallback) || 0));
    if (this.worldState) {
      this.worldState.smokeClouds = this.smokeClouds;
    }
  }

  consumeInventory(itemId, count = 1) {
    const id = normalizeItemId(itemId);
    if (!id) return { ok: false, itemId: null, consumed: 0, remaining: 0 };
    const need = toCount(count, 1);
    if (need <= 0) return { ok: true, itemId: id, consumed: 0, remaining: 0 };

    const bus = this.eventBus;
    if (!bus?.emit) return { ok: false, itemId: id, consumed: 0, remaining: 0 };

    const payload = { actorKind: 'player', itemId: id, count: need, result: null };
    bus.emit(EVENTS.INVENTORY_CONSUME_ITEM, payload);
    return payload.result || { ok: false, itemId: id, consumed: 0, remaining: 0 };
  }

  emitToast(text, seconds = 1.6) {
    const msg = String(text || '').trim();
    if (!msg) return;
    this.eventBus?.emit?.(EVENTS.UI_TOAST, {
      text: msg,
      seconds: Number.isFinite(seconds) ? seconds : 1.6
    });
  }

  onProjectileImpact(payload) {
    const projectile = payload?.projectile || null;
    const hitPos = payload?.hitPosition || null;
    if (!projectile || !hitPos) return;
    if (projectile.owner && projectile.owner !== 'player') return;

    const kind = String(projectile.kind || '').toLowerCase();
    if (!kind) return;

    if (kind === 'decoy_grenade') {
      this.triggerDecoy(vec3From(hitPos));
    } else if (kind === 'decoy_grenade_delay') {
      const pos = vec3From(hitPos);
      this.triggerDecoy(pos);
      const delay = Math.max(0.15, Number(CONFIG.TOOL_DECOY_DELAY_SECONDS) || 2.75);
      const boomRadius = Math.max(8, Math.round(Number(CONFIG.TOOL_DECOY_DELAY_BOOM_RADIUS) || 28));
      this.delayedNoises.push({
        kind: 'delayedBoom',
        position: pos.clone(),
        timer: delay,
        radius: boomRadius
      });
    } else if (kind === 'smoke_grenade') {
      this.triggerSmoke(vec3From(hitPos));
    } else if (kind === 'smoke_grenade_weak') {
      this.triggerSmoke(vec3From(hitPos), { variant: 'weak' });
    } else if (kind === 'smoke_grenade_strong') {
      this.triggerSmoke(vec3From(hitPos), { variant: 'strong' });
    } else if (kind === 'flash_grenade') {
      this.triggerFlash(vec3From(hitPos));
    }
  }

  queryInventoryCount(itemId) {
    const id = normalizeItemId(itemId);
    if (!id) return 0;
    const bus = this.eventBus;
    if (!bus?.emit) return 0;
    const query = { itemId: id, result: null };
    bus.emit(EVENTS.INVENTORY_QUERY_ITEM, query);
    return Math.max(0, Math.round(Number(query.result?.count) || 0));
  }

  getThrowRay() {
    const cam = this.player?.camera?.getCamera ? this.player.camera.getCamera() : null;
    if (!cam?.getWorldDirection || !cam?.getWorldPosition) return null;

    cam.getWorldPosition(this._tmpOrigin);
    cam.getWorldDirection(this._tmpDir);

    // Keep thrown tools roughly horizontal (no gravity in projectile sim).
    this._tmpDir.y = 0;
    if (this._tmpDir.lengthSq() <= 1e-8) {
      this._tmpDir.set(0, 0, -1);
    } else {
      this._tmpDir.normalize();
    }

    // Spawn slightly in front of the camera to avoid instantly colliding at the player's feet.
    this._tmpOrigin.addScaledVector(this._tmpDir, 0.45);
    this._tmpOrigin.y = Math.max(0.25, Number(this._tmpOrigin.y) || 0);
    return {
      origin: this._tmpOrigin.clone(),
      dir: this._tmpDir.clone()
    };
  }

  throwTool(itemId, projectileKind, options = {}) {
    const ray = this.getThrowRay();
    if (!ray) return false;

    const pm = this.projectileManager;
    if (!pm?.spawnPlayerProjectile) {
      this.emitToast('No projectile system', 1.2);
      return false;
    }

    const res = this.consumeInventory(itemId, 1);
    if (!res.ok) {
      this.emitToast(`Need ${String(itemId || 'tool')}`, 1.4);
      return false;
    }

    const speed = Number.isFinite(options.speed) ? options.speed : 18;
    const lifetime = Number.isFinite(options.lifetime) ? options.lifetime : 2.8;
    const color = options.color;
    const canHitMonsters = options.canHitMonsters ?? false;

    const spawned = pm.spawnPlayerProjectile(ray.origin, ray.dir, {
      kind: projectileKind,
      speed,
      lifetime,
      damage: 0,
      canHitMonsters,
      canHitPlayer: false,
      color,
      explosionRadius: options.explosionRadius,
      explosionDamage: options.explosionDamage,
      explosionColor: options.explosionColor,
      stunSeconds: options.stunSeconds
    });
    if (!spawned) {
      this.eventBus?.emit?.(EVENTS.INVENTORY_GIVE_ITEM, { actorKind: 'player', itemId, count: 1 });
      this.emitToast('Cannot throw right now', 1.2);
      return false;
    }

    return true;
  }

  throwDecoy() {
    const wantsAlt = !!(this.player?.input?.isKeyPressed?.('ShiftLeft') || this.player?.input?.isKeyPressed?.('ShiftRight'));
    const hasDelay = this.queryInventoryCount('decoy_delay') > 0;
    const itemId = wantsAlt && hasDelay ? 'decoy_delay' : 'decoy';
    const kind = wantsAlt && hasDelay ? 'decoy_grenade_delay' : 'decoy_grenade';
    const ok = this.throwTool(itemId, kind, {
      speed: Number(CONFIG.TOOL_DECOY_SPEED) || 18,
      lifetime: Number(CONFIG.TOOL_DECOY_LIFETIME) || 3.2,
      color: 0xff7043,
      canHitMonsters: true
    });
    if (ok) {
      this.audioManager?.playToolThrow?.('decoy');
      this.emitToast(itemId === 'decoy_delay' ? 'Delayed decoy thrown [7]' : 'Decoy thrown [7]', 1.1);
    }
    return ok;
  }

  throwDecoyDelay() {
    if (this.queryInventoryCount('decoy_delay') <= 0) {
      this.emitToast('Need Delayed Decoy (pickup to use)', 1.4);
      return false;
    }
    const ok = this.throwTool('decoy_delay', 'decoy_grenade_delay', {
      speed: Number(CONFIG.TOOL_DECOY_SPEED) || 18,
      lifetime: Number(CONFIG.TOOL_DECOY_LIFETIME) || 3.2,
      color: 0xff7043,
      canHitMonsters: true
    });
    if (ok) {
      this.audioManager?.playToolThrow?.('decoy');
      this.emitToast('Delayed decoy thrown [7]', 1.1);
    }
    return ok;
  }

  throwSmoke() {
    const wantsAlt = !!(this.player?.input?.isKeyPressed?.('ShiftLeft') || this.player?.input?.isKeyPressed?.('ShiftRight'));
    const haveStrong = this.queryInventoryCount('smoke_strong') > 0;
    const haveNormal = this.queryInventoryCount('smoke') > 0;
    const haveWeak = this.queryInventoryCount('smoke_weak') > 0;

    let itemId = null;
    let projKind = null;
    if (wantsAlt) {
      if (haveStrong) { itemId = 'smoke_strong'; projKind = 'smoke_grenade_strong'; }
      else if (haveNormal) { itemId = 'smoke'; projKind = 'smoke_grenade'; }
      else if (haveWeak) { itemId = 'smoke_weak'; projKind = 'smoke_grenade_weak'; }
    } else {
      if (haveNormal) { itemId = 'smoke'; projKind = 'smoke_grenade'; }
      else if (haveWeak) { itemId = 'smoke_weak'; projKind = 'smoke_grenade_weak'; }
      else if (haveStrong) { itemId = 'smoke_strong'; projKind = 'smoke_grenade_strong'; }
    }
    if (!itemId || !projKind) {
      this.emitToast('Need Smoke (pickup to use)', 1.4);
      return false;
    }

    const ok = this.throwTool(itemId, projKind, {
      speed: Number(CONFIG.TOOL_SMOKE_SPEED) || 16.5,
      lifetime: Number(CONFIG.TOOL_SMOKE_LIFETIME) || 2.8,
      color: 0xb0bec5,
      canHitMonsters: true
    });
    if (ok) {
      this.audioManager?.playToolThrow?.('smoke');
      const label = itemId === 'smoke_strong' ? 'Strong smoke' : (itemId === 'smoke_weak' ? 'Weak smoke' : 'Smoke');
      this.emitToast(`${label} thrown [8]`, 1.1);
    }
    return ok;
  }

  throwSmokeStrong() {
    if (this.queryInventoryCount('smoke_strong') <= 0) {
      this.emitToast('Need Strong Smoke (pickup to use)', 1.4);
      return false;
    }
    const ok = this.throwTool('smoke_strong', 'smoke_grenade_strong', {
      speed: Number(CONFIG.TOOL_SMOKE_SPEED) || 16.5,
      lifetime: Number(CONFIG.TOOL_SMOKE_LIFETIME) || 2.8,
      color: 0xb0bec5,
      canHitMonsters: true
    });
    if (ok) {
      this.audioManager?.playToolThrow?.('smoke');
      this.emitToast('Strong smoke thrown [8]', 1.1);
    }
    return ok;
  }

  throwSmokeWeak() {
    if (this.queryInventoryCount('smoke_weak') <= 0) {
      this.emitToast('Need Weak Smoke (pickup to use)', 1.4);
      return false;
    }
    const ok = this.throwTool('smoke_weak', 'smoke_grenade_weak', {
      speed: Number(CONFIG.TOOL_SMOKE_SPEED) || 16.5,
      lifetime: Number(CONFIG.TOOL_SMOKE_LIFETIME) || 2.8,
      color: 0xb0bec5,
      canHitMonsters: true
    });
    if (ok) {
      this.audioManager?.playToolThrow?.('smoke');
      this.emitToast('Weak smoke thrown [8]', 1.1);
    }
    return ok;
  }

  throwFlash() {
    const radius = Number(CONFIG.TOOL_FLASH_RADIUS) || 4.8;
    const stunSeconds = Number(CONFIG.TOOL_FLASH_STUN_SECONDS) || 0.65;
    const ok = this.throwTool('flash', 'flash_grenade', {
      speed: Number(CONFIG.TOOL_FLASH_SPEED) || 18.5,
      lifetime: Number(CONFIG.TOOL_FLASH_LIFETIME) || 2.6,
      color: 0xfff9c4,
      canHitMonsters: true,
      explosionRadius: radius,
      explosionDamage: 0,
      explosionColor: 0xffffff,
      stunSeconds
    });
    if (ok) {
      this.audioManager?.playToolThrow?.('flash');
      this.emitToast('Flash thrown [9]', 1.1);
    }
    return ok;
  }

  triggerDecoy(position) {
    const pos = vec3From(position);
    pos.y = 0;
    this.audioManager?.playToolTrigger?.('decoy');
    const noiseRadius = Math.max(1, Math.round(CONFIG.TOOL_DECOY_NOISE_RADIUS ?? 18));
    const noiseTtl = Math.max(0.2, Number(CONFIG.TOOL_DECOY_NOISE_TTL) || 1.25);
    const strength = clamp(Number(CONFIG.TOOL_DECOY_NOISE_STRENGTH) || 1.0, 0, 1);

    this.eventBus?.emit?.(EVENTS.NOISE_REQUESTED, {
      source: 'player',
      kind: 'decoy',
      strength,
      position: pos.clone(),
      radius: noiseRadius,
      ttl: noiseTtl
    });

    const scentRadius = Math.max(1, Math.round(CONFIG.TOOL_DECOY_SCENT_RADIUS ?? 14));
    const scentTtl = Math.max(0.5, Number(CONFIG.TOOL_DECOY_SCENT_TTL) || 16.0);
    this.monsterManager?.registerScent?.(pos, {
      kind: 'decoy',
      radius: scentRadius,
      ttl: scentTtl,
      strength: 1.0,
      source: 'player'
    });

    // Decoy footsteps sequence: emit a few "fake footsteps" around the impact point.
    const tileSize = CONFIG.TILE_SIZE || 1;
    const duration = 8.0;
    const pulseInterval = 0.35;
    const roamRadius = Math.max(2.5, tileSize * 2.2);
    this.decoyGhosts.push({
      kind: 'decoyGhost',
      position: pos.clone(),
      life: duration,
      maxLife: duration,
      pulseTimer: 0,
      pulseInterval,
      roamRadius,
      target: null
    });
  }

  createSmokeCloudMesh(radius = 3.8) {
    const r = Math.max(0.5, Number(radius) || 3.8);
    const geo = new THREE.SphereGeometry(1, 14, 12);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xb0bec5,
      emissive: 0x263238,
      emissiveIntensity: 0.18,
      roughness: 1.0,
      metalness: 0.0,
      transparent: true,
      opacity: 0.22,
      depthWrite: false
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.scale.setScalar(r);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    return mesh;
  }

  ensureSmokeCapacity(maxClouds = 6) {
    const cap = Math.max(0, Math.round(Number(maxClouds) || 0));
    if (cap <= 0) return;
    while (this.smokeClouds.length > cap) {
      const oldest = this.smokeClouds.shift();
      if (oldest?.mesh) {
        try {
          this.scene?.remove?.(oldest.mesh);
        } catch {
          // ignore
        }
      }
    }
  }

  triggerSmoke(position, options = {}) {
    const pos = vec3From(position);
    pos.y = 0;
    this.audioManager?.playToolTrigger?.('smoke');
    const baseRadius = Math.max(0.5, Number(CONFIG.TOOL_SMOKE_RADIUS) || 3.8);
    const baseDuration = Math.max(0.5, Number(CONFIG.TOOL_SMOKE_DURATION) || 12.0);
    const variant = String(options?.variant || '').toLowerCase();
    const rMult = variant === 'weak'
      ? (Number.isFinite(CONFIG.TOOL_SMOKE_WEAK_RADIUS_MULT) ? CONFIG.TOOL_SMOKE_WEAK_RADIUS_MULT : 0.75)
      : (variant === 'strong'
        ? (Number.isFinite(CONFIG.TOOL_SMOKE_STRONG_RADIUS_MULT) ? CONFIG.TOOL_SMOKE_STRONG_RADIUS_MULT : 1.35)
        : 1.0);
    const dMult = variant === 'weak'
      ? (Number.isFinite(CONFIG.TOOL_SMOKE_WEAK_DURATION_MULT) ? CONFIG.TOOL_SMOKE_WEAK_DURATION_MULT : 0.65)
      : (variant === 'strong'
        ? (Number.isFinite(CONFIG.TOOL_SMOKE_STRONG_DURATION_MULT) ? CONFIG.TOOL_SMOKE_STRONG_DURATION_MULT : 1.35)
        : 1.0);

    const radius = Math.max(0.5, baseRadius * rMult);
    const duration = Math.max(0.5, baseDuration * dMult);

    const mesh = this.createSmokeCloudMesh(radius);
    mesh.position.set(pos.x, 0.65, pos.z);
    this.scene?.add?.(mesh);

    this.smokeClouds.push({
      kind: 'smoke',
      x: pos.x,
      z: pos.z,
      radius,
      life: duration,
      maxLife: duration,
      mesh,
      anim: 0
    });
    if (this.worldState) {
      this.worldState.smokeClouds = this.smokeClouds;
    }
    this.ensureSmokeCapacity(8);
  }

  deployGlowstick() {
    const res = this.consumeInventory('glowstick', 1);
    if (!res.ok) {
      this.emitToast('Need Glowstick (pickup to use)', 1.4);
      return false;
    }

    const pos = this.getPlayerPlacementPosition(0.75);
    if (!pos) return false;
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, 0.5, 10),
      new THREE.MeshStandardMaterial({
        color: 0x66ff99,
        emissive: 0x33ff88,
        emissiveIntensity: 0.9,
        roughness: 0.35,
        metalness: 0.05
      })
    );
    mesh.rotation.z = Math.PI / 2;
    mesh.position.set(pos.x, 0.18, pos.z);
    this.scene?.add?.(mesh);

    const duration = Math.max(3, Number(CONFIG.TOOL_GLOWSTICK_DURATION) || 150);
    this.devices.push({
      kind: 'glowstick',
      mesh,
      position: pos.clone(),
      life: duration,
      maxLife: duration,
      anim: Math.random() * 10
    });
    this.ensureDeviceCapacity();
    this.emitToast('Glowstick placed [T]', 1.2);
    return true;
  }

  useScentSpray() {
    const res = this.consumeInventory('scent_spray', 1);
    if (!res.ok) {
      this.emitToast('Need Scent Spray (pickup to use)', 1.4);
      return false;
    }
    const seconds = Math.max(1, Number(CONFIG.TOOL_SCENT_SPRAY_SECONDS) || 14);
    const radiusMult = Number.isFinite(CONFIG.TOOL_SCENT_SPRAY_SCENT_RADIUS_MULT) ? CONFIG.TOOL_SCENT_SPRAY_SCENT_RADIUS_MULT : 0.65;
    const strengthMult = Number.isFinite(CONFIG.TOOL_SCENT_SPRAY_SCENT_STRENGTH_MULT) ? CONFIG.TOOL_SCENT_SPRAY_SCENT_STRENGTH_MULT : 0.45;
    const now = this.gameState?.getElapsedTime?.() ?? 0;
    const untilSec = Math.max(0, Math.round(now + seconds));
    this.player?.setPerceptionModifiers?.({
      scentRadiusMult: radiusMult,
      scentStrengthMult: strengthMult,
      untilSec
    });
    const playerPos = this.player?.getPosition?.() || null;
    if (playerPos) {
      this.eventBus?.emit?.(EVENTS.NOISE_REQUESTED, {
        source: 'player',
        kind: 'scent_spray',
        strength: 0.3,
        position: playerPos.clone(),
        radius: 6,
        ttl: 0.6
      });
    }
    this.audioManager?.playToolTrigger?.('jammer');
    this.emitToast('Scent masked [H]', 1.4);
    return true;
  }

  useSonarPulse() {
    const res = this.consumeInventory('sonar_pulse', 1);
    if (!res.ok) {
      this.emitToast('Need Sonar (pickup to use)', 1.4);
      return false;
    }
    const playerGrid = this.player?.getGridPosition?.() || null;
    if (!playerGrid || !Number.isFinite(playerGrid.x) || !Number.isFinite(playerGrid.y)) {
      this.emitToast('Sonar: no contact nearby [Z]', 1.4);
      return true;
    }
    const monsters = this.monsterManager?.getMonsterPositions?.() || [];
    let best = null;
    let bestD = Infinity;
    for (const m of monsters) {
      if (!m || !Number.isFinite(m.x) || !Number.isFinite(m.y)) continue;
      const d = Math.abs(m.x - playerGrid.x) + Math.abs(m.y - playerGrid.y);
      if (d < bestD) {
        bestD = d;
        best = m;
      }
    }
    const maxTiles = Math.max(1, Math.round(Number(CONFIG.TOOL_SONAR_RADIUS) || 10));
    if (best && bestD <= maxTiles) {
      const dx = best.x - playerGrid.x;
      const dy = best.y - playerGrid.y;
      const horiz = dx === 0 ? '' : (dx > 0 ? 'E' : 'W');
      const vert = dy === 0 ? '' : (dy > 0 ? 'S' : 'N');
      const dir = `${vert}${horiz}` || 'nearby';
      this.emitToast(`Sonar: contact ${dir} (${bestD} tiles) [Z]`, 1.6);
    } else {
      this.emitToast('Sonar: no contact nearby [Z]', 1.4);
    }
    const playerPos = this.player?.getPosition?.() || null;
    if (playerPos) {
      this.eventBus?.emit?.(EVENTS.NOISE_REQUESTED, {
        source: 'player',
        kind: 'sonar',
        strength: 0.75,
        position: playerPos.clone(),
        radius: Math.max(6, Math.round(Number(CONFIG.TOOL_SONAR_NOISE_RADIUS) || 14)),
        ttl: 0.9
      });
    }
    this.audioManager?.playToolTrigger?.('sensor');
    return true;
  }

  deployFakeHack() {
    const res = this.consumeInventory('fake_hack', 1);
    if (!res.ok) {
      this.emitToast('Need Fake Hack (pickup to use)', 1.4);
      return false;
    }
    const pos = this.getPlayerPlacementPosition(1.05);
    if (!pos) return false;

    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.62, 0.3),
      new THREE.MeshStandardMaterial({
        color: 0x1e88e5,
        emissive: 0x64b5f6,
        emissiveIntensity: 0.7,
        roughness: 0.45,
        metalness: 0.08
      })
    );
    mesh.position.set(pos.x, 0.32, pos.z);
    this.scene?.add?.(mesh);

    const duration = Math.max(2, Number(CONFIG.TOOL_FAKE_TERMINAL_DURATION) || 16);
    const interval = Math.max(0.2, Number(CONFIG.TOOL_FAKE_TERMINAL_PULSE_INTERVAL) || 0.9);
    const noiseRadius = Math.max(6, Math.round(Number(CONFIG.TOOL_FAKE_TERMINAL_NOISE_RADIUS) || 24));
    this.devices.push({
      kind: 'fakeTerminal',
      mesh,
      position: pos.clone(),
      life: duration,
      maxLife: duration,
      pulseTimer: 0,
      pulseInterval: interval,
      noiseRadius,
      anim: 0
    });
    this.ensureDeviceCapacity();
    this.audioManager?.playToolDeploy?.('sensor');
    this.emitToast('Fake upload beacon deployed [Y]', 1.4);
    return true;
  }

  deployDoorWedge() {
    const res = this.consumeInventory('door_wedge', 1);
    if (!res.ok) {
      this.emitToast('Need Door Wedge (pickup to use)', 1.4);
      return false;
    }
    const ws = this.worldState;
    const playerGrid = this.player?.getGridPosition?.() || null;
    if (!ws || !playerGrid || !ws.getTile || !ws.setObstacle) return false;

    const dirs = [
      { dx: 1, dy: 0 },
      { dx: -1, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: 0, dy: -1 }
    ];
    let door = null;
    for (const d of dirs) {
      const x = playerGrid.x + d.dx;
      const y = playerGrid.y + d.dy;
      if (ws.getTile(x, y) === TILE_TYPES.DOOR) {
        door = { x, y };
        break;
      }
    }
    if (!door) {
      this.eventBus?.emit?.(EVENTS.INVENTORY_GIVE_ITEM, { actorKind: 'player', itemId: 'door_wedge', count: 1 });
      this.emitToast('No door nearby to wedge', 1.3);
      return false;
    }

    ws.setObstacle(door.x, door.y, true);
    this.tempObstacles.push({ x: door.x, y: door.y });

    const ts = CONFIG.TILE_SIZE || 1;
    const pos = new THREE.Vector3((door.x + 0.5) * ts, 0, (door.y + 0.5) * ts);
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.12, 0.32),
      new THREE.MeshStandardMaterial({
        color: 0xff1744,
        emissive: 0xff5252,
        emissiveIntensity: 0.55,
        roughness: 0.55,
        metalness: 0.05
      })
    );
    mesh.position.set(pos.x, 0.08, pos.z);
    this.scene?.add?.(mesh);

    const duration = Math.max(1, Number(CONFIG.TOOL_DOOR_WEDGE_DURATION) || 12);
    this.devices.push({
      kind: 'doorWedge',
      mesh,
      position: pos.clone(),
      gridPos: { x: door.x, y: door.y },
      life: duration,
      maxLife: duration,
      anim: 0
    });
    this.ensureDeviceCapacity();
    this.audioManager?.playToolDeploy?.('trap');
    this.emitToast('Door wedged [G]', 1.3);
    return true;
  }

  triggerFlash(position) {
    const pos = vec3From(position);
    pos.y = 0;
    this.audioManager?.playToolTrigger?.('flash');
    const radius = Math.max(0.5, Number(CONFIG.TOOL_FLASH_RADIUS) || 4.8);
    const blindSeconds = Math.max(0, Number(CONFIG.TOOL_FLASH_BLIND_SECONDS) || 3.8);
    if (blindSeconds > 0) {
      this.monsterManager?.applyAreaBlindness?.(pos, radius, blindSeconds, { falloff: true });
    }
  }

  getPlayerPlacementPosition(distance = 1.15) {
    const playerPos = this.player?.getPosition ? this.player.getPosition() : null;
    if (!playerPos) return null;

    const pos = this._tmpPos.copy(playerPos);
    pos.y = 0;

    const forward = this.player?.camera?.getForwardVector ? this.player.camera.getForwardVector() : null;
    if (forward && forward.isVector3) {
      this._tmpForward.copy(forward);
    } else {
      this._tmpForward.set(0, 0, -1);
    }
    this._tmpForward.y = 0;
    if (this._tmpForward.lengthSq() > 1e-8) this._tmpForward.normalize();

    const dist = clamp(Number(distance) || 0, 0.25, 2.2);
    pos.addScaledVector(this._tmpForward, dist);
    pos.y = 0;

    if (typeof this.player?.canMoveTo === 'function') {
      if (!this.player.canMoveTo(pos.x, pos.z)) {
        // Fallback: drop at feet
        pos.copy(playerPos);
        pos.y = 0;
      }
    }

    return pos.clone();
  }

  ensureDeviceCapacity() {
    if (this.maxDevices <= 0) return;
    while (this.devices.length > this.maxDevices) {
      const oldest = this.devices.shift();
      if (oldest?.kind === 'doorWedge' && oldest?.gridPos && this.worldState?.setObstacle) {
        this.worldState.setObstacle(oldest.gridPos.x, oldest.gridPos.y, false);
        if (Array.isArray(this.tempObstacles)) {
          this.tempObstacles = this.tempObstacles.filter((o) => !(o && o.x === oldest.gridPos.x && o.y === oldest.gridPos.y));
        }
      }
      if (oldest?.mesh) {
        try {
          this.scene?.remove?.(oldest.mesh);
        } catch {
          // ignore
        }
      }
    }
  }

  createLureDeviceMesh() {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0xffb74d,
      emissive: 0xff7043,
      emissiveIntensity: 0.9,
      roughness: 0.45,
      metalness: 0.1
    });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.24, 14), bodyMat);
    base.position.y = 0.12;
    group.add(base);

    const glowMat = new THREE.MeshStandardMaterial({
      color: 0xff5252,
      emissive: 0xff5252,
      emissiveIntensity: 1.4,
      roughness: 0.25,
      metalness: 0.0,
      transparent: true,
      opacity: 0.95
    });
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 14), glowMat);
    orb.position.y = 0.30;
    group.add(orb);

    group.userData.__orb = orb;
    return group;
  }

  createTrapDeviceMesh() {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color: 0x66aaff,
      emissive: 0x2a6bd4,
      emissiveIntensity: 0.85,
      roughness: 0.35,
      metalness: 0.05,
      transparent: true,
      opacity: 0.95
    });

    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.04, 10, 24), mat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.03;
    group.add(ring);

    const spikeMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0x66aaff,
      emissiveIntensity: 0.9,
      roughness: 0.35,
      metalness: 0.0,
      transparent: true,
      opacity: 0.9
    });
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.18, 12), spikeMat);
    spike.position.y = 0.10;
    group.add(spike);

    group.userData.__ring = ring;
    return group;
  }

  createJammerDeviceMesh() {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color: 0xce93d8,
      emissive: 0xba68c8,
      emissiveIntensity: 0.95,
      roughness: 0.35,
      metalness: 0.06
    });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.22, 14), mat);
    base.position.y = 0.11;
    group.add(base);

    const antennaMat = new THREE.MeshStandardMaterial({
      color: 0x263238,
      emissive: 0x000000,
      emissiveIntensity: 0.0,
      roughness: 0.8,
      metalness: 0.1
    });
    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.32, 10), antennaMat);
    antenna.position.y = 0.32;
    group.add(antenna);

    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 12), mat);
    tip.position.y = 0.50;
    group.add(tip);

    group.userData.__tip = tip;
    return group;
  }

  createSensorDeviceMesh() {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color: 0x4dd0e1,
      emissive: 0x00bcd4,
      emissiveIntensity: 0.95,
      roughness: 0.35,
      metalness: 0.08,
      transparent: true,
      opacity: 0.95
    });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.18, 0.16, 14), mat);
    base.position.y = 0.08;
    group.add(base);

    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 10), mat);
    eye.position.y = 0.22;
    group.add(eye);

    group.userData.__eye = eye;
    return group;
  }

  createMineDeviceMesh() {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color: 0xff1744,
      emissive: 0xd50000,
      emissiveIntensity: 0.85,
      roughness: 0.45,
      metalness: 0.05,
      transparent: true,
      opacity: 0.92
    });
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.07, 16), mat);
    disc.position.y = 0.04;
    group.add(disc);

    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), mat);
    dot.position.y = 0.10;
    group.add(dot);

    group.userData.__dot = dot;
    return group;
  }

  deployLure() {
    const wantsAlt = !!(this.player?.input?.isKeyPressed?.('ShiftLeft') || this.player?.input?.isKeyPressed?.('ShiftRight'));
    const hasSticky = this.queryInventoryCount('lure_sticky') > 0;
    const itemId = wantsAlt && hasSticky ? 'lure_sticky' : 'lure';

    const res = this.consumeInventory(itemId, 1);
    if (!res.ok) {
      this.emitToast('Need Lure (pickup to use)', 1.4);
      return false;
    }

    const ws = this.worldState;
    const tileSize = CONFIG.TILE_SIZE || 1;
    let pos = this.getPlayerPlacementPosition(1.2);
    if (!pos) return false;

    // Sticky lure: bias placement toward the nearest wall in front of the player (if any).
    if (itemId === 'lure_sticky' && ws?.getTile && this.player?.getGridPosition) {
      const grid = this.player.getGridPosition();
      const forward = this.player?.camera?.getForwardVector ? this.player.camera.getForwardVector() : null;
      let dx = 0;
      let dy = 0;
      if (forward && forward.isVector3) {
        const ax = Math.abs(forward.x);
        const az = Math.abs(forward.z);
        if (ax >= az) dx = forward.x >= 0 ? 1 : -1;
        else dy = forward.z >= 0 ? 1 : -1;
      }
      const wx = grid.x + dx;
      const wy = grid.y + dy;
      if (ws.getTile(wx, wy) === TILE_TYPES.WALL) {
        const center = new THREE.Vector3((grid.x + 0.5) * tileSize, 0, (grid.y + 0.5) * tileSize);
        const off = new THREE.Vector3(dx, 0, dy).multiplyScalar(tileSize * 0.35);
        pos = center.add(off);
      }
    }

    const mesh = this.createLureDeviceMesh();
    mesh.position.copy(pos);
    this.scene?.add?.(mesh);

    const duration = Math.max(0.5, Number(CONFIG.TOOL_LURE_DURATION) || 10) * (itemId === 'lure_sticky' ? 1.4 : 1.0);
    const pulseInterval = Math.max(0.15, Number(CONFIG.TOOL_LURE_PULSE_INTERVAL) || 0.45);
    const noiseRadius = Math.max(1, Math.round((CONFIG.TOOL_LURE_NOISE_RADIUS ?? 14) * (itemId === 'lure_sticky' ? 1.15 : 1.0)));
    const noiseTtl = Math.max(0.2, Number(CONFIG.TOOL_LURE_NOISE_TTL) || 0.9);
    const strength = clamp(Number(CONFIG.TOOL_LURE_NOISE_STRENGTH) || 0.8, 0, 1);

    const scentRadius = Math.max(1, Math.round(CONFIG.TOOL_LURE_SCENT_RADIUS ?? 12));
    const scentTtl = Math.max(0.5, Number(CONFIG.TOOL_LURE_SCENT_TTL) || 14) * (itemId === 'lure_sticky' ? 1.35 : 1.0);
    this.monsterManager?.registerScent?.(pos, {
      kind: 'lure',
      radius: scentRadius,
      ttl: scentTtl,
      strength: 1.0,
      source: 'player'
    });

    this.devices.push({
      kind: itemId,
      mesh,
      position: pos.clone(),
      life: duration,
      maxLife: duration,
      pulseTimer: 0,
      pulseInterval,
      noiseRadius,
      noiseTtl,
      strength,
      scentRadius,
      scentTtl,
      anim: 0
    });
    this.ensureDeviceCapacity();
    this.audioManager?.playToolDeploy?.('lure');
    this.emitToast(itemId === 'lure_sticky' ? 'Wall lure deployed [4]' : 'Lure deployed [4]', 1.2);
    return true;
  }

  deployLureSticky() {
    const res = this.consumeInventory('lure_sticky', 1);
    if (!res.ok) {
      return this.deployLure();
    }

    const ws = this.worldState;
    const tileSize = CONFIG.TILE_SIZE || 1;
    let pos = this.getPlayerPlacementPosition(1.2);
    if (!pos) {
      this.eventBus?.emit?.(EVENTS.INVENTORY_GIVE_ITEM, { actorKind: 'player', itemId: 'lure_sticky', count: 1 });
      return false;
    }

    // Sticky lure: bias placement toward the nearest wall in front of the player (if any).
    if (ws?.getTile && this.player?.getGridPosition) {
      const grid = this.player.getGridPosition();
      const forward = this.player?.camera?.getForwardVector ? this.player.camera.getForwardVector() : null;
      let dx = 0;
      let dy = 0;
      if (forward && forward.isVector3) {
        const ax = Math.abs(forward.x);
        const az = Math.abs(forward.z);
        if (ax >= az) dx = forward.x >= 0 ? 1 : -1;
        else dy = forward.z >= 0 ? 1 : -1;
      }
      const wx = grid.x + dx;
      const wy = grid.y + dy;
      if (ws.getTile(wx, wy) === TILE_TYPES.WALL) {
        const center = new THREE.Vector3((grid.x + 0.5) * tileSize, 0, (grid.y + 0.5) * tileSize);
        const off = new THREE.Vector3(dx, 0, dy).multiplyScalar(tileSize * 0.35);
        pos = center.add(off);
      }
    }

    const mesh = this.createLureDeviceMesh();
    mesh.position.copy(pos);
    this.scene?.add?.(mesh);

    const duration = Math.max(0.5, Number(CONFIG.TOOL_LURE_DURATION) || 10) * 1.4;
    const pulseInterval = Math.max(0.15, Number(CONFIG.TOOL_LURE_PULSE_INTERVAL) || 0.45);
    const noiseRadius = Math.max(1, Math.round((CONFIG.TOOL_LURE_NOISE_RADIUS ?? 14) * 1.15));
    const noiseTtl = Math.max(0.2, Number(CONFIG.TOOL_LURE_NOISE_TTL) || 0.9);
    const strength = clamp(Number(CONFIG.TOOL_LURE_NOISE_STRENGTH) || 0.8, 0, 1);

    const scentRadius = Math.max(1, Math.round(CONFIG.TOOL_LURE_SCENT_RADIUS ?? 12));
    const scentTtl = Math.max(0.5, Number(CONFIG.TOOL_LURE_SCENT_TTL) || 14) * 1.35;
    this.monsterManager?.registerScent?.(pos, {
      kind: 'lure',
      radius: scentRadius,
      ttl: scentTtl,
      strength: 1.0,
      source: 'player'
    });

    this.devices.push({
      kind: 'lure_sticky',
      mesh,
      position: pos.clone(),
      life: duration,
      maxLife: duration,
      pulseTimer: 0,
      pulseInterval,
      noiseRadius,
      noiseTtl,
      strength,
      scentRadius,
      scentTtl,
      anim: 0
    });
    this.ensureDeviceCapacity();
    this.audioManager?.playToolDeploy?.('lure');
    this.emitToast('Wall lure deployed [4]', 1.2);
    return true;
  }

  deployTrap() {
    const res = this.consumeInventory('trap', 1);
    if (!res.ok) {
      this.emitToast('Need Trap (pickup to use)', 1.4);
      return false;
    }

    const pos = this.getPlayerPlacementPosition(1.05);
    if (!pos) return false;

    const mesh = this.createTrapDeviceMesh();
    mesh.position.copy(pos);
    this.scene?.add?.(mesh);

    const duration = Math.max(0.5, Number(CONFIG.TOOL_TRAP_DURATION) || 40);
    const radius = Math.max(0.25, Number(CONFIG.TOOL_TRAP_RADIUS) || 1.35);
    const stunSeconds = Math.max(0, Number(CONFIG.TOOL_TRAP_STUN_SECONDS) || 2.6);

    this.devices.push({
      kind: 'trap',
      mesh,
      position: pos.clone(),
      life: duration,
      maxLife: duration,
      radius,
      stunSeconds,
      anim: 0
    });
    this.ensureDeviceCapacity();
    this.audioManager?.playToolDeploy?.('trap');
    this.emitToast('Trap deployed [5]', 1.2);
    return true;
  }

  deployJammer() {
    const res = this.consumeInventory('jammer', 1);
    if (!res.ok) {
      this.emitToast('Need Jammer (pickup to use)', 1.4);
      return false;
    }

    const pos = this.getPlayerPlacementPosition(1.1);
    if (!pos) return false;

    const mesh = this.createJammerDeviceMesh();
    mesh.position.copy(pos);
    this.scene?.add?.(mesh);

    const duration = Math.max(0.5, Number(CONFIG.TOOL_JAMMER_DURATION) || 12);
    const radius = Math.max(0.5, Number(CONFIG.TOOL_JAMMER_RADIUS) || 6.5);
    const refreshSeconds = Math.max(0.1, Number(CONFIG.TOOL_JAMMER_REFRESH_SECONDS) || 0.6);

    this.devices.push({
      kind: 'jammer',
      mesh,
      position: pos.clone(),
      life: duration,
      maxLife: duration,
      radius,
      refreshSeconds,
      anim: 0
    });
    this.ensureDeviceCapacity();
    this.audioManager?.playToolDeploy?.('jammer');
    this.emitToast('Jammer deployed [6]', 1.2);
    return true;
  }

  deploySensor() {
    const res = this.consumeInventory('sensor', 1);
    if (!res.ok) {
      this.emitToast('Need Sensor (pickup to use)', 1.4);
      return false;
    }

    const pos = this.getPlayerPlacementPosition(1.15);
    if (!pos) return false;

    const mesh = this.createSensorDeviceMesh();
    mesh.position.copy(pos);
    this.scene?.add?.(mesh);

    const duration = Math.max(0.5, Number(CONFIG.TOOL_SENSOR_DURATION) || 75);
    const radius = Math.max(0.5, Number(CONFIG.TOOL_SENSOR_RADIUS) || 7.5);
    const pingCooldown = Math.max(0.1, Number(CONFIG.TOOL_SENSOR_PING_COOLDOWN) || 1.75);

    this.devices.push({
      kind: 'sensor',
      mesh,
      position: pos.clone(),
      life: duration,
      maxLife: duration,
      radius,
      pingCooldown,
      pingTimer: 0,
      anim: 0
    });
    this.ensureDeviceCapacity();
    this.audioManager?.playToolDeploy?.('sensor');
    this.emitToast('Sensor deployed [0]', 1.2);
    return true;
  }

  deployMine() {
    const res = this.consumeInventory('mine', 1);
    if (!res.ok) {
      this.emitToast('Need Mine (pickup to use)', 1.4);
      return false;
    }

    const pos = this.getPlayerPlacementPosition(1.05);
    if (!pos) return false;

    const mesh = this.createMineDeviceMesh();
    mesh.position.copy(pos);
    this.scene?.add?.(mesh);

    const duration = Math.max(0.5, Number(CONFIG.TOOL_MINE_DURATION) || 55);
    const radius = Math.max(0.25, Number(CONFIG.TOOL_MINE_RADIUS) || 1.35);
    const damage = Math.max(0, Math.round(Number(CONFIG.TOOL_MINE_DAMAGE) || 8));
    const stunSeconds = Math.max(0, Number(CONFIG.TOOL_MINE_STUN_SECONDS) || 1.4);

    this.devices.push({
      kind: 'mine',
      mesh,
      position: pos.clone(),
      life: duration,
      maxLife: duration,
      radius,
      damage,
      stunSeconds,
      anim: 0
    });
    this.ensureDeviceCapacity();
    this.audioManager?.playToolDeploy?.('mine');
    this.emitToast('Mine deployed [V]', 1.2);
    return true;
  }

  updateInput() {
    const input = this.player?.input || null;
    if (!input?.consumeKeyPress) return;

    if (input.consumeKeyPress('Digit4')) this.deployLure();
    if (input.consumeKeyPress('Digit5')) this.deployTrap();
    if (input.consumeKeyPress('Digit6')) this.deployJammer();
    if (input.consumeKeyPress('Digit7')) this.throwDecoy();
    if (input.consumeKeyPress('Digit8')) this.throwSmoke();
    if (input.consumeKeyPress('Digit9')) this.throwFlash();
    if (input.consumeKeyPress('Digit0')) this.deploySensor();
    if (input.consumeKeyPress('KeyV')) this.deployMine();
    if (input.consumeKeyPress('KeyH')) this.useScentSpray();
    if (input.consumeKeyPress('KeyT')) this.deployGlowstick();
    if (input.consumeKeyPress('KeyZ')) this.useSonarPulse();
    if (input.consumeKeyPress('KeyY')) this.deployFakeHack();
    if (input.consumeKeyPress('KeyG')) this.deployDoorWedge();
  }

  updateDevices(dt) {
    const mm = this.monsterManager;
    for (let i = this.devices.length - 1; i >= 0; i--) {
      const d = this.devices[i];
      if (!d?.mesh) {
        this.devices.splice(i, 1);
        continue;
      }

      d.life -= dt;
      if (d.life <= 0) {
        this.scene?.remove?.(d.mesh);
        if (d.kind === 'doorWedge' && d.gridPos && this.worldState?.setObstacle) {
          this.worldState.setObstacle(d.gridPos.x, d.gridPos.y, false);
          if (Array.isArray(this.tempObstacles)) {
            this.tempObstacles = this.tempObstacles.filter((o) => !(o && o.x === d.gridPos.x && o.y === d.gridPos.y));
          }
        }
        this.devices.splice(i, 1);
        continue;
      }

      d.anim = (d.anim || 0) + dt;

      if (d.kind === 'lure' || d.kind === 'lure_sticky') {
        d.pulseTimer = (d.pulseTimer || 0) + dt;
        const orb = d.mesh?.userData?.__orb || null;
        if (orb) {
          const pulse = 1 + Math.sin(d.anim * 7.0) * 0.08;
          orb.scale.setScalar(pulse);
        }
        const lifeRatio = d.maxLife > 0 ? Math.max(0, Math.min(1, (d.life || 0) / d.maxLife)) : 0;
        const progress = 1 - lifeRatio;
        const baseStrength = Number(d.strength) || 0.8;
        const strength = clamp(baseStrength * (0.7 + progress * 0.7), 0, 1);
        const radius = Math.max(1, Math.round((Number(d.noiseRadius) || 14) * (0.85 + progress * 0.35)));
        const ttl = Math.max(0.2, Number(d.noiseTtl) || 0.9);
        const interval = Math.max(0.18, Number(d.pulseInterval) || 0.45);

        if (d.pulseTimer >= interval) {
          d.pulseTimer = 0;
          this.eventBus?.emit?.(EVENTS.NOISE_REQUESTED, {
            source: 'player',
            kind: 'lure',
            strength,
            position: d.position,
            radius,
            ttl
          });

          // Periodically refresh lure scent so monsters can track it even when LOS is blocked.
          if (mm?.registerScent && Math.random() < 0.65) {
            const sRad = Math.max(1, Math.round(Number(d.scentRadius) || 12));
            const sTtl = Math.max(0.5, Number(d.scentTtl) || 14);
            mm.registerScent(d.position, { kind: 'lure', radius: sRad, ttl: sTtl, strength: 1.0, source: 'player' });
          }
        }
      } else if (d.kind === 'fakeTerminal') {
        d.pulseTimer = (d.pulseTimer || 0) + dt;
        const interval = Math.max(0.2, Number(d.pulseInterval) || 0.9);
        if (d.pulseTimer >= interval) {
          d.pulseTimer = 0;
          this.eventBus?.emit?.(EVENTS.NOISE_REQUESTED, {
            source: 'player',
            kind: 'fake_terminal',
            strength: 0.95,
            position: d.position,
            radius: Math.max(6, Math.round(Number(d.noiseRadius) || 24)),
            ttl: 1.15
          });
          if (mm?.registerScent && Math.random() < 0.35) {
            mm.registerScent(d.position, { kind: 'fake_terminal', radius: 14, ttl: 10, strength: 1.0, source: 'player' });
          }
        }
      } else if (d.kind === 'trap') {
        const ring = d.mesh?.userData?.__ring || null;
        if (ring) {
          ring.rotation.z = (ring.rotation.z || 0) + dt * 1.8;
        }
        const radius = Number(d.radius) || 1.35;
        if (mm?.monsters && radius > 0) {
          const r2 = radius * radius;
          let triggered = false;
          for (const monster of mm.monsters) {
            if (!monster || monster.isDead || monster.isDying) continue;
            const mPos = monster.getWorldPosition?.();
            if (!mPos) continue;
            const dx = mPos.x - d.position.x;
            const dz = mPos.z - d.position.z;
            if (dx * dx + dz * dz > r2) continue;
            triggered = true;
            break;
          }
          if (triggered) {
            const stunSeconds = Math.max(0, Number(d.stunSeconds) || 0);
            mm?.damage?.applyAreaDamage?.(d.position, radius, 0, {
              owner: 'player',
              stunSeconds,
              damagePlayer: false
            });
            this.audioManager?.playToolTrigger?.('trap');
            this.eventBus?.emit?.(EVENTS.NOISE_REQUESTED, {
              source: 'player',
              kind: 'trap',
              strength: 0.6,
              position: d.position,
              radius: 10,
              ttl: 0.8
            });
            this.emitToast('Trap triggered!', 1.1);
            this.scene?.remove?.(d.mesh);
            this.devices.splice(i, 1);
          }
        }
      } else if (d.kind === 'jammer') {
        const tip = d.mesh?.userData?.__tip || null;
        if (tip) {
          const pulse = 1 + Math.sin(d.anim * 5.5) * 0.06;
          tip.scale.setScalar(pulse);
        }
        const radius = Number(d.radius) || 6.5;
        const refresh = Math.max(0.1, Number(d.refreshSeconds) || 0.6);
        if (mm?.monsters && radius > 0) {
          const r2 = radius * radius;
          for (const monster of mm.monsters) {
            if (!monster || monster.isDead || monster.isDying) continue;
            const mPos = monster.getWorldPosition?.();
            if (!mPos) continue;
            const dx = mPos.x - d.position.x;
            const dz = mPos.z - d.position.z;
            if (dx * dx + dz * dz > r2) continue;
            monster.perceptionJammedTimer = Math.max(monster.perceptionJammedTimer || 0, refresh);
          }
        }
      } else if (d.kind === 'sensor') {
        const eye = d.mesh?.userData?.__eye || null;
        if (eye) {
          const pulse = 1 + Math.sin(d.anim * 6.5) * 0.08;
          eye.scale.setScalar(pulse);
        }

        d.pingTimer = Math.max(0, (d.pingTimer || 0) - dt);

        const radius = Number(d.radius) || 7.5;
        if (mm?.monsters && radius > 0 && (d.pingTimer || 0) <= 0) {
          const r2 = radius * radius;
          let triggered = false;
          for (const monster of mm.monsters) {
            if (!monster || monster.isDead || monster.isDying) continue;
            const mPos = monster.getWorldPosition?.();
            if (!mPos) continue;
            const dx = mPos.x - d.position.x;
            const dz = mPos.z - d.position.z;
            if (dx * dx + dz * dz > r2) continue;
            triggered = true;
            break;
          }
          if (triggered) {
            const cd = Math.max(0.1, Number(d.pingCooldown) || 1.75);
            d.pingTimer = cd;
            this.audioManager?.playToolTrigger?.('sensor');
            this.emitToast('Sensor ping!', 0.9);
          }
        }
      } else if (d.kind === 'mine') {
        const dot = d.mesh?.userData?.__dot || null;
        if (dot) {
          const pulse = 1 + Math.sin(d.anim * 8.0) * 0.06;
          dot.scale.setScalar(pulse);
        }
        const radius = Number(d.radius) || 1.35;
        if (mm?.monsters && radius > 0) {
          const r2 = radius * radius;
          let triggered = false;
          for (const monster of mm.monsters) {
            if (!monster || monster.isDead || monster.isDying) continue;
            const mPos = monster.getWorldPosition?.();
            if (!mPos) continue;
            const dx = mPos.x - d.position.x;
            const dz = mPos.z - d.position.z;
            if (dx * dx + dz * dz > r2) continue;
            triggered = true;
            break;
          }
          if (triggered) {
            const damage = Math.max(0, Math.round(Number(d.damage) || 0));
            const stunSeconds = Math.max(0, Number(d.stunSeconds) || 0);
            mm?.damage?.applyAreaDamage?.(d.position, radius, damage, {
              owner: 'player',
              stunSeconds,
              damagePlayer: false
            });
            this.audioManager?.playToolTrigger?.('mine');
            this.eventBus?.emit?.(EVENTS.NOISE_REQUESTED, {
              source: 'player',
              kind: 'mine',
              strength: 0.9,
              position: d.position,
              radius: 14,
              ttl: 1.0
            });
            this.emitToast('Mine triggered!', 1.1);
            this.scene?.remove?.(d.mesh);
            this.devices.splice(i, 1);
          }
        }
      }
    }
  }

  updateDecoyGhosts(dt) {
    if (!this.decoyGhosts || this.decoyGhosts.length === 0) return;

    const tileSize = CONFIG.TILE_SIZE || 1;
    for (let i = this.decoyGhosts.length - 1; i >= 0; i--) {
      const g = this.decoyGhosts[i];
      if (!g) {
        this.decoyGhosts.splice(i, 1);
        continue;
      }
      g.life -= dt;
      if (g.life <= 0) {
        this.decoyGhosts.splice(i, 1);
        continue;
      }

      // Pick a new target occasionally.
      if (!g.target || Math.random() < 0.02) {
        const angle = Math.random() * Math.PI * 2;
        const r = Math.random() * (g.roamRadius || tileSize * 2.2);
        g.target = {
          x: g.position.x + Math.cos(angle) * r,
          z: g.position.z + Math.sin(angle) * r
        };
      }

      // Drift toward target (fake "walking").
      const tx = g.target?.x ?? g.position.x;
      const tz = g.target?.z ?? g.position.z;
      const dx = tx - g.position.x;
      const dz = tz - g.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.05) {
        const speed = 1.6 + Math.random() * 0.4;
        const step = Math.min(dist, speed * dt);
        g.position.x += (dx / dist) * step;
        g.position.z += (dz / dist) * step;
      }

      g.pulseTimer = (g.pulseTimer || 0) + dt;
      const interval = Math.max(0.18, Number(g.pulseInterval) || 0.35);
      if (g.pulseTimer >= interval) {
        g.pulseTimer = 0;
        const strength = 0.75;
        this.eventBus?.emit?.(EVENTS.NOISE_REQUESTED, {
          source: 'player',
          kind: 'decoy_step',
          strength,
          position: { x: g.position.x, y: 0, z: g.position.z },
          radius: Math.max(8, Math.round(tileSize * 6)),
          ttl: 0.8
        });
      }
    }
  }

  updateSmokeClouds(dt) {
    for (let i = this.smokeClouds.length - 1; i >= 0; i--) {
      const c = this.smokeClouds[i];
      if (!c) {
        this.smokeClouds.splice(i, 1);
        continue;
      }
      c.life -= dt;
      c.anim = (c.anim || 0) + dt;
      const mesh = c.mesh || null;
      if (mesh?.material) {
        const lifeRatio = c.maxLife > 0 ? Math.max(0, Math.min(1, c.life / c.maxLife)) : 0;
        const mat = mesh.material;
        mat.opacity = 0.08 + 0.18 * lifeRatio;
        mesh.scale.setScalar(Math.max(0.3, Number(c.radius) || 3.8) * (1.0 + (1 - lifeRatio) * 0.08));
        mesh.rotation.y += dt * 0.25;
      }
      if (c.life <= 0) {
        if (mesh) {
          try {
            this.scene?.remove?.(mesh);
          } catch {
            // ignore
          }
        }
        this.smokeClouds.splice(i, 1);
      }
    }
  }

  update(deltaTime) {
    const dt = deltaTime ?? 0;
    if (!(dt > 0)) return;
    if (this.gameState?.gameOver) return;

    this.updateInput();
    this.updateDevices(dt);
    this.updateDecoyGhosts(dt);
    this.updateDelayedNoises(dt);
    this.updateSmokeClouds(dt);
  }

  updateDelayedNoises(dt) {
    if (!Array.isArray(this.delayedNoises) || this.delayedNoises.length === 0) return;
    for (let i = this.delayedNoises.length - 1; i >= 0; i--) {
      const e = this.delayedNoises[i];
      if (!e) {
        this.delayedNoises.splice(i, 1);
        continue;
      }
      e.timer -= dt;
      if (e.timer > 0) continue;
      this.delayedNoises.splice(i, 1);
      const pos = e.position || null;
      if (!pos) continue;
      this.audioManager?.playToolTrigger?.('decoy');
      this.eventBus?.emit?.(EVENTS.NOISE_REQUESTED, {
        source: 'player',
        kind: 'decoy_boom',
        strength: 1.0,
        position: pos.clone(),
        radius: Math.max(8, Math.round(Number(e.radius) || 28)),
        ttl: 1.45
      });
    }
  }

  dispose() {
    this.unsubs.forEach((fn) => fn?.());
    this.unsubs = [];
    this.clear();
  }

  getDeviceMarkers(tileSize = null) {
    const ts = tileSize ?? CONFIG.TILE_SIZE ?? 1;
    const out = [];
    for (const d of this.devices) {
      if (!d?.position) continue;
      out.push({
        kind: d.kind,
        x: Math.floor(d.position.x / ts),
        y: Math.floor(d.position.z / ts)
      });
    }
    return out;
  }

  getDeviceWorldMarkers() {
    const out = [];
    for (const d of this.devices) {
      if (!d?.position) continue;
      out.push({
        kind: d.kind,
        position: d.position.clone()
      });
    }
    return out;
  }
}
