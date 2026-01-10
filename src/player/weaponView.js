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

    // Per-weapon local presentation (offset/rotation/scale)
    this.modelOffset = new THREE.Vector3(0, 0, 0);
    this.modelRotation = new THREE.Euler(0, 0, 0, 'XYZ');
    this.modelScale = 1.0;
    this.applyModelTransform();

    this.modelGroup.add(this.createFallbackGun());

    this.modelCache = new Map(); // path -> THREE.Object3D (prepared/scaled)
    this.currentModelPath = null;
    this.modelLoadToken = 0;

    cam.add(this.root);

    // Load external model (optional)
    void this.setModelPath(CONFIG.PLAYER_WEAPON_MODEL_PATH || '/models/weapon/assault_rifle_pbr.glb');
  }

  applyModelTransform() {
    if (!this.modelGroup) return;
    this.modelGroup.position.copy(this.modelOffset);
    this.modelGroup.rotation.copy(this.modelRotation);
    const s = Number.isFinite(this.modelScale) ? this.modelScale : 1.0;
    this.modelGroup.scale.setScalar(Math.max(0.0001, s));
  }

  setViewTransform(view = null) {
    const v = view && typeof view === 'object' ? view : null;
    const off = v?.offset && typeof v.offset === 'object' ? v.offset : null;
    const rot = v?.rotation && typeof v.rotation === 'object' ? v.rotation : null;
    const scale = v?.scale;

    this.modelOffset.set(
      Number.isFinite(off?.x) ? off.x : 0,
      Number.isFinite(off?.y) ? off.y : 0,
      Number.isFinite(off?.z) ? off.z : 0
    );
    this.modelRotation.set(
      Number.isFinite(rot?.x) ? rot.x : 0,
      Number.isFinite(rot?.y) ? rot.y : 0,
      Number.isFinite(rot?.z) ? rot.z : 0,
      'XYZ'
    );
    this.modelScale = Number.isFinite(scale) ? scale : 1.0;
    this.applyModelTransform();
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

  async setModelPath(path) {
    if (!this.modelGroup) return;
    const next = String(path || '').trim();
    if (!next) return;
    if (next === this.currentModelPath) return;

    this.currentModelPath = next;
    const token = ++this.modelLoadToken;

    const cached = this.modelCache.get(next) || null;
    if (cached) {
      this.setModelObject(cached.clone(true));
      return;
    }

    try {
      const prepared = await this.loadModelObject(next);
      if (!prepared) return;
      if (token !== this.modelLoadToken) return;
      this.modelCache.set(next, prepared);
      this.setModelObject(prepared.clone(true));
    } catch (err) {
      void err;
    }
  }

  setModelObject(obj) {
    if (!this.modelGroup || !obj) return;
    while (this.modelGroup.children.length > 0) {
      this.modelGroup.remove(this.modelGroup.children[0]);
    }
    this.modelGroup.add(obj);
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

  async loadModelObject(path) {
    if (!path) return null;

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
    if (!scene) return null;
    scene.frustumCulled = false;

    let meshCount = 0;
    scene.traverse((child) => {
      if (child?.isMesh) {
        meshCount += 1;
        child.castShadow = false;
        child.receiveShadow = false;
        child.frustumCulled = false;
        child.renderOrder = 1000;
        const mat = child.material;
        if (Array.isArray(mat)) {
          for (const m of mat) {
            if (!m) continue;
            m.side = THREE.DoubleSide;
            m.transparent = false;
            m.opacity = 1.0;
            m.depthTest = false;
            m.depthWrite = false;
            m.needsUpdate = true;
          }
        } else if (mat) {
          mat.side = THREE.DoubleSide;
          mat.transparent = false;
          mat.opacity = 1.0;
          mat.depthTest = false;
          mat.depthWrite = false;
          mat.needsUpdate = true;
        }
      }
    });

    if (meshCount === 0) {
      console.warn(`⚠️ WeaponView: model has no meshes: ${path}`);
      return null;
    }

    // Normalize model size to a reasonable first-person weapon scale
    scene.updateMatrixWorld(true);

    const median = (values) => {
      const nums = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
      if (nums.length === 0) return 0;
      const mid = Math.floor(nums.length / 2);
      if (nums.length % 2 === 1) return nums[mid];
      return (nums[mid - 1] + nums[mid]) / 2;
    };

    const robustBoxFromMeshes = (root) => {
      const entries = [];
      root.traverse((child) => {
        if (!child?.isMesh || !child.geometry) return;
        const geom = child.geometry;
        if (!geom.boundingBox) geom.computeBoundingBox();
        if (!geom.boundingBox) return;

        child.updateWorldMatrix(true, false);
        const b = geom.boundingBox.clone();
        b.applyMatrix4(child.matrixWorld);

        const size = new THREE.Vector3();
        b.getSize(size);
        const longest = Math.max(size.x, size.y, size.z);
        if (!Number.isFinite(longest) || longest <= 1e-6) return;

        const center = new THREE.Vector3();
        b.getCenter(center);
        entries.push({ box: b, center, longest });
      });

      if (entries.length === 0) return null;

      const xs = entries.map((e) => e.center.x);
      const ys = entries.map((e) => e.center.y);
      const zs = entries.map((e) => e.center.z);
      const medianCenter = new THREE.Vector3(median(xs), median(ys), median(zs));
      const medianLongest = median(entries.map((e) => e.longest));
      const distThreshold = Math.max(0.6, medianLongest * 8);

      const filtered = entries.filter((e) => e.center.distanceTo(medianCenter) <= distThreshold);
      const use = filtered.length >= Math.max(1, Math.floor(entries.length * 0.5)) ? filtered : entries;

      const box = new THREE.Box3();
      for (const e of use) box.union(e.box);
      return box;
    };

    const box = robustBoxFromMeshes(scene) || new THREE.Box3().setFromObject(scene);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    const longest = Math.max(size.x, size.y, size.z);

    const target = 0.9;
    let s = longest > 0.0001 ? (target / longest) : 1.0;
    if (!Number.isFinite(s) || s <= 0) s = 1.0;
    // Guard against extreme bounding boxes producing an invisible model.
    s = Math.max(0.002, Math.min(200, s));

    // Some GLBs have a far-away pivot causing the model to be off-screen (even if the view root is correct).
    // Recenter only when clearly off-origin to preserve the "feel" of well-behaved models.
    const centerDist = center.length();
    if (Number.isFinite(centerDist) && Number.isFinite(longest)) {
      const threshold = Math.max(0.6, longest * 0.75);
      const pathLower = String(path || '').toLowerCase();
      const forceRecentre = pathLower.includes('pistol');
      if (forceRecentre || centerDist > threshold) {
        scene.position.sub(center);
      }
    }

    const userScale = CONFIG.PLAYER_WEAPON_SCALE ?? 1.0;
    scene.scale.setScalar(s * userScale);

    return scene;
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
