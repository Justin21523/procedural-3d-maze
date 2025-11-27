/**
 * Player controller
 * Handles movement, collision, and camera sync with optional autopilot input.
 */

import * as THREE from 'three';
import { CONFIG } from '../core/config.js';
import { worldToGrid, gridToWorld } from '../utils/math.js';

export class PlayerController {
  /**
   * @param {WorldState} worldState
   * @param {FirstPersonCamera} camera
   * @param {InputHandler} input
   * @param {GameState} gameState
   * @param {AudioManager} audioManager
   */
  constructor(worldState, camera, input, gameState = null, audioManager = null) {
    this.worldState = worldState;
    this.camera = camera;
    this.input = input;
    this.gameState = gameState;
    this.audioManager = audioManager;

    // Position & movement state
    this.position = new THREE.Vector3(0, CONFIG.PLAYER_HEIGHT, 0);
    this.velocity = new THREE.Vector3(0, 0, 0);
    this.externalMove = null;
    this.externalLookYaw = null;

    // Tracking
    this.lastPosition = new THREE.Vector3();
    this.distanceMoved = 0;
    this.stepDistance = 2;
    this.lastGridX = -1;
    this.lastGridY = -1;
    this.footstepTimer = 0;
    this.stuckTimer = 0;

    // Spawn at a safe tile center
    const spawnPoint = worldState.getSpawnPoint();
    const worldSpawn = gridToWorld(spawnPoint.x, spawnPoint.y, CONFIG.TILE_SIZE);
    this.position.set(
      worldSpawn.x + CONFIG.TILE_SIZE / 2,
      CONFIG.PLAYER_HEIGHT,
      worldSpawn.z + CONFIG.TILE_SIZE / 2
    );
    this.camera.updatePosition(this.position.x, this.position.y, this.position.z);
  }

  /**
   * Frame update; merges mouse look and optional external command.
   * @param {number} deltaTime
   * @param {boolean} autopilotActive
   * @param {Object|null} externalCommand
   */
  update(deltaTime, autopilotActive = false, externalCommand = null) {
    // Allow autopilot movement even without pointer lock
    if (!this.input.isPointerLocked() && !autopilotActive) {
      return;
    }

    if (externalCommand) {
      this.applyExternalControl(externalCommand, deltaTime);
    }

    this.lastPosition.copy(this.position);

    // Player look always honored first
    const mouseDelta = this.input.consumeMouseDelta();
    this.camera.updateRotation(mouseDelta.x, mouseDelta.y);

    // Autopilot absolute yaw (if any) comes after manual look, smoothed
    if (this.externalLookYaw !== null) {
      const currentYaw = this.camera.getYaw();
      let delta = this.externalLookYaw - currentYaw;
      // Wrap to [-PI, PI]
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      const maxStep = (CONFIG.AUTOPILOT_TURN_SPEED || 3) * deltaTime;
      const applied = Math.max(-maxStep, Math.min(maxStep, delta));
      this.camera.setYaw(currentYaw + applied);
      this.externalLookYaw = null;
    }

    const moveVector = this.externalMove
      ? this.externalMove.clone()
      : this.calculateMovement(deltaTime);

    this.applyMovement(moveVector);
    this.updateStatistics();
    this.camera.updatePosition(this.position.x, this.position.y, this.position.z);

    // Clear one-frame external move
    this.externalMove = null;
  }

  /**
   * Track steps and visited rooms for stats/footsteps.
   */
  updateStatistics() {
    const distance = this.position.distanceTo(this.lastPosition);
    if (distance > 0) {
      this.distanceMoved += distance;

      if (this.distanceMoved >= this.stepDistance) {
        if (this.gameState) {
          this.gameState.addStep();
        }

        if (this.audioManager) {
          const isRunning = this.input.isSprinting();
          this.audioManager.playFootstep(isRunning);
        }

        this.distanceMoved = 0;
      }
    }

    if (!this.gameState) return;

    const gridPos = this.getGridPosition();
    if (gridPos.x !== this.lastGridX || gridPos.y !== this.lastGridY) {
      this.lastGridX = gridPos.x;
      this.lastGridY = gridPos.y;
      const roomType = this.worldState.getRoomType(gridPos.x, gridPos.y);
      this.gameState.visitRoom(roomType);
    }
  }

  /**
   * Calculate player-driven movement vector.
   * @param {number} deltaTime
   * @returns {THREE.Vector3}
   */
  calculateMovement(deltaTime) {
    const moveInput = this.input.getMovementInput();
    if (moveInput.x === 0 && moveInput.y === 0) {
      return new THREE.Vector3(0, 0, 0);
    }

    const forward = this.camera.getForwardVector();
    const right = this.camera.getRightVector();

    const moveDirection = new THREE.Vector3();
    moveDirection.addScaledVector(forward, moveInput.y);
    moveDirection.addScaledVector(right, moveInput.x);
    moveDirection.normalize();

    let speed = CONFIG.PLAYER_SPEED;
    if (this.input.isSprinting()) {
      speed *= 1.5;
    }

    moveDirection.multiplyScalar(speed * deltaTime);
    return moveDirection;
  }

  /**
   * Apply external (autopilot) command as one-frame movement/look.
   * @param {Object} cmd
   * @param {number} deltaTime
   */
  applyExternalControl(cmd, deltaTime = 1 / CONFIG.TARGET_FPS) {
    const baseSpeed = CONFIG.PLAYER_SPEED;
    const speed = cmd?.sprint ? baseSpeed * 1.2 : baseSpeed;

    if (cmd?.moveWorld) {
      const mv = new THREE.Vector3(cmd.moveWorld.x, 0, cmd.moveWorld.z);
      if (mv.lengthSq() > 0) {
        mv.normalize().multiplyScalar(speed * deltaTime);
        this.externalMove = mv;
      }
    } else if (cmd?.move) {
      const mv = new THREE.Vector3();
      const yaw = typeof cmd.lookYaw === 'number' ? cmd.lookYaw : this.camera.getYaw();
      const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      mv.addScaledVector(forward, cmd.move.y);
      mv.addScaledVector(right, cmd.move.x);
      if (mv.lengthSq() > 0) {
        mv.normalize().multiplyScalar(speed * deltaTime);
        this.externalMove = mv;
      }
    }

    if (cmd?.lookYaw !== undefined && cmd.lookYaw !== null) {
      this.externalLookYaw = cmd.lookYaw;
    }
  }

  /**
   * Move with collision; includes sliding and wall separation to reduce sticking.
   * @param {THREE.Vector3} moveVector
   */
  applyMovement(moveVector) {
    if (moveVector.lengthSq() === 0) {
      return;
    }

    const beforePos = this.position.clone();
    const targetX = this.position.x + moveVector.x;
    const targetZ = this.position.z + moveVector.z;

    // 1) Try full move
    if (this.canMoveTo(targetX, targetZ)) {
      this.position.x = targetX;
      this.position.z = targetZ;
      this.separateFromWalls();
      return;
    }

    // 2) Axis-aligned slide (favor larger axis)
    let moved = false;
    if (Math.abs(moveVector.x) > Math.abs(moveVector.z)) {
      const newPosX = this.position.x + moveVector.x;
      if (this.canMoveTo(newPosX, this.position.z)) {
        this.position.x = newPosX;
        moved = true;
      }
      const newPosZ = this.position.z + moveVector.z;
      if (this.canMoveTo(this.position.x, newPosZ)) {
        this.position.z = newPosZ;
        moved = true;
      }
    } else {
      const newPosZ = this.position.z + moveVector.z;
      if (this.canMoveTo(this.position.x, newPosZ)) {
        this.position.z = newPosZ;
        moved = true;
      }
      const newPosX = this.position.x + moveVector.x;
      if (this.canMoveTo(newPosX, this.position.z)) {
        this.position.x = newPosX;
        moved = true;
      }
    }

    // 3) If barely moved, attempt small nudge to get unstuck
    const movedDistance = this.position.distanceTo(beforePos);
    if (movedDistance < 0.0001) {
      this.tryUnstuck(moveVector);
    } else {
      this.stuckTimer = 0;
    }

    // 4) Final separation from nearby walls/corners
    this.separateFromWalls();
  }

  /**
   * Resolve small overlaps between player circle and nearby walls.
   */
  separateFromWalls() {
    if (!this.worldState || !this.worldState.isWalkable) {
      return;
    }

    const tileSize = CONFIG.TILE_SIZE || 1;
    const radius = CONFIG.PLAYER_RADIUS;
    const gridPos = this.getGridPosition();

    let centerX = this.position.x;
    let centerZ = this.position.z;

    for (let gy = gridPos.y - 1; gy <= gridPos.y + 1; gy++) {
      for (let gx = gridPos.x - 1; gx <= gridPos.x + 1; gx++) {
        if (this.worldState.isWalkable(gx, gy)) {
          continue;
        }

        const tileMinX = gx * tileSize;
        const tileMaxX = tileMinX + tileSize;
        const tileMinZ = gy * tileSize;
        const tileMaxZ = tileMinZ + tileSize;

        const nearestX = Math.max(tileMinX, Math.min(centerX, tileMaxX));
        const nearestZ = Math.max(tileMinZ, Math.min(centerZ, tileMaxZ));

        const dx = centerX - nearestX;
        const dz = centerZ - nearestZ;
        const distSq = dx * dx + dz * dz;

        if (distSq === 0 || distSq >= radius * radius) {
          continue;
        }

        const dist = Math.sqrt(distSq) || 0.0001;
        const overlap = (radius - dist) * 1.05;
        const nx = dx / dist;
        const nz = dz / dist;

        const newX = centerX + nx * overlap;
        const newZ = centerZ + nz * overlap;

        if (this.canMoveTo(newX, newZ)) {
          this.position.x = newX;
          this.position.z = newZ;
          centerX = newX;
          centerZ = newZ;
        }
      }
    }
  }

  /**
   * Lightweight unstuck: probe nearby offsets or teleport to closest walkable tile.
   * @param {THREE.Vector3} moveVector
   */
  tryUnstuck(moveVector) {
    this.stuckTimer += 1;
    const offsets = [
      new THREE.Vector3(0.05, 0, 0),
      new THREE.Vector3(-0.05, 0, 0),
      new THREE.Vector3(0, 0, 0.05),
      new THREE.Vector3(0, 0, -0.05),
      new THREE.Vector3(moveVector.x * 0.1, 0, moveVector.z * 0.1),
    ];

    for (const off of offsets) {
      const nx = this.position.x + off.x;
      const nz = this.position.z + off.z;
      if (this.canMoveTo(nx, nz)) {
        this.position.x = nx;
        this.position.z = nz;
        return;
      }
    }

    // Fallback: snap to nearest walkable tile center if available
    const grid = this.getGridPosition();
    if (this.worldState && this.worldState.isWalkable(grid.x, grid.y)) {
      const center = gridToWorld(grid.x, grid.y, CONFIG.TILE_SIZE);
      this.position.x = center.x + CONFIG.TILE_SIZE / 2;
      this.position.z = center.z + CONFIG.TILE_SIZE / 2;
    }
  }

  /**
   * Force a gentle nudge if external systems detect prolonged immobility.
   */
  forceUnstuck() {
    this.tryUnstuck(new THREE.Vector3(0.05, 0, 0));
    this.separateFromWalls();
  }

  /**
   * Can the player occupy the given world coordinates?
   * @param {number} worldX
   * @param {number} worldZ
   * @returns {boolean}
   */
  canMoveTo(worldX, worldZ) {
    const gridPos = worldToGrid(worldX, worldZ, CONFIG.TILE_SIZE);

    if (!this.worldState.isWalkable(gridPos.x, gridPos.y)) {
      return false;
    }

    const radius = CONFIG.PLAYER_RADIUS * 0.9;
    const offsets = [
      { x: radius, z: radius },
      { x: radius, z: -radius },
      { x: -radius, z: radius },
      { x: -radius, z: -radius },
      { x: radius, z: 0 },
      { x: -radius, z: 0 },
      { x: 0, z: radius },
      { x: 0, z: -radius },
    ];

    for (const offset of offsets) {
      const checkPos = worldToGrid(
        worldX + offset.x,
        worldZ + offset.z,
        CONFIG.TILE_SIZE
      );

      if (!this.worldState.isWalkable(checkPos.x, checkPos.y)) {
        return false;
      }
    }

    return true;
  }

  /**
   * @returns {THREE.Vector3} current world position clone
   */
  getPosition() {
    return this.position.clone();
  }

  /**
   * @returns {{x:number,y:number}} current grid position
   */
  getGridPosition() {
    return worldToGrid(this.position.x, this.position.z, CONFIG.TILE_SIZE);
  }

  /**
   * Teleport player to world coordinates.
   * @param {number} x
   * @param {number} y
   * @param {number} z
   */
  setPosition(x, y, z) {
    this.position.set(x, y, z);
    this.camera.updatePosition(x, y, z);
  }
}
