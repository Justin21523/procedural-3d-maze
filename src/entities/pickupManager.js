import * as THREE from 'three';
import { CONFIG } from '../core/config.js';
import { EVENTS } from '../core/events.js';

const TOOL_PICKUP_KINDS = new Set([
  'lure',
  'trap',
  'jammer',
  'decoy',
  'smoke',
  'flash',
  'sensor',
  'mine',
  // Variants / extra tools
  'smoke_weak',
  'smoke_strong',
  'scent_spray',
  'lure_sticky',
  'door_wedge',
  'glowstick',
  'sonar_pulse',
  'decoy_delay',
  'emp_charge',
  'fake_hack'
]);
const WEAPONMOD_PICKUP_KINDS = new Set(['weaponmod_silencer', 'weaponmod_extendedMag', 'weaponmod_quickReload', 'weaponmod_armorPiercing', 'weaponmod_stabilizer']);
const TOOL_PICKUP_HINTS = {
  lure: { label: 'Lure', key: '4' },
  trap: { label: 'Trap', key: '5' },
  jammer: { label: 'Jammer', key: '6' },
  decoy: { label: 'Decoy', key: '7' },
  smoke: { label: 'Smoke', key: '8' },
  smoke_weak: { label: 'Smoke (Weak)', key: '8' },
  smoke_strong: { label: 'Smoke (Strong)', key: '8' },
  flash: { label: 'Flash', key: '9' },
  sensor: { label: 'Sensor', key: '0' },
  mine: { label: 'Mine', key: 'V' },
  scent_spray: { label: 'Scent Spray', key: 'H' },
  lure_sticky: { label: 'Wall Lure', key: '4' },
  door_wedge: { label: 'Door Wedge', key: 'G' },
  glowstick: { label: 'Glowstick', key: 'T' },
  sonar_pulse: { label: 'Sonar', key: 'Z' },
  decoy_delay: { label: 'Delayed Decoy', key: '7' },
  emp_charge: { label: 'EMP Charge', key: 'X' },
  fake_hack: { label: 'Fake Hack', key: 'Y' },
};

export class PickupManager {
  constructor(scene, playerRef = null, gameState = null, gun = null, audioManager = null, eventBus = null) {
    this.scene = scene;
    this.playerRef = playerRef;
    this.gameState = gameState;
    this.gun = gun;
    this.audioManager = audioManager;
    this.eventBus = eventBus;

    this.pickups = [];
    this.maxPickups = CONFIG.SPAWN_DIRECTOR_MAX_PICKUPS ?? 18;

    this.unsubscribers = [];
    this.bindEvents();
  }

  setPlayerRef(playerRef) {
    this.playerRef = playerRef;
  }

  setGameState(gameState) {
    this.gameState = gameState;
  }

  setGun(gun) {
    this.gun = gun;
  }

  setEventBus(eventBus) {
    this.eventBus = eventBus;
    this.bindEvents();
  }

  setMaxPickups(maxPickups) {
    const n = Math.round(Number(maxPickups));
    if (!Number.isFinite(n)) return;
    this.maxPickups = Math.max(0, n);
  }

  bindEvents() {
    this.unsubscribers.forEach((fn) => fn?.());
    this.unsubscribers = [];

    if (!this.eventBus?.on) return;

    this.unsubscribers.push(
      this.eventBus.on(EVENTS.PICKUP_SPAWN_REQUESTED, (payload) => {
        const kind = payload?.kind;
        const pos = payload?.position || payload?.worldPosition || null;
        if (!kind || !pos) return;
        this.spawnPickup(kind, pos, {
          amount: payload?.amount,
          ttl: payload?.ttl,
          radius: payload?.radius
        });
      })
    );
  }

  clear() {
    for (const p of this.pickups) {
      if (p?.mesh) this.scene.remove(p.mesh);
    }
    this.pickups = [];
  }

  spawnPickup(kind, worldPosition, options = {}) {
    if (!this.scene || !worldPosition) return;
    if (this.pickups.length >= this.maxPickups) return;

    const pos = worldPosition.clone ? worldPosition.clone() : new THREE.Vector3(worldPosition.x || 0, worldPosition.y || 0, worldPosition.z || 0);
    pos.y = Math.max(0.15, pos.y + 0.1);

    const isTool = TOOL_PICKUP_KINDS.has(kind);
    const isHealthLike = kind === 'health' || kind === 'healthSmall' || kind === 'healthBig' || kind === 'monsterHeart';
    const amount = Number.isFinite(options.amount)
      ? options.amount
      : (isHealthLike ? (kind === 'healthBig' ? 30 : (kind === 'healthSmall' ? 12 : (kind === 'monsterHeart' ? 2 : 20))) : (kind === 'ammo' ? 30 : (isTool ? 1 : 1)));
    const ttl = Number.isFinite(options.ttl) ? options.ttl : (isTool ? 45.0 : 20.0);

    const mesh = this.createPickupMesh(kind);

    mesh.position.copy(pos);
    mesh.traverse?.((child) => {
      if (!child?.isMesh) return;
      child.castShadow = false;
      child.receiveShadow = false;
    });

    this.scene.add(mesh);

    const entry = {
      kind,
      amount,
      mesh,
      life: ttl,
      maxLife: ttl,
      bobPhase: Math.random() * Math.PI * 2,
      radius: Number.isFinite(options.radius) ? options.radius : 1.1
    };
    this.pickups.push(entry);
    this.eventBus?.emit?.(EVENTS.PICKUP_SPAWNED, {
      kind,
      amount,
      position: pos.clone(),
      ttl
    });
  }

  createPickupMesh(kind) {
    switch (kind) {
      case 'health':
        return this.createHealthMesh();
      case 'healthSmall':
        return this.createHealthSmallMesh();
      case 'healthBig':
        return this.createHealthBigMesh();
      case 'monsterHeart':
        return this.createMonsterHeartMesh();
      case 'ammo':
        return this.createAmmoMesh();
      case 'lure':
        return this.createLureMesh();
      case 'trap':
        return this.createTrapMesh();
      case 'jammer':
        return this.createJammerMesh();
      case 'decoy':
        return this.createDecoyMesh();
      case 'smoke':
        return this.createSmokeMesh();
      case 'smoke_weak': {
        const g = this.createSmokeMesh();
        g.scale.setScalar(0.82);
        return g;
      }
      case 'smoke_strong': {
        const g = this.createSmokeMesh();
        g.scale.setScalar(1.15);
        return g;
      }
      case 'flash':
        return this.createFlashMesh();
      case 'sensor':
        return this.createSensorMesh();
      case 'mine':
        return this.createMineMesh();
      case 'scent_spray':
        return this.createJammerMesh();
      case 'lure_sticky':
        return this.createLureMesh();
      case 'door_wedge':
        return this.createTrapMesh();
      case 'glowstick': {
        const g = this.createSensorMesh();
        g.scale.setScalar(0.9);
        return g;
      }
      case 'sonar_pulse': {
        const g = this.createSensorMesh();
        g.scale.setScalar(0.95);
        return g;
      }
      case 'decoy_delay':
        return this.createDecoyMesh();
      case 'emp_charge':
        return this.createAmmoMesh();
      case 'fake_hack':
        return this.createSensorMesh();
      case 'weaponmod_silencer':
      case 'weaponmod_extendedMag':
      case 'weaponmod_quickReload':
      case 'weaponmod_armorPiercing':
      case 'weaponmod_stabilizer':
        return this.createWeaponModMesh(kind);
      default:
        return this.createAmmoMesh();
    }
  }

  createAmmoMesh() {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color: 0x66aaff,
      emissive: 0x2255aa,
      emissiveIntensity: 0.6,
      roughness: 0.35,
      metalness: 0.1
    });

    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.34, 10), mat);
    body.rotation.x = Math.PI / 2;
    group.add(body);

    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.38, 10), mat);
    cap.rotation.x = Math.PI / 2;
    cap.position.z = 0.02;
    group.add(cap);

    group.scale.setScalar(1.0);
    return group;
  }

  createHealthMesh() {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color: 0x66ff99,
      emissive: 0x22aa66,
      emissiveIntensity: 0.55,
      roughness: 0.55,
      metalness: 0.05
    });

    const barA = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.12, 0.12), mat);
    group.add(barA);
    const barB = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.46, 0.12), mat);
    group.add(barB);

    group.scale.setScalar(1.0);
    return group;
  }

  createHealthSmallMesh() {
    const group = this.createHealthMesh();
    group.scale.setScalar(0.78);
    return group;
  }

  createHealthBigMesh() {
    const group = this.createHealthMesh();
    group.scale.setScalar(1.25);
    group.traverse?.((child) => {
      const mat = child?.material;
      if (!mat) return;
      if (Array.isArray(mat)) return;
      mat.emissiveIntensity = 0.75;
      mat.roughness = 0.45;
    });
    return group;
  }

  createMonsterHeartMesh() {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color: 0xff6688,
      emissive: 0xaa2244,
      emissiveIntensity: 0.8,
      roughness: 0.4,
      metalness: 0.05,
      transparent: true,
      opacity: 0.95
    });
    const a = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 14), mat);
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 14), mat);
    a.position.set(-0.08, 0.06, 0);
    b.position.set(0.08, 0.06, 0);
    group.add(a, b);
    const c = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.26, 16), mat);
    c.position.set(0, -0.08, 0);
    c.rotation.z = Math.PI;
    group.add(c);
    group.scale.setScalar(1.0);
    return group;
  }

  createDecoyMesh() {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0xff7043,
      emissive: 0xff5252,
      emissiveIntensity: 0.75,
      roughness: 0.4,
      metalness: 0.1
    });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.12, 14, 12), bodyMat);
    body.position.y = 0.14;
    group.add(body);

    const ringMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xffccbc,
      emissiveIntensity: 0.8,
      roughness: 0.3,
      metalness: 0.0,
      transparent: true,
      opacity: 0.8
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.03, 10, 18), ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.06;
    group.add(ring);
    return group;
  }

  createSmokeMesh() {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color: 0xb0bec5,
      emissive: 0x455a64,
      emissiveIntensity: 0.35,
      roughness: 0.95,
      metalness: 0.0,
      transparent: true,
      opacity: 0.92
    });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 12), mat);
    body.position.y = 0.14;
    group.add(body);

    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.10, 12), mat);
    cap.position.y = 0.28;
    group.add(cap);
    return group;
  }

  createFlashMesh() {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color: 0xfff9c4,
      emissive: 0xffffff,
      emissiveIntensity: 0.85,
      roughness: 0.45,
      metalness: 0.05,
      transparent: true,
      opacity: 0.95
    });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.12, 14, 12), mat);
    body.position.y = 0.14;
    group.add(body);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.02, 10, 18), mat);
    band.rotation.x = Math.PI / 2;
    band.position.y = 0.12;
    group.add(band);
    return group;
  }

  createSensorMesh() {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color: 0x4dd0e1,
      emissive: 0x00bcd4,
      emissiveIntensity: 0.75,
      roughness: 0.35,
      metalness: 0.1,
      transparent: true,
      opacity: 0.95
    });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.10, 14), mat);
    base.position.y = 0.06;
    group.add(base);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), mat);
    eye.position.y = 0.16;
    group.add(eye);
    return group;
  }

  createMineMesh() {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color: 0xff1744,
      emissive: 0xd50000,
      emissiveIntensity: 0.65,
      roughness: 0.45,
      metalness: 0.05,
      transparent: true,
      opacity: 0.92
    });
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.06, 16), mat);
    disc.position.y = 0.04;
    group.add(disc);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 10), mat);
    dot.position.y = 0.10;
    group.add(dot);
    return group;
  }

  createLureMesh() {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0xffa726,
      emissive: 0xff7043,
      emissiveIntensity: 0.85,
      roughness: 0.45,
      metalness: 0.1
    });
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.28, 12), bodyMat);
    core.position.y = 0.14;
    group.add(core);

    const glowMat = new THREE.MeshStandardMaterial({
      color: 0xff5252,
      emissive: 0xff5252,
      emissiveIntensity: 1.2,
      roughness: 0.2,
      metalness: 0.0,
      transparent: true,
      opacity: 0.9
    });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 12), glowMat);
    bulb.position.y = 0.28;
    group.add(bulb);
    return group;
  }

  createTrapMesh() {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color: 0x90caf9,
      emissive: 0x42a5f5,
      emissiveIntensity: 0.75,
      roughness: 0.35,
      metalness: 0.05
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.03, 10, 20), mat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.03;
    group.add(ring);

    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.14, 10), mat);
    spike.position.y = 0.09;
    group.add(spike);
    return group;
  }

  createJammerMesh() {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color: 0xce93d8,
      emissive: 0xba68c8,
      emissiveIntensity: 0.85,
      roughness: 0.35,
      metalness: 0.05
    });

    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.18, 12), mat);
    base.position.y = 0.09;
    group.add(base);

    const antennaMat = new THREE.MeshStandardMaterial({
      color: 0x263238,
      emissive: 0x000000,
      emissiveIntensity: 0.0,
      roughness: 0.75,
      metalness: 0.1
    });
    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.22, 8), antennaMat);
    antenna.position.y = 0.24;
    group.add(antenna);

    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 10), mat);
    tip.position.y = 0.36;
    group.add(tip);

    return group;
  }

  createWeaponModMesh(kind) {
    const group = new THREE.Group();
    const colorMap = {
      weaponmod_silencer: { core: 0x263238, glow: 0x80cbc4 },
      weaponmod_extendedMag: { core: 0x1e88e5, glow: 0x90caf9 },
      weaponmod_quickReload: { core: 0xfdd835, glow: 0xfff59d },
      weaponmod_armorPiercing: { core: 0x8e24aa, glow: 0xce93d8 },
      weaponmod_stabilizer: { core: 0x43a047, glow: 0xa5d6a7 },
    };
    const meta = colorMap[kind] || { core: 0x607d8b, glow: 0xb0bec5 };

    const coreMat = new THREE.MeshStandardMaterial({
      color: meta.core,
      emissive: meta.glow,
      emissiveIntensity: 0.75,
      roughness: 0.35,
      metalness: 0.15
    });

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.22), coreMat);
    body.position.y = 0.14;
    group.add(body);

    const ringMat = new THREE.MeshStandardMaterial({
      color: meta.glow,
      emissive: meta.glow,
      emissiveIntensity: 1.1,
      roughness: 0.2,
      metalness: 0.0,
      transparent: true,
      opacity: 0.88
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.03, 10, 18), ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.14;
    group.add(ring);

    group.scale.setScalar(1.0);
    return group;
  }

  getPickupMarkers(tileSize = null) {
    const ts = tileSize ?? CONFIG.TILE_SIZE ?? 1;
    const out = [];
    for (const p of this.pickups) {
      if (!p?.mesh) continue;
      out.push({
        kind: p.kind,
        x: Math.floor(p.mesh.position.x / ts),
        y: Math.floor(p.mesh.position.z / ts),
      });
    }
    return out;
  }

  getPickupWorldMarkers() {
    const out = [];
    for (const p of this.pickups) {
      if (!p?.mesh) continue;
      out.push({
        kind: p.kind,
        position: p.mesh.position.clone()
      });
    }
    return out;
  }

  update(deltaTime) {
    const dt = deltaTime ?? 0;
    if (dt <= 0) return;

    const playerPos = this.playerRef?.getPosition ? this.playerRef.getPosition() : (this.playerRef?.position || null);

    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      if (!p?.mesh) {
        this.pickups.splice(i, 1);
        continue;
      }

      p.life -= dt;
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        this.pickups.splice(i, 1);
        continue;
      }

      p.bobPhase += dt * 3.0;
      p.mesh.rotation.y += dt * 1.6;
      p.mesh.position.y += Math.sin(p.bobPhase) * 0.0035;

      if (!playerPos) continue;

      const dx = p.mesh.position.x - playerPos.x;
      const dz = p.mesh.position.z - playerPos.z;
      const dist = Math.hypot(dx, dz);
      const r = Number.isFinite(p.radius) ? p.radius : 1.1;
      if (dist > r) continue;

      // Collect
      const pickupPos = p.mesh.position.clone();
      if (p.kind === 'health' || p.kind === 'healthSmall' || p.kind === 'healthBig') {
        const gs = this.gameState || this.playerRef?.gameState || null;
        gs?.heal?.(p.amount);
        this.audioManager?.playPickupHeal?.();
      } else if (p.kind === 'monsterHeart') {
        const gs = this.gameState || this.playerRef?.gameState || null;
        const bonus = Math.max(1, Math.round(Number(p.amount) || 1));
        gs?.addMaxHealth?.(bonus, { healAdded: true });
        this.audioManager?.playPickupHeal?.();
      } else if (p.kind === 'ammo') {
        this.gun?.addAmmo?.(p.amount);
      } else if (WEAPONMOD_PICKUP_KINDS.has(p.kind)) {
        const res = this.gun?.addWeaponMod?.(p.kind) || { ok: false };
        if (res.ok) {
          this.audioManager?.playPickupAttachment?.();
          this.eventBus?.emit?.(EVENTS.UI_TOAST, {
            text: `${res.text || 'Weapon upgraded'}`,
            seconds: 1.6
          });
        } else {
          this.eventBus?.emit?.(EVENTS.UI_TOAST, {
            text: `No effect: ${String(p.kind || 'weapon mod')}`,
            seconds: 1.2
          });
        }
      } else if (TOOL_PICKUP_KINDS.has(p.kind)) {
        this.eventBus?.emit?.(EVENTS.INVENTORY_GIVE_ITEM, {
          actorKind: 'player',
          itemId: p.kind,
          count: p.amount
        });
        const meta = TOOL_PICKUP_HINTS[p.kind] || { label: p.kind, key: '?' };
        const label = meta.label || p.kind;
        const hint = meta.key || '?';
        this.eventBus?.emit?.(EVENTS.UI_TOAST, {
          text: `Picked up ${label} (+${p.amount}) [${hint}]`,
          seconds: 1.5
        });
      }
      this.eventBus?.emit?.(EVENTS.PICKUP_COLLECTED, {
        kind: p.kind,
        amount: p.amount,
        position: pickupPos
      });

      // Remove
      this.scene.remove(p.mesh);
      this.pickups.splice(i, 1);
    }
  }

  dispose() {
    this.unsubscribers.forEach((fn) => fn?.());
    this.unsubscribers = [];
  }
}
