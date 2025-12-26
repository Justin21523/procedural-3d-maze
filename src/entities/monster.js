import * as THREE from 'three';
import { CONFIG } from '../core/config.js';

let nextMonsterId = 1;

/**
 * Lightweight Monster entity (data container).
 * All decision making lives in src/ai/monsterAI.js.
 */
export class Monster {
  constructor(model, spawnGrid = { x: 0, y: 0 }, worldState = null, typeConfig = {}, levelConfig = null) {
    this.model = model;
    this.worldState = worldState;
    this.typeConfig = typeConfig || {};
    this.stats = this.typeConfig.stats || {};

    const speedFactor = this.stats.speedFactor ?? 1.0;
    const levelSpeed =
      levelConfig?.monsters?.speedMultiplier ??
      CONFIG.MONSTER_LEVEL_SPEED_MULT ??
      1.0;

    this.baseSpeed =
      CONFIG.PLAYER_SPEED *
      (CONFIG.MONSTER_BASE_SPEED_FACTOR ?? 0.8) *
      speedFactor *
      levelSpeed;

    this.speed = this.baseSpeed;
    this.speedMultiplier = 1.0;

    const visionMult = levelConfig?.monsters?.visionMultiplier ?? 1.0;
    this.visionRange = (this.stats.visionRange ?? CONFIG.MONSTER_VISION_RANGE) * visionMult;
    this.visionFOV = this.stats.visionFOV ?? CONFIG.MONSTER_FOV;
    this.scale = this.stats.scale ?? CONFIG.MONSTER_SCALE_MULTIPLIER;
    this.groundOffset = Number.isFinite(this.stats.groundOffset) ? this.stats.groundOffset : null;
    this.hitRadius = Number.isFinite(this.stats.hitRadius) ? this.stats.hitRadius : null;

    // Basic identity
    this.type = this.typeConfig.name || 'Monster';
    this.id = nextMonsterId++;
    this.isDead = false;

    // Combat state
    const baseHealth = Number.isFinite(this.stats.health)
      ? this.stats.health
      : (CONFIG.MONSTER_BASE_HEALTH ?? 10);
    const healthMult = levelConfig?.monsters?.healthMultiplier ?? 1.0;
    this.maxHealth = Math.max(1, Math.round(baseHealth * healthMult));
    this.health = this.maxHealth;
    this.stunTimer = 0;
    this.lastDamagedAt = -Infinity;

    // Positioning
    this.gridX = spawnGrid.x ?? 0;
    this.gridY = spawnGrid.y ?? 0;
    this.gridPos = { x: this.gridX, y: this.gridY };
    this.yaw = 0;

    // Animation (optional)
    this.mixer = null;
    this.activeAction = null;
    this.activeActionName = null;
    this.actions = null;
    this.isMoving = false;
    this.isSprinting = false;

    // Ensure a usable model and position reference
    this.position = this.model?.position || new THREE.Vector3();
    this.applyScale();
    this.syncWorldFromGrid();
    this.cacheModelNodes();
  }

  cacheModelNodes() {
    this.yawNode = null;
    this.innerNode = null;
    if (!this.model || typeof this.model.getObjectByName !== 'function') return;
    this.yawNode = this.model.getObjectByName('__monsterYaw') || null;
    this.innerNode = this.model.getObjectByName('__monsterInner') || null;
  }

  normalizeAnimName(name) {
    return String(name || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
  }

  pickClip(animations, aliases) {
    if (!Array.isArray(animations) || animations.length === 0) return null;
    const list = Array.isArray(aliases) ? aliases : [aliases];
    const needles = list
      .filter(Boolean)
      .map((s) => this.normalizeAnimName(s))
      .filter(Boolean);

    if (needles.length === 0) return null;

    for (const clip of animations) {
      const clipName = this.normalizeAnimName(clip?.name);
      if (!clipName) continue;
      for (const needle of needles) {
        if (clipName === needle || clipName.includes(needle)) {
          return clip;
        }
      }
    }
    return null;
  }

  playAction(name, fadeSeconds = 0.15) {
    if (!this.actions) return;
    const next = this.actions[name];
    if (!next) return;
    if (this.activeAction === next) {
      this.activeActionName = name;
      return;
    }

    next.reset();
    next.enabled = true;
    next.setEffectiveWeight(1);
    next.play();

    if (this.activeAction) {
      this.activeAction.crossFadeTo(next, fadeSeconds, false);
    }

    this.activeAction = next;
    this.activeActionName = name;
  }

  /**
   * Make sure the model sits above the floor by lifting it so the bounding box
   * bottom aligns with y≈0 (plus a tiny offset to prevent z-fighting).
   */
  alignToGround(offset = null) {
    if (!this.model) return;
    const desiredOffset =
      Number.isFinite(offset) ? offset :
      (Number.isFinite(this.groundOffset) ? this.groundOffset : 0.02);
    this.model.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(this.model);
    const height = box.max.y - box.min.y;
    if (!Number.isFinite(height) || height <= 0) return;

    // Robust bottom detection: ignore rare outlier meshes far below the character.
    let bottomY = box.min.y;
    const meshMinYs = [];
    this.model.traverse((child) => {
      if (!child) return;
      if (!child.isMesh && !child.isSkinnedMesh) return;
      const childBox = new THREE.Box3().setFromObject(child);
      const minY = childBox.min.y;
      if (Number.isFinite(minY)) meshMinYs.push(minY);
    });

    if (meshMinYs.length > 0) {
      meshMinYs.sort((a, b) => a - b);
      const p10 = meshMinYs[Math.min(meshMinYs.length - 1, Math.floor(meshMinYs.length * 0.1))];
      if (Number.isFinite(p10) && (p10 - box.min.y) > height * 0.25) {
        bottomY = p10;
      }
    }

    const deltaY = desiredOffset - bottomY;
    if (Math.abs(deltaY) > 0.0001) {
      this.model.position.y += deltaY;
      // 保底，避免數值誤差讓模型仍低於地板
      this.model.position.y = Math.max(this.model.position.y, desiredOffset);
    }
  }

  applyScale() {
    if (!this.model) return;

    // Normalize different source model units so all monsters share a consistent "real" height.
    // Target height is in world units (≈ meters), matching CONFIG.PLAYER_HEIGHT scale.
    const baseHeight = CONFIG.MONSTER_BASE_HEIGHT ?? 1.8;
    const heightMultiplier = this.scale || 1;
    const targetHeight = baseHeight * heightMultiplier;

    this.model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.model);
    const height = box.max.y - box.min.y;

    if (Number.isFinite(height) && height > 0.0001 && Number.isFinite(targetHeight) && targetHeight > 0) {
      const factor = targetHeight / height;
      this.model.scale.multiplyScalar(factor);
    } else {
      // Fallback: if we can't measure size, keep existing scale (or apply multiplier).
      this.model.scale.setScalar(heightMultiplier);
    }
  }

  syncWorldFromGrid() {
    const tileSize = CONFIG.TILE_SIZE || 1;
    const worldX = (this.gridX + 0.5) * tileSize;
    const worldZ = (this.gridY + 0.5) * tileSize;
    if (this.model) {
      this.model.position.set(worldX, this.model.position.y || 0, worldZ);
      this.alignToGround();
    } else {
      this.position.set(worldX, this.position.y || 0, worldZ);
    }
  }

  syncGridFromWorld() {
    const pos = this.getWorldPosition();
    if (!pos) return;
    const tileSize = CONFIG.TILE_SIZE || 1;
    this.gridX = Math.floor(pos.x / tileSize);
    this.gridY = Math.floor(pos.z / tileSize);
    this.gridPos = { x: this.gridX, y: this.gridY };
  }

  getGridPosition() {
    return { x: this.gridX, y: this.gridY };
  }

  setGridPosition({ x, y }) {
    this.gridX = x;
    this.gridY = y;
    this.gridPos = { x, y };
    this.syncWorldFromGrid();
  }

  setWorldPosition(vec3) {
    if (!vec3) return;
    if (this.model) {
      // Preserve Y so animated bounding boxes don't cause vertical jitter.
      const y = this.model.position.y;
      this.model.position.set(vec3.x, y, vec3.z);
    } else {
      this.position.copy(vec3);
    }
    this.syncGridFromWorld();
  }

  getWorldPosition() {
    if (this.model) {
      return this.model.position.clone();
    }
    return new THREE.Vector3(
      (this.gridX + 0.5) * CONFIG.TILE_SIZE,
      0,
      (this.gridY + 0.5) * CONFIG.TILE_SIZE
    );
  }

  getYaw() {
    return this.yaw;
  }

  setYaw(yaw) {
    let nextYaw = yaw;
    if (!Number.isFinite(nextYaw)) nextYaw = 0;
    const twoPi = Math.PI * 2;
    nextYaw = ((nextYaw + Math.PI) % twoPi + twoPi) % twoPi - Math.PI;
    this.yaw = nextYaw;
    const target = this.yawNode || this.model;
    if (target) target.rotation.y = nextYaw;
  }

  getSpeed(isSprinting = false) {
    const sprintMultiplier = isSprinting ? (CONFIG.MONSTER_SPRINT_MULTIPLIER || 1.6) : 1.0;
    const speedMultiplier = this.speedMultiplier ?? 1.0;
    return this.baseSpeed * speedMultiplier * sprintMultiplier;
  }

  setModel(newModel) {
    const currentPos = this.getWorldPosition();
    this.model = newModel;
    this.position = newModel?.position || this.position;
    this.cacheModelNodes();
    this.applyScale();
    if (currentPos && this.model) {
      this.model.position.copy(currentPos);
      this.setYaw(this.yaw);
      this.alignToGround();
    }
  }

  getModel() {
    return this.model;
  }

  /**
   * Minimal animation wiring (optional).
   */
  setupAnimations(animations) {
    if (!animations || animations.length === 0 || !this.model) return;

    // Reset any previous mixer/actions (model may have been replaced)
    if (this.mixer) {
      this.mixer.stopAllAction();
    }

    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = {};
    this.activeAction = null;
    this.activeActionName = null;

    const mapping = this.typeConfig?.animations || {};
    const fallback = {
      idle: ['idle', 'stand', 'rest', 'default'],
      walk: ['walk', 'walking', 'move'],
      run: ['run', 'running', 'sprint'],
      attack: ['attack', 'hit', 'bite', 'slash']
    };

    const idleClip =
      this.pickClip(animations, [...(mapping.idle || []), ...fallback.idle]) ||
      animations[0];
    const walkClip =
      this.pickClip(animations, [...(mapping.walk || []), ...fallback.walk]) ||
      null;
    const runClip =
      this.pickClip(animations, [...(mapping.run || []), ...fallback.run]) ||
      null;
    const attackClip =
      this.pickClip(animations, [...(mapping.attack || []), ...fallback.attack]) ||
      null;

    const add = (key, clip) => {
      if (!clip) return;
      const action = this.mixer.clipAction(clip);
      action.enabled = true;
      action.clampWhenFinished = false;
      action.setLoop(THREE.LoopRepeat, Infinity);
      this.actions[key] = action;
    };

    add('idle', idleClip);
    add('walk', walkClip);
    add('run', runClip);
    add('attack', attackClip);

    // If we only found one useful clip, treat it as both idle and walk.
    if (!this.actions.walk && this.actions.idle) {
      this.actions.walk = this.actions.idle;
    }
    if (!this.actions.run && this.actions.walk) {
      this.actions.run = this.actions.walk;
    }

    // Start in idle
    if (this.actions.idle) {
      this.playAction('idle', 0);
    } else {
      const first = Object.keys(this.actions)[0];
      if (first) this.playAction(first, 0);
    }
  }

  updateAnimation(deltaTime) {
    if (!this.mixer) return;

    const moving = !!this.isMoving;
    const sprinting = !!this.isSprinting;
    const desired =
      !moving ? 'idle' :
      sprinting && this.actions?.run ? 'run' :
      this.actions?.walk ? 'walk' :
      'idle';

    if (desired && desired !== this.activeActionName) {
      this.playAction(desired, 0.2);
    }

    this.mixer.update(deltaTime);

    // Prevent root-motion drift: keep the loader's inner root anchored.
    const inner =
      this.innerNode ||
      (this.model?.getObjectByName ? this.model.getObjectByName('__monsterInner') : null) ||
      this.model?.children?.[0];
    const basePos =
      inner?.userData?.__basePosition ||
      this.model?.userData?.innerBasePosition;
    const baseQuat =
      inner?.userData?.__baseQuaternion ||
      this.model?.userData?.innerBaseQuaternion;
    if (inner && Array.isArray(basePos) && basePos.length === 3) {
      inner.position.set(basePos[0], basePos[1], basePos[2]);
    }
    if (inner && Array.isArray(baseQuat) && baseQuat.length === 4) {
      inner.quaternion.set(baseQuat[0], baseQuat[1], baseQuat[2], baseQuat[3]);
    }
  }
}
