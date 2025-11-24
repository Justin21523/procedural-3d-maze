import * as THREE from 'three';
import { CONFIG } from '../core/config.js';

/**
 * Lightweight Monster entity (data container).
 * All decision making lives in src/ai/monsterAI.js.
 */
export class Monster {
  constructor(model, spawnGrid = { x: 0, y: 0 }, worldState = null, typeConfig = {}) {
    this.model = model;
    this.worldState = worldState;
    this.typeConfig = typeConfig || {};
    this.stats = this.typeConfig.stats || {};

    this.speed = this.stats.speed ?? CONFIG.MONSTER_SPEED;
    this.visionRange = this.stats.visionRange ?? CONFIG.MONSTER_VISION_RANGE;
    this.visionFOV = this.stats.visionFOV ?? CONFIG.MONSTER_FOV;
    this.scale = this.stats.scale ?? CONFIG.MONSTER_SCALE_MULTIPLIER;

    // Basic identity
    this.type = this.typeConfig.name || 'Monster';
    this.isDead = false;

    // Positioning
    this.gridX = spawnGrid.x ?? 0;
    this.gridY = spawnGrid.y ?? 0;
    this.gridPos = { x: this.gridX, y: this.gridY };
    this.yaw = 0;

    // Animation (optional)
    this.mixer = null;
    this.activeAction = null;

    // Ensure a usable model and position reference
    this.position = this.model?.position || new THREE.Vector3();
    this.applyScale();
    this.syncWorldFromGrid();
  }

  /**
   * Make sure the model sits above the floor by lifting it so the bounding box
   * bottom aligns with y≈0 (plus a tiny offset to prevent z-fighting).
   */
  alignToGround(offset = 0.02) {
    if (!this.model) return;
    this.model.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(this.model);
    const height = box.max.y - box.min.y;
    if (!Number.isFinite(height) || height <= 0) return;

    const deltaY = offset - box.min.y;
    if (Math.abs(deltaY) > 0.0001) {
      this.model.position.y += deltaY;
      // 保底，避免數值誤差讓模型仍低於地板
      this.model.position.y = Math.max(this.model.position.y, offset);
    }
  }

  applyScale() {
    if (!this.model) return;
    const s = this.scale || 1;
    this.model.scale.setScalar(s);
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
      this.model.position.copy(vec3);
      this.alignToGround();
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
    this.yaw = yaw;
    if (this.model) {
      this.model.rotation.y = yaw;
    }
  }

  getSpeed(isSprinting = false) {
    const sprintMultiplier = isSprinting ? 1.4 : 1.0;
    return this.speed * sprintMultiplier;
  }

  setModel(newModel) {
    const currentPos = this.getWorldPosition();
    this.model = newModel;
    this.position = newModel?.position || this.position;
    this.applyScale();
    if (currentPos && this.model) {
      this.model.position.copy(currentPos);
      this.model.rotation.y = this.yaw;
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
    this.mixer = new THREE.AnimationMixer(this.model);
    const clip = animations[0];
    this.activeAction = this.mixer.clipAction(clip);
    this.activeAction.play();
  }

  updateAnimation(deltaTime) {
    if (this.mixer) {
      this.mixer.update(deltaTime);
    }
  }
}
