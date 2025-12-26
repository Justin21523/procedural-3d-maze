import * as THREE from 'three';
import { CONFIG } from '../core/config.js';
import { EVENTS } from '../core/events.js';

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

    const amount = Number.isFinite(options.amount) ? options.amount : (kind === 'health' ? 20 : 30);
    const ttl = Number.isFinite(options.ttl) ? options.ttl : 20.0;

    const mesh = kind === 'health'
      ? this.createHealthMesh()
      : this.createAmmoMesh();

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
      if (p.kind === 'health') {
        const gs = this.gameState || this.playerRef?.gameState || null;
        gs?.heal?.(p.amount);
      } else if (p.kind === 'ammo') {
        this.gun?.addAmmo?.(p.amount);
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
