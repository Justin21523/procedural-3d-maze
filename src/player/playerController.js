/**
 * Player controller
 * Handles movement, collision, and camera sync with optional autopilot input.
 */

import * as THREE from 'three';
import { CONFIG } from '../core/config.js';
import { EVENTS } from '../core/events.js';
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

    // Defense (block/guard)
    this.blocking = false;
    this.blockStaminaMax = CONFIG.PLAYER_BLOCK_STAMINA_MAX ?? 100;
    this.blockStamina = this.blockStaminaMax;
    this.blockCooldown = 0;

    // Position & movement state
    this.position = new THREE.Vector3(0, CONFIG.PLAYER_HEIGHT, 0);
    this.velocity = new THREE.Vector3(0, 0, 0);
    this.externalMove = null;
    this.externalLookYaw = null;
    this.externalLookPitch = null;
    this.externalSprinting = false;

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

    this.updateBlockState(deltaTime, externalCommand);

    this.externalSprinting = false;
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

    // Autopilot absolute pitch (if any) comes after manual look, smoothed
    if (this.externalLookPitch !== null) {
      const currentPitch = this.camera.getPitch ? this.camera.getPitch() : 0;
      const delta = this.externalLookPitch - currentPitch;
      const maxStep = (CONFIG.AUTOPILOT_TURN_SPEED || 3) * deltaTime;
      const applied = Math.max(-maxStep, Math.min(maxStep, delta));
      if (typeof this.camera.setPitch === 'function') {
        this.camera.setPitch(currentPitch + applied);
      }
      this.externalLookPitch = null;
    }

    let moveVector = this.externalMove
      ? this.externalMove.clone()
      : this.calculateMovement(deltaTime);

    if (this.blocking) {
      const mult = CONFIG.PLAYER_BLOCK_MOVE_MULT ?? 0.85;
      if (Number.isFinite(mult) && mult >= 0) {
        moveVector.multiplyScalar(mult);
      }
    }

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
    this.externalSprinting = !!cmd?.sprint;
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

    if (cmd?.lookPitch !== undefined && cmd.lookPitch !== null) {
      this.externalLookPitch = cmd.lookPitch;
    }
  }

  /**
   * Move with collision; includes sliding and wall separation to reduce sticking.
   * @param {THREE.Vector3} moveVector
   */
  applyMovement(moveVector) {
    if (moveVector.lengthSq() === 0) return;

    const beforeX = this.position.x;
    const beforeZ = this.position.z;

    // Sweep via step subdivision to avoid tunneling through walls/obstacles when dt spikes.
    const tileSize = CONFIG.TILE_SIZE || 1;
    const radius = CONFIG.PLAYER_RADIUS || 0.35;
    const maxStep = Math.max(0.05, Math.min(tileSize * 0.25, radius * 0.5));
    const dist = Math.hypot(moveVector.x, moveVector.z);
    const steps = Math.max(1, Math.ceil(dist / maxStep));

    const stepX = moveVector.x / steps;
    const stepZ = moveVector.z / steps;

    for (let i = 0; i < steps; i++) {
      this.applyMovementStep(stepX, stepZ);
    }

    // If barely moved, attempt small nudge to get unstuck
    const dx = this.position.x - beforeX;
    const dz = this.position.z - beforeZ;
    const movedDistance = Math.hypot(dx, dz);
    if (movedDistance < 0.0001) {
      this.tryUnstuck(moveVector);
    } else {
      this.stuckTimer = 0;
    }

    // Final separation from nearby walls/corners
    this.separateFromWalls();
  }

  applyMovementStep(stepX, stepZ) {
    if (!Number.isFinite(stepX) || !Number.isFinite(stepZ)) return;
    if (Math.abs(stepX) <= 1e-8 && Math.abs(stepZ) <= 1e-8) return;

    const targetX = this.position.x + stepX;
    const targetZ = this.position.z + stepZ;

    // 1) Try full move
    if (this.canMoveTo(targetX, targetZ)) {
      this.position.x = targetX;
      this.position.z = targetZ;
      return;
    }

    const sweepMove = (dx, dz) => {
      if (Math.abs(dx) <= 1e-8 && Math.abs(dz) <= 1e-8) return 0;

      const startX = this.position.x;
      const startZ = this.position.z;
      const fullX = startX + dx;
      const fullZ = startZ + dz;
      if (this.canMoveTo(fullX, fullZ)) {
        this.position.x = fullX;
        this.position.z = fullZ;
        return 1;
      }

      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 6; i++) {
        const mid = (lo + hi) * 0.5;
        const testX = startX + dx * mid;
        const testZ = startZ + dz * mid;
        if (this.canMoveTo(testX, testZ)) {
          lo = mid;
        } else {
          hi = mid;
        }
      }

      const safe = lo > 0 ? Math.max(0, lo - 0.02) : 0;
      if (safe > 0) {
        this.position.x = startX + dx * safe;
        this.position.z = startZ + dz * safe;
      }
      return safe;
    };

    // 2) Axis-aligned slide (favor larger axis), but sweep to the closest valid position.
    if (Math.abs(stepX) > Math.abs(stepZ)) {
      sweepMove(stepX, 0);
      sweepMove(0, stepZ);
    } else {
      sweepMove(0, stepZ);
      sweepMove(stepX, 0);
    }
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

        if (distSq === 0) {
          // Player center is inside the blocked tile; push out toward the nearest edge.
          const toLeft = Math.abs(centerX - tileMinX);
          const toRight = Math.abs(tileMaxX - centerX);
          const toTop = Math.abs(centerZ - tileMinZ);
          const toBottom = Math.abs(tileMaxZ - centerZ);
          const min = Math.min(toLeft, toRight, toTop, toBottom);

          let newX = centerX;
          let newZ = centerZ;
          const pad = radius * 1.05;
          if (min === toLeft) newX = tileMinX - pad;
          else if (min === toRight) newX = tileMaxX + pad;
          else if (min === toTop) newZ = tileMinZ - pad;
          else newZ = tileMaxZ + pad;

          if (this.canMoveTo(newX, newZ)) {
            this.position.x = newX;
            this.position.z = newZ;
            centerX = newX;
            centerZ = newZ;
          }
          continue;
        }

        if (distSq >= radius * radius) {
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
    if (!this.worldState?.isWalkable) return true;
    if (!Number.isFinite(worldX) || !Number.isFinite(worldZ)) return false;

    const tileSize = CONFIG.TILE_SIZE || 1;
    const radius = CONFIG.PLAYER_RADIUS || 0.35;
    const gridPos = worldToGrid(worldX, worldZ, tileSize);

    // Quick reject: center tile must be walkable.
    if (!this.worldState.isWalkable(gridPos.x, gridPos.y)) return false;

    // Circle-vs-tile overlap check against nearby blocked tiles (walls + obstacleMap).
    for (let gy = gridPos.y - 1; gy <= gridPos.y + 1; gy++) {
      for (let gx = gridPos.x - 1; gx <= gridPos.x + 1; gx++) {
        if (this.worldState.isWalkable(gx, gy)) continue;

        const tileMinX = gx * tileSize;
        const tileMaxX = tileMinX + tileSize;
        const tileMinZ = gy * tileSize;
        const tileMaxZ = tileMinZ + tileSize;

        const nearestX = Math.max(tileMinX, Math.min(worldX, tileMaxX));
        const nearestZ = Math.max(tileMinZ, Math.min(worldZ, tileMaxZ));

        const dx = worldX - nearestX;
        const dz = worldZ - nearestZ;
        if (dx * dx + dz * dz < radius * radius) {
          return false;
        }
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
   * @returns {boolean} True if sprinting
   */
  isSprinting() {
    return !!this.input?.isSprinting?.() || !!this.externalSprinting;
  }

  isBlocking() {
    return !!this.blocking;
  }

  getBlockState() {
    return {
      blocking: !!this.blocking,
      stamina: this.blockStamina,
      maxStamina: this.blockStaminaMax,
      cooldown: this.blockCooldown
    };
  }

  /**
   * Damage multiplier applied by CombatSystem.
   * @returns {number} 0..1
   */
  getDamageTakenMultiplier() {
    if (!(CONFIG.PLAYER_BLOCK_ENABLED ?? true)) return 1.0;
    if (!this.blocking) return 1.0;
    if ((this.blockCooldown || 0) > 0) return 1.0;
    if ((this.blockStamina || 0) <= 0) return 1.0;
    const mult = CONFIG.PLAYER_BLOCK_DAMAGE_MULT ?? 0.35;
    if (!Number.isFinite(mult)) return 1.0;
    return Math.max(0, Math.min(1, mult));
  }

  updateBlockState(deltaTime, externalCommand = null) {
    const dt = deltaTime ?? 0;
    if (!(dt > 0)) return;

    const enabled = CONFIG.PLAYER_BLOCK_ENABLED ?? true;
    const maxStamina = CONFIG.PLAYER_BLOCK_STAMINA_MAX ?? 100;
    const drain = CONFIG.PLAYER_BLOCK_STAMINA_DRAIN ?? 34;
    const regen = CONFIG.PLAYER_BLOCK_STAMINA_REGEN ?? 22;
    const cooldownSeconds = CONFIG.PLAYER_BLOCK_COOLDOWN ?? 1.2;
    const minStart = CONFIG.PLAYER_BLOCK_MIN_STAMINA_START ?? 10;

    const eventBus = this.gameState?.eventBus || null;
    const wasBlocking = !!this.blocking;
    let broke = false;

    this.blockCooldown = Math.max(0, (this.blockCooldown || 0) - dt);
    this.blockStaminaMax = Number.isFinite(maxStamina) && maxStamina > 0 ? maxStamina : 100;
    this.blockStamina = Math.max(0, Math.min(this.blockStaminaMax, this.blockStamina));

    if (!enabled) {
      this.blocking = false;
      this.blockCooldown = 0;
      this.blockStamina = this.blockStaminaMax;
      if (wasBlocking && eventBus?.emit) {
        eventBus.emit(EVENTS.PLAYER_BLOCK_END, this.getBlockState());
      }
      return;
    }

    const wantsExternal = !!(externalCommand && (externalCommand.block || externalCommand.defend));
    const wantsKey = !!this.input?.isKeyPressed?.('KeyF');
    const wantsRightMouse = !!(this.input?.isPointerLocked?.() && this.input?.mouseButtons?.right);
    const wantsBlock = wantsExternal || wantsKey || wantsRightMouse;

    const canHold = (this.blockCooldown || 0) <= 0 && (this.blockStamina || 0) > 0;
    const canStart = (this.blockCooldown || 0) <= 0 && (this.blockStamina || 0) > minStart;
    this.blocking = wantsBlock && (wasBlocking ? canHold : canStart);

    if (this.blocking) {
      this.blockStamina = Math.max(0, this.blockStamina - drain * dt);
      if ((this.blockStamina || 0) <= 0) {
        this.blockStamina = 0;
        this.blocking = false;
        broke = true;
        if (Number.isFinite(cooldownSeconds) && cooldownSeconds > 0) {
          this.blockCooldown = Math.max(this.blockCooldown || 0, cooldownSeconds);
        }
      }
    } else {
      this.blockStamina = Math.min(this.blockStaminaMax, this.blockStamina + regen * dt);
    }

    if (!wasBlocking && this.blocking && eventBus?.emit) {
      eventBus.emit(EVENTS.PLAYER_BLOCK_START, this.getBlockState());
    }

    if (wasBlocking && !this.blocking && eventBus?.emit) {
      if (broke) {
        eventBus.emit(EVENTS.PLAYER_BLOCK_BROKEN, this.getBlockState());
      } else {
        eventBus.emit(EVENTS.PLAYER_BLOCK_END, this.getBlockState());
      }
    }
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
