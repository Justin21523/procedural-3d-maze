import * as THREE from 'three';
import { CONFIG } from '../core/config.js';

export class WeaponView {
  constructor(scene, cameraController, playerRef) {
    this.scene = scene;
    this.cameraController = cameraController;
    this.playerRef = playerRef;

    this.enabled = !!CONFIG.PLAYER_WEAPON_VIEW_ENABLED;

    const cam = this.cameraController?.getCamera ? this.cameraController.getCamera() : null;
    if (!cam) {
      this.root = null;
      return;
    }

    this.root = new THREE.Group();
    this.root.name = '__weaponView';
    this.root.frustumCulled = false;

    // Base transform
    this.baseOffset = new THREE.Vector3(
      CONFIG.PLAYER_WEAPON_OFFSET?.x ?? 0.35,
      CONFIG.PLAYER_WEAPON_OFFSET?.y ?? -0.35,
      CONFIG.PLAYER_WEAPON_OFFSET?.z ?? -0.72
    );
    this.baseRotation = new THREE.Euler(
      CONFIG.PLAYER_WEAPON_ROTATION?.x ?? -0.12,
      CONFIG.PLAYER_WEAPON_ROTATION?.y ?? Math.PI + 0.12,
      CONFIG.PLAYER_WEAPON_ROTATION?.z ?? 0.06,
      'XYZ'
    );

    this.root.position.copy(this.baseOffset);
    this.root.rotation.copy(this.baseRotation);

    // State (sway/bob/recoil)
    this.lastYaw = null;
    this.lastPitch = null;
    this.sway = new THREE.Vector3();
    this.bobPhase = Math.random() * Math.PI * 2;
    this.lastPlayerPos = null;
    this.recoil = 0;
    this.recoilKick = 0;

    // Procedural animations (weapon swap / reload)
    this.swapTimer = 0;
    this.swapTotal = 0;
    this.reloadTimer = 0;
    this.reloadTotal = 0;

    // Content
    this.modelGroup = new THREE.Group();
    this.modelGroup.name = '__weaponModel';
    this.root.add(this.modelGroup);

    this.modelGroup.add(this.createFallbackGun());

    cam.add(this.root);

    // Load external model (optional)
    this.loadModel(CONFIG.PLAYER_WEAPON_MODEL_PATH || '/models/assault_rifle_pbr.glb').catch(() => {});
  }

  onWeaponSwitch() {
    this.swapTotal = 0.22;
    this.swapTimer = this.swapTotal;
    // Cancel reload animation if switching mid-reload
    this.reloadTimer = 0;
    this.reloadTotal = 0;
  }

  onReloadStart(durationSeconds = null) {
    const d = Number.isFinite(durationSeconds) ? durationSeconds : 1.6;
    this.reloadTotal = Math.max(0.25, d);
    this.reloadTimer = this.reloadTotal;
  }

  onReloadFinish() {
    this.reloadTimer = 0;
    this.reloadTotal = 0;
  }

  setEnabled(enabled) {
    this.enabled = !!enabled;
    if (this.root) this.root.visible = this.enabled;
  }

  createFallbackGun() {
    const group = new THREE.Group();
    group.name = '__weaponFallback';

    const mat = new THREE.MeshStandardMaterial({
      color: 0x2b2b2b,
      roughness: 0.7,
      metalness: 0.2
    });
    const accent = new THREE.MeshStandardMaterial({
      color: 0x111111,
      roughness: 0.6,
      metalness: 0.35
    });

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.85), mat);
    body.position.set(0, 0, 0);
    group.add(body);

    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.18, 0.18), accent);
    grip.position.set(0.08, -0.14, 0.08);
    grip.rotation.x = -0.5;
    group.add(grip);

    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.48, 10), accent);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.02, -0.62);
    group.add(barrel);

    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.12), accent);
    sight.position.set(0, 0.1, -0.12);
    group.add(sight);

    group.traverse((child) => {
      if (child?.isMesh) {
        child.castShadow = false;
        child.receiveShadow = false;
      }
    });

    return group;
  }

  async loadModel(path) {
    if (!path || !this.modelGroup) return;

    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');

    const manager = new THREE.LoadingManager();
    manager.setURLModifier((url) => {
      if (typeof url !== 'string') return url;
      if (url.startsWith('data:') || url.startsWith('blob:')) return url;
      return encodeURI(url);
    });
    const loader = new GLTFLoader(manager);

    const gltf = await new Promise((resolve, reject) => {
      loader.load(path, resolve, undefined, reject);
    });

    const scene = gltf?.scene;
    if (!scene) return;

    // Clear fallback
    while (this.modelGroup.children.length > 0) {
      this.modelGroup.remove(this.modelGroup.children[0]);
    }

    scene.traverse((child) => {
      if (child?.isMesh) {
        child.castShadow = false;
        child.receiveShadow = false;
      }
    });

    // Normalize model size to a reasonable first-person weapon scale
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scene);
    const size = new THREE.Vector3();
    box.getSize(size);
    const longest = Math.max(size.x, size.y, size.z);
    const target = 0.9;
    const s = longest > 0.0001 ? (target / longest) : 1.0;

    const userScale = CONFIG.PLAYER_WEAPON_SCALE ?? 1.0;
    scene.scale.setScalar(s * userScale);

    this.modelGroup.add(scene);
  }

  kick(intensity = null) {
    const base = CONFIG.PLAYER_WEAPON_RECOIL ?? 1.0;
    const amount = Number.isFinite(intensity) ? intensity : base;
    this.recoilKick = Math.min(1.5, this.recoilKick + 0.6 * amount);
  }

  update(dt) {
    if (!this.root) return;
    this.root.visible = this.enabled;
    if (!this.enabled) return;

    this.swapTimer = Math.max(0, this.swapTimer - dt);
    this.reloadTimer = Math.max(0, this.reloadTimer - dt);

    const swayStrength = CONFIG.PLAYER_WEAPON_SWAY ?? 0.9;
    const bobStrength = CONFIG.PLAYER_WEAPON_BOB ?? 0.55;

    // Look deltas from camera controller
    const yaw = this.cameraController?.getYaw ? this.cameraController.getYaw() : 0;
    const pitch = this.cameraController?.getPitch ? this.cameraController.getPitch() : 0;

    let dYaw = 0;
    let dPitch = 0;
    if (this.lastYaw !== null) {
      dYaw = yaw - this.lastYaw;
      dYaw = Math.atan2(Math.sin(dYaw), Math.cos(dYaw)); // wrap
      dPitch = pitch - this.lastPitch;
    }
    this.lastYaw = yaw;
    this.lastPitch = pitch;

    const targetSwayX = -dYaw * 0.18 * swayStrength;
    const targetSwayY = -dPitch * 0.12 * swayStrength;
    const targetSwayZ = dYaw * 0.06 * swayStrength;

    const follow = 1 - Math.exp(-dt * 18);
    this.sway.x += (targetSwayX - this.sway.x) * follow;
    this.sway.y += (targetSwayY - this.sway.y) * follow;
    this.sway.z += (targetSwayZ - this.sway.z) * follow;

    // Movement bob from player speed
    const pos = this.playerRef?.position || null;
    let speed = 0;
    if (pos && dt > 0) {
      if (!this.lastPlayerPos) {
        this.lastPlayerPos = pos.clone();
      } else {
        const dx = pos.x - this.lastPlayerPos.x;
        const dz = pos.z - this.lastPlayerPos.z;
        speed = Math.min(10, Math.hypot(dx, dz) / dt);
        this.lastPlayerPos.copy(pos);
      }
    }

    const speedFactor = Math.max(0, Math.min(1, speed / 5));
    this.bobPhase += dt * (6 + speedFactor * 6);
    const bobX = Math.cos(this.bobPhase) * 0.018 * bobStrength * speedFactor;
    const bobY = Math.sin(this.bobPhase * 2) * 0.014 * bobStrength * speedFactor;

    // Recoil (kick back + return)
    this.recoilKick = Math.max(0, this.recoilKick - dt * 9);
    this.recoil += (this.recoilKick - this.recoil) * (1 - Math.exp(-dt * 22));

    const recoilZ = -0.09 * this.recoil;
    const recoilRotX = -0.09 * this.recoil;
    const recoilRotY = 0.035 * this.recoil;

    this.root.position.copy(this.baseOffset);
    this.root.position.x += this.sway.x + bobX;
    this.root.position.y += this.sway.y + bobY;
    this.root.position.z += this.sway.z + recoilZ;

    this.root.rotation.copy(this.baseRotation);
    this.root.rotation.x += targetSwayY * 0.35 + recoilRotX;
    this.root.rotation.y += targetSwayX * 0.25 + recoilRotY;
    this.root.rotation.z += targetSwayZ * 0.6;

    // --- Swap / reload procedural motions ---
    let swapAmt = 0;
    if (this.swapTotal > 0 && this.swapTimer > 0) {
      const p = 1 - (this.swapTimer / this.swapTotal);
      swapAmt = Math.sin(p * Math.PI);
    }

    let reloadAmt = 0;
    if (this.reloadTotal > 0 && this.reloadTimer > 0) {
      const p = 1 - (this.reloadTimer / this.reloadTotal);
      reloadAmt = Math.sin(p * Math.PI);
    }

    const down = 0.13 * swapAmt + 0.12 * reloadAmt;
    const back = 0.16 * swapAmt + 0.1 * reloadAmt;
    const side = 0.06 * reloadAmt;

    this.root.position.y -= down;
    this.root.position.z += back;
    this.root.position.x += side;

    this.root.rotation.z += 0.55 * swapAmt + 0.25 * reloadAmt;
    this.root.rotation.x += 0.18 * swapAmt + 0.55 * reloadAmt;
  }
}
