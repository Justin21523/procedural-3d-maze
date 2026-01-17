import * as THREE from 'three';
import { CONFIG } from '../core/config.js';
import { EVENTS } from '../core/events.js';

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function toCount(value, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, n);
}

function toWorldCenter(tile, tileSize) {
  return new THREE.Vector3(
    tile.x * tileSize + tileSize / 2,
    0.15,
    tile.y * tileSize + tileSize / 2
  );
}

function manhattan(a, b) {
  if (!a || !b) return Infinity;
  return Math.abs((a.x || 0) - (b.x || 0)) + Math.abs((a.y || 0) - (b.y || 0));
}

export class DeviceManager {
  constructor(options = {}) {
    this.scene = options.scene || null;
    this.worldState = options.worldState || null;
    this.eventBus = options.eventBus || null;
    this.audioManager = options.audioManager || null;

    this.devices = [];
    this.unsubs = [];
    this._tmpPos = new THREE.Vector3();
    this.bind();
  }

  setRefs({ scene, worldState, eventBus, audioManager } = {}) {
    if (scene) this.scene = scene;
    if (worldState) this.worldState = worldState;
    if (eventBus) this.eventBus = eventBus;
    if (audioManager) this.audioManager = audioManager;
    this.bind();
  }

  bind() {
    this.unsubs.forEach((fn) => fn?.());
    this.unsubs = [];
    const bus = this.eventBus;
    if (!bus?.on) return;

    this.unsubs.push(bus.on(EVENTS.WEAPON_FIRED, (payload) => this.onWeaponFired(payload)));
    this.unsubs.push(bus.on(EVENTS.PROJECTILE_HIT_DEVICE, (payload) => this.onProjectileHitDevice(payload)));
    this.unsubs.push(bus.on(EVENTS.PROJECTILE_HIT_WALL, (payload) => this.onProjectileHitWall(payload)));
    this.unsubs.push(bus.on(EVENTS.PLAYER_HIT_MONSTER, (payload) => this.onPlayerHitMonster(payload)));
  }

  clear() {
    for (const d of this.devices) {
      if (d?.mesh) {
        try {
          this.scene?.remove?.(d.mesh);
        } catch {
          // ignore
        }
      }
      if (d?.light) {
        try {
          this.scene?.remove?.(d.light);
        } catch {
          // ignore
        }
      }
      if (d?.kind === 'doorLock' && d?.gridPos && this.worldState?.setObstacle) {
        const gx = d.gridPos.x;
        const gy = d.gridPos.y;
        if (Number.isFinite(gx) && Number.isFinite(gy)) {
          this.worldState.setObstacle(gx, gy, d.prevBlocked === true);
        }
      }
    }
    this.devices = [];
  }

  startLevel(levelConfig = null) {
    this.clear();
    if (!this.scene || !this.worldState) return;

    const min = toCount(levelConfig?.devices?.alarmBoxes?.min, toCount(CONFIG.WORLD_DEVICE_ALARM_BOX_MIN, 1));
    const max = toCount(levelConfig?.devices?.alarmBoxes?.max, toCount(CONFIG.WORLD_DEVICE_ALARM_BOX_MAX, 3));
    const desired = clamp(min + Math.floor(Math.random() * (Math.max(min, max) - min + 1)), 0, 12);
    const powerMin = toCount(levelConfig?.devices?.powerBoxes?.min, toCount(CONFIG.WORLD_DEVICE_POWER_BOX_MIN, 0));
    const powerMax = toCount(levelConfig?.devices?.powerBoxes?.max, toCount(CONFIG.WORLD_DEVICE_POWER_BOX_MAX, 2));
    const desiredPower = clamp(powerMin + Math.floor(Math.random() * (Math.max(powerMin, powerMax) - powerMin + 1)), 0, 12);

    const lockMin = toCount(levelConfig?.devices?.doorLocks?.min, toCount(CONFIG.WORLD_DEVICE_DOOR_LOCK_MIN, 1));
    const lockMax = toCount(levelConfig?.devices?.doorLocks?.max, toCount(CONFIG.WORLD_DEVICE_DOOR_LOCK_MAX, 4));
    const desiredLocks = clamp(lockMin + Math.floor(Math.random() * (Math.max(lockMin, lockMax) - lockMin + 1)), 0, 12);

    const lightMin = toCount(levelConfig?.devices?.lights?.min, toCount(CONFIG.WORLD_DEVICE_LIGHT_MIN, 2));
    const lightMax = toCount(levelConfig?.devices?.lights?.max, toCount(CONFIG.WORLD_DEVICE_LIGHT_MAX, 6));
    const desiredLights = clamp(lightMin + Math.floor(Math.random() * (Math.max(lightMin, lightMax) - lightMin + 1)), 0, 16);

    const sirenMin = toCount(levelConfig?.devices?.sirens?.min, toCount(CONFIG.WORLD_DEVICE_SIREN_MIN, 0));
    const sirenMax = toCount(levelConfig?.devices?.sirens?.max, toCount(CONFIG.WORLD_DEVICE_SIREN_MAX, 2));
    const desiredSirens = clamp(sirenMin + Math.floor(Math.random() * (Math.max(sirenMin, sirenMax) - sirenMin + 1)), 0, 8);

    if (desired <= 0 && desiredPower <= 0 && desiredLocks <= 0 && desiredLights <= 0 && desiredSirens <= 0) return;

    const rooms = this.worldState.getRooms?.() || [];
    const tileSize = CONFIG.TILE_SIZE || 1;

    const candidates = [];
    for (const r of rooms) {
      const tiles = Array.isArray(r?.tiles) ? r.tiles : [];
      for (const t of tiles) {
        if (!t) continue;
        const isNearDoor = Array.isArray(r?.doors) && r.doors.some((d) => Math.abs(d.x - t.x) <= 1 && Math.abs(d.y - t.y) <= 1);
        if (isNearDoor) continue;
        candidates.push(t);
      }
    }

    for (let i = 0; i < desired; i++) {
      const tile = candidates.length > 0
        ? candidates.splice(Math.floor(Math.random() * candidates.length), 1)[0]
        : this.worldState.findRandomWalkableTile?.();
      if (!tile) continue;
      const pos = toWorldCenter(tile, tileSize);
      this.spawnAlarmBox(pos);
    }

    for (let i = 0; i < desiredPower; i++) {
      const tile = candidates.length > 0
        ? candidates.splice(Math.floor(Math.random() * candidates.length), 1)[0]
        : this.worldState.findRandomWalkableTile?.();
      if (!tile) continue;
      const pos = toWorldCenter(tile, tileSize);
      this.spawnPowerBox(pos);
    }

    // Door locks: placed on room doors (blocking tiles) but only on rooms that have at least 2 doors,
    // so the room remains reachable via another route.
    const spawn = this.worldState.getSpawnPoint?.() || this.worldState.spawnPoint || null;
    const exit = this.worldState.getExitPoint?.() || this.worldState.exitPoint || null;
    const minSpawnDist = Math.max(0, Math.round(Number(CONFIG.WORLD_DEVICE_DOOR_LOCK_MIN_DIST_FROM_SPAWN) || 8));
    const doorCandidates = [];
    for (const room of rooms) {
      const doors = Array.isArray(room?.doors) ? room.doors : [];
      if (doors.length < 2) continue;
      for (const d of doors) {
        if (!d) continue;
        if (spawn && manhattan(spawn, d) < minSpawnDist) continue;
        if (exit && manhattan(exit, d) < 5) continue;
        doorCandidates.push({ x: d.x, y: d.y });
      }
    }
    for (let i = 0; i < desiredLocks && doorCandidates.length > 0; i++) {
      const pick = doorCandidates.splice(Math.floor(Math.random() * doorCandidates.length), 1)[0];
      if (!pick) continue;
      const pos = toWorldCenter(pick, tileSize);
      this.spawnDoorLock(pos, pick);
    }

    // Lights + sirens: placed at room centers (visual + gameplay zones).
    const roomCenters = rooms
      .map((r) => {
        const cx = Math.floor((Number(r?.x) || 0) + (Number(r?.width) || 1) / 2);
        const cy = Math.floor((Number(r?.y) || 0) + (Number(r?.height) || 1) / 2);
        return { x: cx, y: cy };
      })
      .filter((t) => this.worldState.isWalkable?.(t.x, t.y));

    for (let i = 0; i < desiredLights && roomCenters.length > 0; i++) {
      const tile = roomCenters.splice(Math.floor(Math.random() * roomCenters.length), 1)[0];
      if (!tile) continue;
      const pos = toWorldCenter(tile, tileSize);
      this.spawnLightFixture(pos, tile);
    }

    for (let i = 0; i < desiredSirens && roomCenters.length > 0; i++) {
      const tile = roomCenters.splice(Math.floor(Math.random() * roomCenters.length), 1)[0];
      if (!tile) continue;
      const pos = toWorldCenter(tile, tileSize);
      this.spawnSiren(pos);
    }
  }

  createAlarmBoxMesh() {
    const group = new THREE.Group();

    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x263238,
      emissive: 0x111111,
      emissiveIntensity: 0.55,
      roughness: 0.6,
      metalness: 0.05
    });

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.26, 0.18), bodyMat);
    body.position.y = 0.16;
    group.add(body);

    const lightMat = new THREE.MeshStandardMaterial({
      color: 0xff5252,
      emissive: 0xff1744,
      emissiveIntensity: 1.25,
      roughness: 0.25,
      metalness: 0.0,
      transparent: true,
      opacity: 0.95
    });
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), lightMat);
    lamp.position.set(0, 0.23, 0.085);
    group.add(lamp);

    group.traverse?.((child) => {
      if (!child?.isMesh) return;
      child.castShadow = false;
      child.receiveShadow = false;
    });
    return group;
  }

  spawnAlarmBox(worldPosition) {
    const hp = Math.max(1, Math.round(Number(CONFIG.WORLD_DEVICE_ALARM_BOX_HP) || 12));
    const hitRadius = Math.max(0.2, Number(CONFIG.WORLD_DEVICE_ALARM_BOX_HIT_RADIUS) || 0.55);

    const mesh = this.createAlarmBoxMesh();
    mesh.position.copy(worldPosition);
    mesh.name = '__alarmBox';
    this.scene.add(mesh);

    const device = {
      kind: 'alarmBox',
      mesh,
      position: worldPosition.clone(),
      hitRadius,
      hp,
      maxHp: hp,
      listenRadius: Math.max(2, Number(CONFIG.WORLD_DEVICE_ALARM_BOX_LISTEN_RADIUS) || 14),
      noiseRadius: Math.max(4, Number(CONFIG.WORLD_DEVICE_ALARM_BOX_NOISE_RADIUS) || 26),
      noiseCooldown: Math.max(0.1, Number(CONFIG.WORLD_DEVICE_ALARM_BOX_NOISE_COOLDOWN) || 2.2),
      noiseTimer: 0,
      destroyed: false
    };
    this.devices.push(device);
    this.eventBus?.emit?.(EVENTS.DEVICE_SPAWNED, {
      kind: device.kind,
      position: device.position.clone(),
      hp: device.hp
    });
  }

  createPowerBoxMesh() {
    const group = new THREE.Group();

    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x37474f,
      emissive: 0x111111,
      emissiveIntensity: 0.5,
      roughness: 0.65,
      metalness: 0.06
    });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.28, 0.20), bodyMat);
    body.position.y = 0.16;
    group.add(body);

    const coilMat = new THREE.MeshStandardMaterial({
      color: 0x66aaff,
      emissive: 0x66aaff,
      emissiveIntensity: 1.1,
      roughness: 0.25,
      metalness: 0.0,
      transparent: true,
      opacity: 0.92
    });
    const coil = new THREE.Mesh(new THREE.TorusGeometry(0.10, 0.02, 10, 18), coilMat);
    coil.rotation.x = Math.PI / 2;
    coil.position.set(0, 0.23, 0.09);
    group.add(coil);

    group.userData.__coil = coil;
    group.traverse?.((child) => {
      if (!child?.isMesh) return;
      child.castShadow = false;
      child.receiveShadow = false;
    });
    return group;
  }

  spawnPowerBox(worldPosition) {
    const hp = Math.max(1, Math.round(Number(CONFIG.WORLD_DEVICE_POWER_BOX_HP) || 10));
    const hitRadius = Math.max(0.2, Number(CONFIG.WORLD_DEVICE_POWER_BOX_HIT_RADIUS) || 0.55);

    const mesh = this.createPowerBoxMesh();
    mesh.position.copy(worldPosition);
    mesh.name = '__powerBox';
    this.scene.add(mesh);

    const device = {
      kind: 'powerBox',
      mesh,
      position: worldPosition.clone(),
      hitRadius,
      hp,
      maxHp: hp,
      destroyed: false
    };
    this.devices.push(device);
    this.eventBus?.emit?.(EVENTS.DEVICE_SPAWNED, {
      kind: device.kind,
      position: device.position.clone(),
      hp: device.hp
    });
  }

  createDoorLockMesh() {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x263238,
      emissive: 0x220000,
      emissiveIntensity: 0.7,
      roughness: 0.55,
      metalness: 0.1
    });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.20, 0.08), bodyMat);
    body.position.y = 0.24;
    group.add(body);

    const shackleMat = new THREE.MeshStandardMaterial({
      color: 0xb0bec5,
      emissive: 0x000000,
      emissiveIntensity: 0.0,
      roughness: 0.35,
      metalness: 0.6
    });
    const shackle = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.02, 10, 18, Math.PI), shackleMat);
    shackle.rotation.x = Math.PI / 2;
    shackle.position.set(0, 0.33, 0);
    group.add(shackle);

    group.traverse?.((child) => {
      if (!child?.isMesh) return;
      child.castShadow = false;
      child.receiveShadow = false;
    });
    return group;
  }

  spawnDoorLock(worldPosition, gridPos) {
    const hp = Math.max(1, Math.round(Number(CONFIG.WORLD_DEVICE_DOOR_LOCK_HP) || 10));
    const hitRadius = Math.max(0.2, Number(CONFIG.WORLD_DEVICE_DOOR_LOCK_HIT_RADIUS) || 0.55);

    const mesh = this.createDoorLockMesh();
    mesh.position.copy(worldPosition);
    mesh.position.y = 0.1;
    mesh.name = '__doorLock';
    this.scene.add(mesh);

    const gx = gridPos?.x;
    const gy = gridPos?.y;
    let prevBlocked = false;
    if (Number.isFinite(gx) && Number.isFinite(gy) && this.worldState?.obstacleMap?.[gy]) {
      prevBlocked = !!this.worldState.obstacleMap[gy][gx];
      this.worldState.setObstacle?.(gx, gy, true);
    }

    const device = {
      kind: 'doorLock',
      mesh,
      position: worldPosition.clone(),
      hitRadius,
      hp,
      maxHp: hp,
      destroyed: false,
      gridPos: gridPos ? { x: gx, y: gy } : null,
      prevBlocked
    };
    this.devices.push(device);
    this.eventBus?.emit?.(EVENTS.DEVICE_SPAWNED, {
      kind: device.kind,
      position: device.position.clone(),
      hp: device.hp
    });
  }

  createLightFixtureMesh() {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color: 0xfff9c4,
      emissive: 0xffffff,
      emissiveIntensity: 1.0,
      roughness: 0.35,
      metalness: 0.05,
      transparent: true,
      opacity: 0.92
    });
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.6, 12), mat);
    tube.rotation.z = Math.PI / 2;
    tube.position.y = 2.2;
    group.add(tube);

    group.userData.__tube = tube;
    group.traverse?.((child) => {
      if (!child?.isMesh) return;
      child.castShadow = false;
      child.receiveShadow = false;
    });
    return group;
  }

  spawnLightFixture(worldPosition, gridPos) {
    const hp = Math.max(1, Math.round(Number(CONFIG.WORLD_DEVICE_LIGHT_HP) || 8));
    const hitRadius = Math.max(0.2, Number(CONFIG.WORLD_DEVICE_LIGHT_HIT_RADIUS) || 0.6);
    const radius = Math.max(2, Number(CONFIG.WORLD_DEVICE_LIGHT_RADIUS) || 9);
    const intensity = Number.isFinite(CONFIG.WORLD_DEVICE_LIGHT_INTENSITY) ? CONFIG.WORLD_DEVICE_LIGHT_INTENSITY : 0.55;

    const mesh = this.createLightFixtureMesh();
    mesh.position.copy(worldPosition);
    mesh.name = '__lightFixture';
    this.scene.add(mesh);

    const light = new THREE.PointLight(0xffffee, intensity, radius, 2);
    light.position.set(worldPosition.x, 2.2, worldPosition.z);
    light.castShadow = false;
    this.scene.add(light);

    const device = {
      kind: 'light',
      mesh,
      position: worldPosition.clone(),
      hitRadius,
      hp,
      maxHp: hp,
      destroyed: false,
      gridPos: gridPos ? { x: gridPos.x, y: gridPos.y } : null,
      light,
      radius
    };
    this.devices.push(device);
    this.eventBus?.emit?.(EVENTS.DEVICE_SPAWNED, {
      kind: device.kind,
      position: device.position.clone(),
      hp: device.hp
    });
  }

  createSirenMesh() {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x455a64,
      emissive: 0x111111,
      emissiveIntensity: 0.55,
      roughness: 0.55,
      metalness: 0.08
    });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.26, 14), bodyMat);
    body.position.y = 0.14;
    group.add(body);

    const capMat = new THREE.MeshStandardMaterial({
      color: 0xff5252,
      emissive: 0xff1744,
      emissiveIntensity: 1.3,
      roughness: 0.25,
      metalness: 0.0,
      transparent: true,
      opacity: 0.9
    });
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 10), capMat);
    cap.position.y = 0.30;
    group.add(cap);
    group.userData.__cap = cap;

    group.traverse?.((child) => {
      if (!child?.isMesh) return;
      child.castShadow = false;
      child.receiveShadow = false;
    });
    return group;
  }

  spawnSiren(worldPosition) {
    const hp = Math.max(1, Math.round(Number(CONFIG.WORLD_DEVICE_SIREN_HP) || 12));
    const hitRadius = Math.max(0.2, Number(CONFIG.WORLD_DEVICE_SIREN_HIT_RADIUS) || 0.65);
    const noiseRadius = Math.max(6, Number(CONFIG.WORLD_DEVICE_SIREN_NOISE_RADIUS) || 28);
    const interval = Math.max(0.2, Number(CONFIG.WORLD_DEVICE_SIREN_NOISE_INTERVAL) || 1.25);

    const mesh = this.createSirenMesh();
    mesh.position.copy(worldPosition);
    mesh.name = '__siren';
    this.scene.add(mesh);

    const device = {
      kind: 'siren',
      mesh,
      position: worldPosition.clone(),
      hitRadius,
      hp,
      maxHp: hp,
      destroyed: false,
      noiseRadius,
      interval,
      timer: Math.random() * interval
    };
    this.devices.push(device);
    this.eventBus?.emit?.(EVENTS.DEVICE_SPAWNED, {
      kind: device.kind,
      position: device.position.clone(),
      hp: device.hp
    });
  }

  createBossShieldNodeMesh() {
    const group = new THREE.Group();

    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x1a237e,
      emissive: 0x304ffe,
      emissiveIntensity: 1.2,
      roughness: 0.35,
      metalness: 0.05
    });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.18, 14), baseMat);
    base.position.y = 0.09;
    group.add(base);

    const coreMat = new THREE.MeshStandardMaterial({
      color: 0x90caf9,
      emissive: 0x00b0ff,
      emissiveIntensity: 1.65,
      roughness: 0.2,
      metalness: 0.0,
      transparent: true,
      opacity: 0.95
    });
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), coreMat);
    core.position.y = 0.35;
    group.add(core);

    const ringMat = new THREE.MeshStandardMaterial({
      color: 0x80d8ff,
      emissive: 0x40c4ff,
      emissiveIntensity: 1.1,
      roughness: 0.25,
      metalness: 0.0,
      transparent: true,
      opacity: 0.85
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.025, 10, 24), ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.35;
    group.add(ring);

    group.userData.__core = core;
    group.userData.__ring = ring;
    group.traverse?.((child) => {
      if (!child?.isMesh) return;
      child.castShadow = false;
      child.receiveShadow = false;
    });
    return group;
  }

  spawnBossShieldNode(worldPosition, gridPos = null, options = {}) {
    if (!this.scene) return null;
    const hp = Math.max(1, Math.round(Number(CONFIG.WORLD_DEVICE_BOSS_SHIELD_NODE_HP) || 22));
    const hitRadius = Math.max(0.25, Number(CONFIG.WORLD_DEVICE_BOSS_SHIELD_NODE_HIT_RADIUS) || 0.7);

    const mesh = this.createBossShieldNodeMesh();
    mesh.position.copy(worldPosition);
    mesh.name = '__bossShieldNode';
    this.scene.add(mesh);

    const device = {
      kind: 'bossShieldNode',
      mesh,
      position: worldPosition.clone(),
      gridPos: gridPos ? { x: gridPos.x, y: gridPos.y } : null,
      hitRadius,
      hp,
      maxHp: hp,
      destroyed: false,
      bossKey: options?.bossKey || null
    };
    this.devices.push(device);
    this.eventBus?.emit?.(EVENTS.DEVICE_SPAWNED, {
      kind: device.kind,
      position: device.position.clone(),
      hp: device.hp
    });
    return device;
  }

  update(dt) {
    const delta = Number.isFinite(dt) ? dt : 0;
    for (const d of this.devices) {
      if (!d || d.destroyed) continue;
      d.noiseTimer = Math.max(0, (d.noiseTimer || 0) - delta);

      if (d.kind === 'alarmBox') {
        const lamp = d.mesh?.children?.find?.((c) => c?.isMesh && c.geometry?.type === 'SphereGeometry') || null;
        if (lamp?.material) {
          const pulse = 0.65 + 0.35 * Math.sin((performance.now() || 0) * 0.012);
          lamp.material.emissiveIntensity = 0.9 + pulse * 0.6;
        }
      }
      if (d.kind === 'powerBox') {
        const coil = d.mesh?.userData?.__coil || null;
        if (coil?.material) {
          const pulse = 0.6 + 0.4 * Math.sin((performance.now() || 0) * 0.01);
          coil.material.emissiveIntensity = 0.75 + pulse * 0.7;
        }
      }
      if (d.kind === 'siren') {
        d.timer = Math.max(0, (d.timer || 0) - delta);
        const cap = d.mesh?.userData?.__cap || null;
        if (cap?.material) {
          const pulse = 0.6 + 0.4 * Math.sin((performance.now() || 0) * 0.018);
          cap.material.emissiveIntensity = 0.9 + pulse * 0.8;
        }
        if ((d.timer || 0) <= 0) {
          d.timer = Math.max(0.2, Number(d.interval) || 1.25);
          this.eventBus?.emit?.(EVENTS.NOISE_REQUESTED, {
            kind: 'siren',
            position: d.position.clone(),
            radius: d.noiseRadius,
            ttl: 1.1,
            strength: 1.0,
            source: 'siren'
          });
          this.audioManager?.playAlarmBeep?.();
        }
      }
      if (d.kind === 'bossShieldNode') {
        const core = d.mesh?.userData?.__core || null;
        const ring = d.mesh?.userData?.__ring || null;
        const pulse = 0.6 + 0.4 * Math.sin((performance.now() || 0) * 0.014);
        if (core?.material) core.material.emissiveIntensity = 1.1 + pulse * 1.0;
        if (ring?.material) ring.material.emissiveIntensity = 0.9 + pulse * 0.7;
        if (ring) ring.rotation.z += delta * 0.8;
      }
    }
  }

  getHittables() {
    const out = [];
    for (const d of this.devices) {
      if (!d || d.destroyed) continue;
      out.push({
        kind: d.kind,
        position: d.position,
        radius: d.hitRadius,
        ref: d
      });
    }
    return out;
  }

  getDeviceMarkers(tileSize = null) {
    const ts = tileSize ?? CONFIG.TILE_SIZE ?? 1;
    const out = [];
    for (const d of this.devices) {
      if (!d || d.destroyed || !d.position) continue;
      out.push({
        kind: d.kind,
        x: Math.floor(d.position.x / ts),
        y: Math.floor(d.position.z / ts),
      });
    }
    return out;
  }

  onWeaponFired(payload) {
    const origin = payload?.origin || null;
    if (!origin) return;
    for (const d of this.devices) {
      if (!d || d.destroyed) continue;
      if (d.kind !== 'alarmBox') continue;
      if ((d.noiseTimer || 0) > 0) continue;

      const dx = d.position.x - origin.x;
      const dz = d.position.z - origin.z;
      if ((dx * dx + dz * dz) > d.listenRadius * d.listenRadius) continue;

      d.noiseTimer = d.noiseCooldown;
      this.eventBus?.emit?.(EVENTS.NOISE_REQUESTED, {
        kind: 'alarm',
        position: d.position.clone(),
        radius: d.noiseRadius,
        ttl: 1.25,
        strength: 1.0,
        source: 'alarmBox'
      });
      this.audioManager?.playAlarmBeep?.();
    }
  }

  onProjectileHitDevice(payload) {
    const device = payload?.device || null;
    const projectile = payload?.projectile || null;
    const hitPosition = payload?.hitPosition || null;
    if (!device || device.destroyed) return;
    const damage = Number.isFinite(projectile?.damage) ? projectile.damage : 1;
    this.applyDamage(device, damage, { hitPosition, projectile });
  }

  onProjectileHitWall(payload) {
    this.applyExplosionDamage(payload?.hitPosition || null, payload?.projectile || null);
  }

  onPlayerHitMonster(payload) {
    this.applyExplosionDamage(payload?.hitPosition || null, payload?.projectile || null);
  }

  applyExplosionDamage(hitPosition, projectile) {
    if (!hitPosition || !projectile) return;
    const radius = Number(projectile.explosionRadius);
    if (!Number.isFinite(radius) || radius <= 0) return;

    const baseDamage = Number.isFinite(projectile.explosionDamage)
      ? projectile.explosionDamage
      : (projectile.damage ?? 1);

    for (const d of this.devices) {
      if (!d || d.destroyed) continue;
      const dx = d.position.x - hitPosition.x;
      const dz = d.position.z - hitPosition.z;
      const dist = Math.hypot(dx, dz);
      if (dist > radius) continue;
      const t = clamp(1 - (dist / radius), 0, 1);
      const dmg = Math.max(0, baseDamage * (0.35 + 0.65 * t));
      this.applyDamage(d, dmg, { hitPosition, projectile, isExplosion: true });
    }
  }

  applyDamage(device, amount, context = {}) {
    if (!device || device.destroyed) return;
    const dmg = Number(amount);
    if (!Number.isFinite(dmg) || dmg <= 0) return;

    device.hp = Math.max(0, (device.hp || 0) - dmg);
    this.eventBus?.emit?.(EVENTS.DEVICE_DAMAGED, {
      kind: device.kind,
      position: device.position.clone(),
      hp: device.hp,
      maxHp: device.maxHp,
      damage: dmg,
      hitPosition: context?.hitPosition ? context.hitPosition.clone() : null
    });

    const body = device.mesh?.children?.[0] || null;
    if (body?.material && !Array.isArray(body.material)) {
      body.material.emissiveIntensity = 0.8 + 0.6 * Math.max(0, Math.min(1, (device.hp || 0) / (device.maxHp || 1)));
    }

    if (device.hp > 0) return;
    device.destroyed = true;

    try {
      this.scene?.remove?.(device.mesh);
    } catch {
      // ignore
    }
    if (device.light) {
      try {
        this.scene?.remove?.(device.light);
      } catch {
        // ignore
      }
      try {
        device.light.intensity = 0;
      } catch {
        // ignore
      }
    }

    if (device.kind === 'powerBox') {
      const radius = Math.max(0.5, Number(CONFIG.WORLD_DEVICE_POWER_BOX_EMP_RADIUS) || 5.2);
      const stunSeconds = Math.max(0, Number(CONFIG.WORLD_DEVICE_POWER_BOX_EMP_STUN_SECONDS) || 0.9);
      const jamSeconds = Math.max(0.1, Number(CONFIG.WORLD_DEVICE_POWER_BOX_EMP_JAM_SECONDS) || 4.5);
      this.eventBus?.emit?.(EVENTS.PLAYER_USED_SKILL, {
        kind: 'emp',
        source: 'powerBox',
        position: device.position.clone(),
        radius,
        stunSeconds,
        jamSeconds,
        damage: 0,
        color: 0x66aaff
      });
      this.eventBus?.emit?.(EVENTS.NOISE_REQUESTED, {
        kind: 'powerBox',
        position: device.position.clone(),
        radius: Math.max(6, Number(CONFIG.WORLD_DEVICE_POWER_BOX_NOISE_RADIUS) || 18),
        ttl: 1.0,
        strength: 0.85,
        source: 'powerBox'
      });
    }

    if (device.kind === 'doorLock' && device.gridPos && this.worldState?.setObstacle) {
      const gx = device.gridPos.x;
      const gy = device.gridPos.y;
      if (Number.isFinite(gx) && Number.isFinite(gy)) {
        this.worldState.setObstacle(gx, gy, device.prevBlocked === true);
        this.eventBus?.emit?.(EVENTS.NOISE_REQUESTED, {
          kind: 'door_unlock',
          position: device.position.clone(),
          radius: Math.max(4, Number(CONFIG.AI_NOISE_DOOR_RADIUS) || 12),
          ttl: Math.max(0.1, Number(CONFIG.AI_NOISE_DOOR_TTL) || 0.9),
          strength: Math.max(0.05, Number(CONFIG.AI_NOISE_DOOR_STRENGTH) || 0.85),
          source: 'doorLock'
        });
      }
    }

    if (device.kind === 'light' && this.worldState) {
      const zones = Array.isArray(this.worldState.darkZones) ? this.worldState.darkZones : [];
      zones.push({
        kind: 'dark',
        x: device.position.x,
        z: device.position.z,
        radius: Number(device.radius) || (Number(CONFIG.WORLD_DEVICE_LIGHT_RADIUS) || 9)
      });
      this.worldState.darkZones = zones;
    }

    this.audioManager?.playDeviceDestroyed?.();
    this.eventBus?.emit?.(EVENTS.DEVICE_DESTROYED, {
      kind: device.kind,
      position: device.position.clone(),
      gridPos: device.gridPos ? { x: device.gridPos.x, y: device.gridPos.y } : null
    });
  }

  dispose() {
    this.clear();
    this.unsubs.forEach((fn) => fn?.());
    this.unsubs = [];
  }
}
