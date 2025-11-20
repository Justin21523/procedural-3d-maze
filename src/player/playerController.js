/**
 * Player controller
 * Manages player movement, collision detection, and camera synchronization
 */

import * as THREE from 'three';
import { CONFIG } from '../core/config.js';
import { worldToGrid, gridToWorld } from '../utils/math.js';

export class PlayerController {
  /**
   * Create the player controller
   * @param {WorldState} worldState - Reference to world state for collision checking
   * @param {FirstPersonCamera} camera - Reference to camera controller
   * @param {InputHandler} input - Reference to input handler
   */
  constructor(worldState, camera, input, gameState = null) {
    this.worldState = worldState;
    this.camera = camera;
    this.input = input;
    this.gameState = gameState;

    // Player position in world coordinates
    this.position = new THREE.Vector3(0, CONFIG.PLAYER_HEIGHT, 0);
    this.velocity = new THREE.Vector3(0, 0, 0);

    // Movement tracking
    this.lastPosition = new THREE.Vector3();
    this.distanceMoved = 0;
    this.stepDistance = 2; // Distance for one step
    this.lastGridX = -1;
    this.lastGridY = -1;

    // Initialize at spawn point
    const spawnPoint = worldState.getSpawnPoint();
    const worldSpawn = gridToWorld(spawnPoint.x, spawnPoint.y, CONFIG.TILE_SIZE);
    this.position.set(
      worldSpawn.x,
      CONFIG.PLAYER_HEIGHT,
      worldSpawn.z
    );

    // Update camera to spawn position
    this.camera.updatePosition(this.position.x, this.position.y, this.position.z);
  }

  /**
   * Update player state (called every frame)
   * @param {number} deltaTime - Time since last frame in seconds
   */
  update(deltaTime) {
    // Only update if pointer is locked (game is active)
    if (!this.input.isPointerLocked()) {
      return;
    }

    // Save last position for step tracking
    this.lastPosition.copy(this.position);

    // Update camera rotation from mouse input
    const mouseDelta = this.input.consumeMouseDelta();
    this.camera.updateRotation(mouseDelta.x, mouseDelta.y);

    // Calculate movement
    const moveVector = this.calculateMovement(deltaTime);

    // Apply movement with collision detection
    this.applyMovement(moveVector);

    // Track steps and room exploration
    this.updateStatistics();

    // Sync camera position
    this.camera.updatePosition(this.position.x, this.position.y, this.position.z);
  }

  /**
   * Update statistics (steps and room exploration)
   */
  updateStatistics() {
    if (!this.gameState) return;

    // Track movement distance for steps
    const distance = this.position.distanceTo(this.lastPosition);
    if (distance > 0) {
      this.distanceMoved += distance;

      // Count a step every stepDistance units
      if (this.distanceMoved >= this.stepDistance) {
        this.gameState.addStep();
        this.distanceMoved = 0;
      }
    }

    // Track room exploration
    const gridPos = this.getGridPosition();
    if (gridPos.x !== this.lastGridX || gridPos.y !== this.lastGridY) {
      this.lastGridX = gridPos.x;
      this.lastGridY = gridPos.y;

      // Visit room
      const roomType = this.worldState.getRoomType(gridPos.x, gridPos.y);
      this.gameState.visitRoom(roomType);
    }
  }

  /**
   * Calculate movement vector based on input
   * @param {number} deltaTime - Time since last frame
   * @returns {THREE.Vector3} Movement vector
   */
  calculateMovement(deltaTime) {
    const moveInput = this.input.getMovementInput();

    if (moveInput.x === 0 && moveInput.y === 0) {
      return new THREE.Vector3(0, 0, 0);
    }

    // Get camera directions (flattened to XZ plane)
    const forward = this.camera.getForwardVector();
    const right = this.camera.getRightVector();

    // Calculate move direction in world space
    const moveDirection = new THREE.Vector3();
    moveDirection.addScaledVector(forward, moveInput.y);
    moveDirection.addScaledVector(right, moveInput.x);
    moveDirection.normalize();

    // Apply speed (with optional sprint)
    let speed = CONFIG.PLAYER_SPEED;
    if (this.input.isSprinting()) {
      speed *= 1.5; // Sprint multiplier
    }

    // Scale by deltaTime for frame-independent movement
    moveDirection.multiplyScalar(speed * deltaTime);

    return moveDirection;
  }

  /**
   * Apply movement with collision detection
   * @param {THREE.Vector3} moveVector - Desired movement vector
   */
  applyMovement(moveVector) {
    if (moveVector.lengthSq() === 0) {
      return;
    }

    // Try X movement
    const newPosX = this.position.x + moveVector.x;
    if (this.canMoveTo(newPosX, this.position.z)) {
      this.position.x = newPosX;
    }

    // Try Z movement
    const newPosZ = this.position.z + moveVector.z;
    if (this.canMoveTo(this.position.x, newPosZ)) {
      this.position.z = newPosZ;
    }
  }

  /**
   * Check if player can move to a world position
   * Uses simple grid-based collision with a small radius
   * @param {number} worldX - Target world X position
   * @param {number} worldZ - Target world Z position
   * @returns {boolean} True if position is walkable, false otherwise
   */
  canMoveTo(worldX, worldZ) {
    // Convert to grid coordinates
    const gridPos = worldToGrid(worldX, worldZ, CONFIG.TILE_SIZE);

    // Check center position
    if (!this.worldState.isWalkable(gridPos.x, gridPos.y)) {
      return false;
    }

    // Check corners and edges of player collision radius
    // This prevents clipping into walls with 8-point check
    const radius = CONFIG.PLAYER_RADIUS;
    const offsets = [
      // Corners
      { x: radius, z: radius },
      { x: radius, z: -radius },
      { x: -radius, z: radius },
      { x: -radius, z: -radius },
      // Edges (cardinal directions)
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
   * Get current player position
   * @returns {THREE.Vector3} Current position
   */
  getPosition() {
    return this.position.clone();
  }

  /**
   * Get current grid position
   * @returns {Object} Grid coordinates {x, y}
   */
  getGridPosition() {
    return worldToGrid(this.position.x, this.position.z, CONFIG.TILE_SIZE);
  }

  /**
   * Set player position (teleport)
   * @param {number} x - World X position
   * @param {number} y - World Y position
   * @param {number} z - World Z position
   */
  setPosition(x, y, z) {
    this.position.set(x, y, z);
    this.camera.updatePosition(x, y, z);
  }
}
