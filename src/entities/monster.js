/**
 * Monster entity class
 * Handles individual monster behavior, movement, and AI
 * Now with Behavior Tree AI and A* pathfinding
 */

import * as THREE from 'three';
import { CONFIG } from '../core/config.js';
import { Pathfinding } from '../ai/pathfinding.js';
import { createMonsterBehaviorTree } from '../ai/behaviorProfiles.js';

export class Monster {
  /**
   * Create a monster
   * @param {THREE.Group} model - 3D model
   * @param {Object} spawnPosition - Grid position {x, y}
   * @param {WorldState} worldState - Reference to world state
   * @param {Object} typeConfig - Monster type configuration (optional)
   */
  constructor(model, spawnPosition, worldState, typeConfig = null) {
    this.model = model;
    this.worldState = worldState;
    this.typeConfig = typeConfig;

    // Grid position
    this.gridX = spawnPosition.x;
    this.gridY = spawnPosition.y;

    // Set model scale based on type or default (increased for visibility)
    const scale = typeConfig?.stats?.scale || 2.0; // INCREASED from 0.8 to 2.0
    this.model.scale.set(scale, scale, scale);
    console.log(`📏 Monster scale set to: ${scale}`);

    // Calculate proper ground level based on model bounding box
    const modelHeight = this.calculateModelHeight();
    // FIXED: Place model center at modelHeight/2 above ground for visibility
    const groundOffset = Math.max(0.5, modelHeight / 2);

    console.log(`🦊 Monster model height: ${modelHeight.toFixed(2)}, ground offset: ${groundOffset.toFixed(2)}`);

    // World position (place model center above ground for visibility)
    this.position = new THREE.Vector3(
      spawnPosition.x * CONFIG.TILE_SIZE,
      groundOffset, // Raised for visibility
      spawnPosition.y * CONFIG.TILE_SIZE
    );

    // Set model position
    this.model.position.copy(this.position);

    // Ensure all meshes cast and receive shadows
    this.model.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    // Movement properties
    this.velocity = new THREE.Vector3();
    this.speed = typeConfig?.stats?.speed || CONFIG.MONSTER_SPEED;
    this.rotationSpeed = 3; // radians per second

    // AI state
    this.state = 'EXPLORE'; // EXPLORE, PATROL, CHASE, SEARCH, WANDER, IDLE
    this.patrolPoints = [];
    this.currentPatrolIndex = 0;
    this.chaseTarget = null;
    this.wanderTarget = null;
    this.explorationTarget = null; // For autonomous exploration

    // Vision and sensing
    this.visionRange = typeConfig?.stats?.visionRange || CONFIG.MONSTER_VISION_RANGE;
    this.visionFOV = typeConfig?.stats?.visionFOV || CONFIG.MONSTER_FOV;
    this.hearingRange = typeConfig?.stats?.hearingRange || 10;

    // Memory system
    this.lastSeenPosition = null;
    this.lastSeenTime = null;
    this.searchPoints = [];

    // Exploration memory system (human-like long-term memory)
    this.visitedTiles = new Map(); // Map<"x,y", timestamp>
    this.stuckPositions = new Map(); // Map<"x,y", timestamp>
    this.explorationMemoryDuration = 600000; // 600 seconds (10 minutes) - long-term memory
    this.stuckMemoryDuration = 120000; // 120 seconds (2 minutes) - remember obstacles longer

    // Exploration direction persistence (commit to corridors)
    this.currentExplorationDirection = null; // Vector to maintain direction
    this.directionPersistence = 0; // How long to keep same direction
    this.targetPersistenceTime = 60000; // Keep going same direction for 60 seconds (walk corridors to end)

    // Track actual movement to determine real direction
    this.lastFramePosition = this.position.clone();
    this.actualMovementDirection = null;

    // Stuck detection (enhanced v4.0.0)
    this.stuckTimer = 0;
    this.lastMovementCheck = Date.now();
    this.lastPosition = this.position.clone();
    this.positionHistory = []; // Track last 10 positions for oscillation detection
    this.maxPositionHistory = 10;
    this.stuckThreshold = 2.0; // seconds without movement = stuck

    // Pathfinding
    this.pathfinding = new Pathfinding(worldState);
    this.currentPath = [];
    this.nextPath = null; // Pre-computed next path for seamless transition
    this.pathUpdateCooldown = 0;
    this.isComputingPath = false; // Flag to prevent duplicate path calculations

    // Behavior tree
    if (typeConfig) {
      this.behaviorTree = createMonsterBehaviorTree(this, typeConfig);
      console.log(`🧠 ${typeConfig.name} behavior tree created`);
    } else {
      this.behaviorTree = null;
    }

    // Animation
    this.mixer = null;
    this.animations = {};
    this.currentAnimation = null;
    this.animationMappings = typeConfig?.animations || {
      idle: ['Idle', 'idle'],
      walk: ['Walk', 'walk'],
      run: ['Run', 'run']
    };

    // Apply visual appearance
    if (typeConfig?.appearance) {
      this.applyAppearance(typeConfig.appearance);
    }

    // Generate initial patrol path
    this.generatePatrolPath();

    const typeName = typeConfig?.name || 'Generic';
    console.log(`👹 ${typeName} monster spawned at grid (${this.gridX}, ${this.gridY})`);
  }

  /**
   * Setup animations if available
   * @param {Array} animations - Array of THREE.AnimationClip
   */
  setupAnimations(animations) {
    if (!animations || animations.length === 0) return;

    this.mixer = new THREE.AnimationMixer(this.model);

    animations.forEach(clip => {
      const action = this.mixer.clipAction(clip);
      this.animations[clip.name] = action;
      console.log(`🎬 Animation loaded: ${clip.name}`);
    });

    // Play idle or walk animation by default
    if (this.animations['Idle'] || this.animations['idle']) {
      this.playAnimation('Idle') || this.playAnimation('idle');
    } else if (this.animations['Walk'] || this.animations['walk']) {
      this.playAnimation('Walk') || this.playAnimation('walk');
    }
  }

  /**
   * Play an animation
   * @param {string} name - Animation name (or array of possible names)
   */
  playAnimation(name) {
    // Support array of animation names (try each one)
    const namesToTry = Array.isArray(name) ? name : [name];

    for (const animName of namesToTry) {
      if (this.animations[animName]) {
        if (this.currentAnimation && this.currentAnimation !== this.animations[animName]) {
          this.currentAnimation.fadeOut(0.2);
        }

        this.currentAnimation = this.animations[animName];
        this.currentAnimation.reset().fadeIn(0.2).play();
        return true;
      }
    }

    // Try using animation mappings
    if (this.animationMappings && this.animationMappings[name]) {
      const mappedNames = this.animationMappings[name];
      for (const mappedName of mappedNames) {
        if (this.animations[mappedName]) {
          if (this.currentAnimation && this.currentAnimation !== this.animations[mappedName]) {
            this.currentAnimation.fadeOut(0.2);
          }

          this.currentAnimation = this.animations[mappedName];
          this.currentAnimation.reset().fadeIn(0.2).play();
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Generate a random patrol path
   */
  generatePatrolPath() {
    this.patrolPoints = [];
    const numPoints = Math.floor(Math.random() * 3) + 3; // 3-5 points

    for (let i = 0; i < numPoints; i++) {
      const point = this.worldState.findRandomWalkableTile();
      this.patrolPoints.push(point);
    }

    console.log(`🚶 Generated patrol path with ${numPoints} points`);
  }

  /**
   * Update monster AI and movement
   * @param {number} deltaTime - Time since last frame
   * @param {THREE.Vector3} playerPosition - Player position
   * @param {boolean} isPlayerSprinting - Whether player is sprinting (for hearing)
   */
  update(deltaTime, playerPosition, isPlayerSprinting = false) {
    // Update animation mixer
    if (this.mixer) {
      this.mixer.update(deltaTime);
    }

    // Use behavior tree if available
    if (this.behaviorTree) {
      const context = {
        deltaTime,
        playerPosition,
        isPlayerSprinting,
        monster: this
      };
      this.behaviorTree.tick(context);
    } else {
      // Fallback to old FSM system
      this.updateAI(playerPosition);

      switch (this.state) {
        case 'PATROL':
          this.updatePatrol(deltaTime);
          break;
        case 'CHASE':
          this.updateChase(deltaTime, playerPosition);
          break;
        case 'IDLE':
          // Do nothing
          break;
      }
    }

    // Update grid position
    this.gridX = Math.floor(this.position.x / CONFIG.TILE_SIZE);
    this.gridY = Math.floor(this.position.z / CONFIG.TILE_SIZE);

    // Calculate actual movement direction from last frame
    const movement = new THREE.Vector3().subVectors(this.position, this.lastFramePosition);
    const moveDist = Math.sqrt(movement.x * movement.x + movement.z * movement.z);

    // CRITICAL: Only update direction if movement is significant (> 0.1 units)
    if (moveDist > 0.1) {
      // Normalize and determine primary direction
      const normX = movement.x / moveDist;
      const normZ = movement.z / moveDist;

      // Use threshold of 0.5 to determine dominant direction
      this.actualMovementDirection = {
        dx: Math.abs(normX) > 0.5 ? (normX > 0 ? 1 : -1) : 0,
        dy: Math.abs(normZ) > 0.5 ? (normZ > 0 ? 1 : -1) : 0
      };

      console.log(`🔄 Movement: (${normX.toFixed(2)}, ${normZ.toFixed(2)}) -> Direction: (${this.actualMovementDirection.dx}, ${this.actualMovementDirection.dy})`);
    }
    // DON'T update if barely moved - keep last direction

    this.lastFramePosition.copy(this.position);
  }

  /**
   * Update AI decision making
   * @param {THREE.Vector3} playerPosition - Player position
   */
  updateAI(playerPosition) {
    const canSeePlayer = this.canSeePlayer(playerPosition);

    if (canSeePlayer && this.state !== 'CHASE') {
      console.log('👁️ Monster spotted player!');
      this.state = 'CHASE';
      this.chaseTarget = playerPosition.clone();

      // Play chase animation if available
      if (!this.playAnimation('Run') && !this.playAnimation('run')) {
        this.playAnimation('Walk') || this.playAnimation('walk');
      }
    } else if (!canSeePlayer && this.state === 'CHASE') {
      console.log('❓ Monster lost sight of player');
      this.state = 'PATROL';

      // Play patrol animation
      this.playAnimation('Walk') || this.playAnimation('walk');
    }
  }

  /**
   * Check if monster can see the player
   * @param {THREE.Vector3} playerPosition - Player position
   * @returns {boolean} True if player is visible
   */
  canSeePlayer(playerPosition) {
    const distance = this.position.distanceTo(playerPosition);

    // Too far away
    if (distance > this.visionRange) return false;

    // Calculate direction to player
    const directionToPlayer = new THREE.Vector3()
      .subVectors(playerPosition, this.position)
      .normalize();

    // Get monster's forward direction
    const forward = new THREE.Vector3(0, 0, -1)
      .applyQuaternion(this.model.quaternion);

    // Calculate angle between forward and player direction
    const angle = forward.angleTo(directionToPlayer);

    // Check if within FOV
    return angle < this.visionFOV / 2;
  }

  /**
   * Update patrol behavior
   * @param {number} deltaTime - Time since last frame
   */
  updatePatrol(deltaTime) {
    if (this.patrolPoints.length === 0) {
      this.generatePatrolPath();
      return;
    }

    const targetPoint = this.patrolPoints[this.currentPatrolIndex];
    const targetWorld = new THREE.Vector3(
      targetPoint.x * CONFIG.TILE_SIZE,
      this.position.y, // Keep at current ground level
      targetPoint.y * CONFIG.TILE_SIZE
    );

    // Move towards patrol point
    this.moveTowards(targetWorld, deltaTime);

    // Check if reached patrol point
    const distance = this.position.distanceTo(targetWorld);
    if (distance < 0.5) {
      this.currentPatrolIndex = (this.currentPatrolIndex + 1) % this.patrolPoints.length;
    }
  }

  /**
   * Update chase behavior
   * @param {number} deltaTime - Time since last frame
   * @param {THREE.Vector3} playerPosition - Player position
   */
  updateChase(deltaTime, playerPosition) {
    this.chaseTarget = playerPosition.clone();
    this.moveTowards(this.chaseTarget, deltaTime);
  }

  /**
   * Move towards a target position
   * @param {THREE.Vector3} target - Target position
   * @param {number} deltaTime - Time since last frame
   */
  moveTowards(target, deltaTime) {
    // Calculate direction (only XZ plane, ignore Y)
    const direction = new THREE.Vector3(
      target.x - this.position.x,
      0,
      target.z - this.position.z
    ).normalize();

    // Calculate desired velocity (only XZ movement)
    const desiredVelocity = direction.multiplyScalar(this.speed);

    // Update velocity (smooth movement)
    this.velocity.lerp(desiredVelocity, 0.1);

    // Calculate new position
    const newPosition = this.position.clone().add(
      this.velocity.clone().multiplyScalar(deltaTime)
    );

    // Keep Y at current ground level (don't change height during movement)
    newPosition.y = this.position.y;

    // CRITICAL: Check collision with walls - use FLOOR for grid alignment
    const newGridX = Math.floor(newPosition.x / CONFIG.TILE_SIZE);
    const newGridZ = Math.floor(newPosition.z / CONFIG.TILE_SIZE);

    // SAFETY: Double-check current position is walkable
    const currentGridX = Math.floor(this.position.x / CONFIG.TILE_SIZE);
    const currentGridZ = Math.floor(this.position.z / CONFIG.TILE_SIZE);

    if (!this.worldState.isWalkable(currentGridX, currentGridZ)) {
      console.error(`🚨 ${this.typeConfig?.name || 'Monster'} is INSIDE A WALL at (${currentGridX}, ${currentGridZ})! Emergency teleport.`);
      // CRITICAL: Stop all movement immediately
      this.velocity.set(0, 0, 0);
      this.currentPath = [];
      this.nextPath = null;

      // Emergency: find nearest walkable tile
      for (let radius = 1; radius <= 5; radius++) {
        for (let dx = -radius; dx <= radius; dx++) {
          for (let dz = -radius; dz <= radius; dz++) {
            const checkX = currentGridX + dx;
            const checkZ = currentGridZ + dz;
            if (this.worldState.isWalkable(checkX, checkZ)) {
              this.position.x = checkX * CONFIG.TILE_SIZE;
              this.position.z = checkZ * CONFIG.TILE_SIZE;
              this.model.position.copy(this.position);
              console.log(`✅ Emergency teleport to (${checkX}, ${checkZ})`);
              return; // Don't try to move this frame
            }
          }
        }
      }
    }

    // Check if new position is walkable
    if (this.worldState.isWalkable(newGridX, newGridZ)) {
      this.position.copy(newPosition);
      this.model.position.copy(this.position);
    } else {
      // BLOCKED! Stop velocity but don't clear path yet (let AI recalculate)
      this.velocity.set(0, 0, 0);

      // Try sliding along walls (only if we're not stuck)
      const slideX = new THREE.Vector3(newPosition.x, this.position.y, this.position.z);
      const slideZ = new THREE.Vector3(this.position.x, this.position.y, newPosition.z);

      const slideGridX = Math.floor(slideX.x / CONFIG.TILE_SIZE);
      const slideGridZ_X = Math.floor(slideX.z / CONFIG.TILE_SIZE);
      const slideGridX_Z = Math.floor(slideZ.x / CONFIG.TILE_SIZE);
      const slideGridZ = Math.floor(slideZ.z / CONFIG.TILE_SIZE);

      // Try sliding along X axis
      if (this.worldState.isWalkable(slideGridX, slideGridZ_X)) {
        this.position.copy(slideX);
        this.model.position.copy(this.position);
      }
      // Try sliding along Z axis
      else if (this.worldState.isWalkable(slideGridX_Z, slideGridZ)) {
        this.position.copy(slideZ);
        this.model.position.copy(this.position);
      }
      // Completely blocked - already cleared velocity above
    }

    // Rotate to face movement direction
    if (this.velocity.lengthSq() > 0.01) {
      const targetRotation = Math.atan2(this.velocity.x, this.velocity.z);
      const currentRotation = this.model.rotation.y;

      // Smooth rotation
      let deltaRotation = targetRotation - currentRotation;

      // Normalize to -PI to PI
      while (deltaRotation > Math.PI) deltaRotation -= Math.PI * 2;
      while (deltaRotation < -Math.PI) deltaRotation += Math.PI * 2;

      this.model.rotation.y += deltaRotation * this.rotationSpeed * deltaTime;
    }
  }

  /**
   * Get monster's current grid position
   * @returns {Object} Grid position {x, y}
   */
  getGridPosition() {
    return { x: this.gridX, y: this.gridY };
  }

  /**
   * Get monster's world position
   * @returns {THREE.Vector3} World position
   */
  getWorldPosition() {
    return this.position.clone();
  }

  /**
   * Get the 3D model
   * @returns {THREE.Group} The model
   */
  getModel() {
    return this.model;
  }

  /**
   * Calculate model height from bounding box
   * @returns {number} Model height in world units
   */
  calculateModelHeight() {
    // Force update to ensure accurate bounding box
    this.model.updateMatrixWorld(true);

    // Calculate bounding box
    const bbox = new THREE.Box3().setFromObject(this.model);
    const height = bbox.max.y - bbox.min.y;

    // Return calculated height or fallback
    if (height > 0 && height < 10) {
      return height;
    }

    // Fallback to default height if calculation seems wrong
    console.warn('⚠️ Invalid model height detected, using fallback');
    return 1.8;
  }

  /**
   * Apply visual appearance settings
   * @param {Object} appearance - Appearance configuration
   */
  applyAppearance(appearance) {
    if (!appearance) return;

    this.model.traverse((child) => {
      if (child.isMesh && child.material) {
        if (appearance.emissiveColor !== undefined) {
          child.material.emissive = new THREE.Color(appearance.emissiveColor);
        }
        if (appearance.emissiveIntensity !== undefined) {
          child.material.emissiveIntensity = appearance.emissiveIntensity;
        }
      }
    });
  }

  /**
   * Generate search points in a spiral pattern around a position
   * @param {THREE.Vector3} center - Center position (world coordinates)
   * @param {number} radius - Search radius in grid units
   */
  generateSearchPoints(center, radius = 3) {
    this.searchPoints = [];

    // Convert world position to grid
    const tileSize = CONFIG.TILE_SIZE;
    const centerGrid = {
      x: Math.floor(center.x / tileSize),
      y: Math.floor(center.z / tileSize)
    };

    // Create spiral search pattern
    const angles = 8; // 8 directions
    for (let r = 1; r <= radius; r++) {
      for (let i = 0; i < angles; i++) {
        const angle = (i / angles) * Math.PI * 2;
        const x = Math.round(centerGrid.x + Math.cos(angle) * r);
        const y = Math.round(centerGrid.y + Math.sin(angle) * r);

        if (this.worldState.isWalkable(x, y)) {
          this.searchPoints.push({ x, y });
        }
      }
    }

    console.log(`🔍 Generated ${this.searchPoints.length} search points`);
  }

  /**
   * Check if monster can hear the player
   * @param {THREE.Vector3} playerPosition - Player position
   * @param {boolean} isPlayerSprinting - Whether player is sprinting
   * @returns {boolean} True if player is audible
   */
  canHearPlayer(playerPosition, isPlayerSprinting = false) {
    const distance = this.position.distanceTo(playerPosition);

    // Sprinting makes more noise
    const effectiveHearingRange = isPlayerSprinting
      ? this.hearingRange * 1.5
      : this.hearingRange;

    return distance < effectiveHearingRange;
  }

  /**
   * Follow a computed A* path
   * @param {number} deltaTime - Time since last frame
   */
  followPath(deltaTime) {
    if (!this.currentPath || this.currentPath.length === 0) {
      // Try to use pre-computed next path
      if (this.nextPath && this.nextPath.length > 0) {
        this.currentPath = this.nextPath;
        this.nextPath = null;
        console.log(`✅ ${this.typeConfig?.name || 'Monster'} seamlessly transitioned to next path`);
      } else {
        return;
      }
    }

    // CRITICAL: Validate next waypoint is walkable before moving
    const nextWaypoint = this.currentPath[0];

    // Safety check: if next waypoint is a wall, clear the path
    if (!this.worldState.isWalkable(nextWaypoint.x, nextWaypoint.y)) {
      console.warn(`🚫 ${this.typeConfig?.name || 'Monster'} path contains wall at (${nextWaypoint.x}, ${nextWaypoint.y})! Clearing path.`);
      this.currentPath = [];
      this.nextPath = null;
      return;
    }

    const tileSize = CONFIG.TILE_SIZE;
    const targetWorld = new THREE.Vector3(
      nextWaypoint.x * tileSize,
      this.position.y,
      nextWaypoint.y * tileSize
    );

    // Move towards waypoint (this has collision detection built-in)
    this.moveTowards(targetWorld, deltaTime);

    // Check if reached waypoint (reduced distance for smoother transitions)
    const distance = this.position.distanceTo(targetWorld);
    if (distance < 0.3) {
      this.currentPath.shift(); // Remove reached waypoint

      // Pre-compute next path MUCH EARLIER (when 10 waypoints left) for seamless transitions
      if (this.currentPath.length <= 10 && !this.nextPath && !this.isComputingPath) {
        this.preComputeNextPath();
      }
    }
  }

  /**
   * Pre-compute next path before current one ends
   */
  preComputeNextPath() {
    this.isComputingPath = true;

    // Select next target
    const targetGrid = this.selectSmartTarget();

    if (targetGrid) {
      const currentPos = { x: this.gridX, y: this.gridY };
      const path = this.pathfinding.findPath(currentPos, targetGrid);

      if (path && path.length > 0) {
        this.nextPath = path;
        console.log(`🔮 ${this.typeConfig?.name || 'Monster'} pre-computed next path (${path.length} waypoints)`);
      }
    }

    this.isComputingPath = false;
  }

  /**
   * Record current position as visited
   */
  recordVisit() {
    const key = `${this.gridX},${this.gridY}`;
    this.visitedTiles.set(key, Date.now());

    // Clean up old memories
    const now = Date.now();
    for (const [tileKey, timestamp] of this.visitedTiles.entries()) {
      if (now - timestamp > this.explorationMemoryDuration) {
        this.visitedTiles.delete(tileKey);
      }
    }
  }

  /**
   * Record a position as stuck
   * @param {number} x - Grid X
   * @param {number} y - Grid Y
   */
  recordStuckPosition(x, y) {
    const key = `${x},${y}`;
    this.stuckPositions.set(key, Date.now());
    console.log(`🚫 ${this.typeConfig?.name || 'Monster'} recorded stuck position (${x}, ${y})`);

    // Clean up old stuck memories
    const now = Date.now();
    for (const [tileKey, timestamp] of this.stuckPositions.entries()) {
      if (now - timestamp > this.stuckMemoryDuration) {
        this.stuckPositions.delete(tileKey);
      }
    }
  }

  /**
   * Check if a tile was recently visited
   * @param {number} x - Grid X
   * @param {number} y - Grid Y
   * @returns {number} Score (0 = never visited, higher = more recent)
   */
  getVisitScore(x, y) {
    const key = `${x},${y}`;
    const visitTime = this.visitedTiles.get(key);
    if (!visitTime) return 0;

    const timeSinceVisit = Date.now() - visitTime;
    // Higher score = more recently visited (should avoid)
    return Math.max(0, 1 - (timeSinceVisit / this.explorationMemoryDuration));
  }

  /**
   * Check if a tile is in stuck positions
   * @param {number} x - Grid X
   * @param {number} y - Grid Y
   * @returns {boolean} True if stuck position
   */
  isStuckPosition(x, y) {
    const key = `${x},${y}`;
    const stuckTime = this.stuckPositions.get(key);
    if (!stuckTime) return false;

    const timeSinceStuck = Date.now() - stuckTime;
    return timeSinceStuck < this.stuckMemoryDuration;
  }

  /**
   * Detect if current position is in a corridor
   * @returns {Object|null} Corridor direction {dx, dy} or null if not in corridor
   */
  detectCorridor() {
    const x = this.gridX;
    const y = this.gridY;

    // Check all 4 cardinal directions
    const north = this.worldState.isWalkable(x, y - 1);
    const south = this.worldState.isWalkable(x, y + 1);
    const east = this.worldState.isWalkable(x + 1, y);
    const west = this.worldState.isWalkable(x - 1, y);

    // Count walkable directions
    const walkableCount = [north, south, east, west].filter(Boolean).length;

    // Corridor = exactly 2 opposite directions walkable (NOT T-junction or cross)
    if (walkableCount === 2) {
      // Vertical corridor
      if (north && south && !east && !west) {
        // CRITICAL: Use ACTUAL movement direction from last frame
        const actualDir = this.actualMovementDirection;

        if (actualDir && Math.abs(actualDir.dy) > 0) {
          // Continue in actual movement direction (absolute no reverse!)
          return { dx: 0, dy: actualDir.dy };
        }

        // Fallback: pick unvisited direction
        const northScore = this.getVisitScore(x, y - 1);
        const southScore = this.getVisitScore(x, y + 1);

        return northScore < southScore ? {dx: 0, dy: -1} : {dx: 0, dy: 1};
      }

      // Horizontal corridor
      if (east && west && !north && !south) {
        const actualDir = this.actualMovementDirection;

        if (actualDir && Math.abs(actualDir.dx) > 0) {
          // Continue in actual movement direction (absolute no reverse!)
          return { dx: actualDir.dx, dy: 0 };
        }

        const eastScore = this.getVisitScore(x + 1, y);
        const westScore = this.getVisitScore(x - 1, y);

        return eastScore < westScore ? {dx: 1, dy: 0} : {dx: -1, dy: 0};
      }
    }

    // Not a corridor (junction, room, or dead end)
    return null;
  }

  /**
   * Detect if in a room (open space with many walkable neighbors)
   * @returns {boolean} True if in a room
   */
  isInRoom() {
    const x = this.gridX;
    const y = this.gridY;

    let walkableCount = 0;
    // Check 3x3 area around monster
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        if (this.worldState.isWalkable(x + dx, y + dy)) {
          walkableCount++;
        }
      }
    }

    // Room = more than 5 walkable neighbors (open space)
    return walkableCount >= 5;
  }

  /**
   * Find nearest corridor exit from current room
   * @returns {{x, y}|null} Corridor entrance position or null
   */
  findNearestCorridorExit() {
    const x = this.gridX;
    const y = this.gridY;
    const maxSearchRadius = 8;

    let candidates = [];

    // Search in expanding circles
    for (let radius = 2; radius <= maxSearchRadius; radius++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          // Only check perimeter
          if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;

          const checkX = x + dx;
          const checkY = y + dy;

          if (!this.worldState.isWalkable(checkX, checkY)) continue;

          // Count neighbors
          const neighbors = [
            this.worldState.isWalkable(checkX, checkY - 1),
            this.worldState.isWalkable(checkX, checkY + 1),
            this.worldState.isWalkable(checkX + 1, checkY),
            this.worldState.isWalkable(checkX - 1, checkY)
          ].filter(Boolean).length;

          // Corridor entrance = exactly 2 walkable neighbors
          if (neighbors === 2 || neighbors === 3) {
            const distance = Math.sqrt(dx * dx + dy * dy);
            candidates.push({x: checkX, y: checkY, distance});
          }
        }
      }

      // If found candidates at this radius, return closest
      if (candidates.length > 0) {
        candidates.sort((a, b) => a.distance - b.distance);
        return {x: candidates[0].x, y: candidates[0].y};
      }
    }

    return null;
  }

  /**
   * Find walkable tiles within FOV and nearby range
   * @param {number} maxDistance - Maximum distance in grid units
   * @returns {Array<{x, y, score}>} Array of candidate tiles with exploration scores
   */
  findNearbyTargets(maxDistance = 50) {
    const candidates = [];
    const centerX = this.gridX;
    const centerY = this.gridY;

    // Check if we should maintain current direction
    const now = Date.now();
    const shouldKeepDirection = this.currentExplorationDirection &&
                                (now - this.directionPersistence < this.targetPersistenceTime);

    // Search in circular area around monster
    for (let dy = -maxDistance; dy <= maxDistance; dy++) {
      for (let dx = -maxDistance; dx <= maxDistance; dx++) {
        const x = centerX + dx;
        const y = centerY + dy;

        // Skip current position
        if (dx === 0 && dy === 0) continue;

        // Check if within circular distance
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance > maxDistance || distance < 10) continue; // Min 10 tiles away for much longer exploration

        // Check if walkable
        if (!this.worldState.isWalkable(x, y)) continue;

        // Skip stuck positions
        if (this.isStuckPosition(x, y)) continue;

        // Calculate exploration score (HIGHER IS BETTER for this new system!)

        // Distance reward: farther = higher score (0-100 range)
        const distanceReward = (distance / maxDistance) * 100; // 100 = farthest

        // Visit penalty: recently visited = huge negative score (-100 to 0)
        const visitPenalty = -this.getVisitScore(x, y) * 100; // -100 = just visited

        // Direction consistency reward (higher is better when keeping direction)
        let directionReward = 0;
        if (shouldKeepDirection) {
          const targetDir = { x: dx, y: dy };
          const magnitude = Math.sqrt(targetDir.x ** 2 + targetDir.y ** 2) *
                           Math.sqrt(this.currentExplorationDirection.x ** 2 + this.currentExplorationDirection.y ** 2);
          const dotProduct = (targetDir.x * this.currentExplorationDirection.x +
                             targetDir.y * this.currentExplorationDirection.y) / magnitude;
          directionReward = dotProduct * 50; // +50 = same direction, -50 = opposite
        }

        // Final score: HIGHER = BETTER TARGET
        const score = distanceReward + visitPenalty + directionReward;

        candidates.push({ x, y, score, distance, dx, dy });
      }
    }

    // Sort by score (HIGHER score = better target - want farthest unvisited tiles)
    candidates.sort((a, b) => b.score - a.score);

    return candidates;
  }

  /**
   * Select best exploration target using A* pathfinding
   * @returns {{x, y}|null} Target grid position or null
   */
  selectSmartTarget() {
    const candidates = this.findNearbyTargets(50);

    if (candidates.length === 0) {
      // Fallback: expand search radius to entire visible maze
      const fallbackCandidates = this.findNearbyTargets(80);
      if (fallbackCandidates.length === 0) {
        console.warn(`⚠️ ${this.typeConfig?.name || 'Monster'} found no candidates at all`);
        // Reset direction persistence
        this.currentExplorationDirection = null;
        this.directionPersistence = 0;
        return null;
      }
      return this.tryFindPath(fallbackCandidates);
    }

    return this.tryFindPath(candidates);
  }

  /**
   * Try to find valid A* path to candidates (with randomization for diversity)
   * @param {Array} candidates - Array of candidate positions
   * @returns {{x, y}|null} Valid target or null (also sets this.currentPath internally!)
   */
  tryFindPath(candidates) {
    const currentPos = { x: this.gridX, y: this.gridY };

    // RANDOMIZE: Try candidates in random order from top 5
    const topCandidates = candidates.slice(0, Math.min(5, candidates.length));

    // Shuffle top candidates for exploration diversity
    for (let i = topCandidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [topCandidates[i], topCandidates[j]] = [topCandidates[j], topCandidates[i]];
    }

    // Try shuffled candidates until we find one with valid path
    for (const candidate of topCandidates) {
      const targetPos = { x: candidate.x, y: candidate.y };

      // Attempt A* pathfinding
      const path = this.pathfinding.findPath(currentPos, targetPos);

      if (path && path.length > 0) {
        // CRITICAL: Set the path directly here to avoid double pathfinding!
        this.currentPath = path;

        // Update exploration direction
        this.currentExplorationDirection = {
          x: candidate.dx,
          y: candidate.dy
        };
        this.directionPersistence = Date.now();

        console.log(`🎯 ${this.typeConfig?.name || 'Monster'} found path to (${candidate.x}, ${candidate.y}), distance: ${candidate.distance.toFixed(1)}, path length: ${path.length}`);
        return targetPos;
      }
    }

    console.warn(`⚠️ ${this.typeConfig?.name || 'Monster'} couldn't find valid path to any candidate`);
    // DON'T reset direction - keep trying in same general direction
    return null;
  }

  /**
   * Detect if monster is oscillating (moving back and forth)
   * v4.0.0: Enhanced stuck detection
   * @returns {boolean} True if oscillating
   */
  isOscillating() {
    if (this.positionHistory.length < this.maxPositionHistory) {
      return false; // Need enough history
    }

    // Check if monster is revisiting same few positions
    const uniquePositions = new Set();
    const gridPositions = this.positionHistory.map(pos => {
      const gx = Math.round(pos.x / CONFIG.TILE_SIZE);
      const gy = Math.round(pos.z / CONFIG.TILE_SIZE);
      return `${gx},${gy}`;
    });

    gridPositions.forEach(pos => uniquePositions.add(pos));

    // If only visiting 2-3 unique grid cells = oscillating
    if (uniquePositions.size <= 3) {
      console.log(`⚠️ Oscillation detected! Only ${uniquePositions.size} unique positions in last ${this.maxPositionHistory} frames`);
      return true;
    }

    return false;
  }

  /**
   * Analyze the cause of being stuck
   * v4.0.0: Intelligent stuck cause detection
   * @returns {string} Stuck cause: DEAD_END, WALL_COLLISION, OSCILLATION, PATH_BLOCKED, UNKNOWN
   */
  analyzeStuckCause() {
    // Check oscillation first
    if (this.isOscillating()) {
      return 'OSCILLATION';
    }

    // Check if surrounded by walls (dead end)
    const directions = [
      {dx: 0, dy: -1, name: 'North'},
      {dx: 1, dy: 0, name: 'East'},
      {dx: 0, dy: 1, name: 'South'},
      {dx: -1, dy: 0, name: 'West'}
    ];

    const walkableDirs = directions.filter(dir =>
      this.worldState.isWalkable(this.gridX + dir.dx, this.gridY + dir.dy)
    );

    if (walkableDirs.length === 0) {
      return 'DEAD_END'; // Completely surrounded
    }

    if (walkableDirs.length === 1) {
      return 'DEAD_END'; // Only one way out (corridor end)
    }

    // Check if path is blocked
    if (this.currentPath && this.currentPath.length > 0) {
      const nextWaypoint = this.currentPath[0];
      if (!this.worldState.isWalkable(nextWaypoint.x, nextWaypoint.y)) {
        return 'PATH_BLOCKED';
      }
    }

    // Check if colliding with wall
    const forwardDist = 0.5;
    const forward = new THREE.Vector3(
      Math.cos(this.model.rotation.y) * forwardDist,
      0,
      Math.sin(this.model.rotation.y) * forwardDist
    );
    const checkPos = this.position.clone().add(forward);
    const checkGridX = Math.round(checkPos.x / CONFIG.TILE_SIZE);
    const checkGridZ = Math.round(checkPos.z / CONFIG.TILE_SIZE);

    if (!this.worldState.isWalkable(checkGridX, checkGridZ)) {
      return 'WALL_COLLISION';
    }

    return 'UNKNOWN';
  }

  /**
   * Detect if monster is stuck (not moving)
   * @returns {boolean} True if stuck
   */
  isStuck() {
    const now = Date.now();
    const timeSinceCheck = (now - this.lastMovementCheck) / 1000;

    if (timeSinceCheck < 0.5) return false; // Check every 0.5 seconds

    // Track position history (v4.0.0)
    this.positionHistory.push(this.position.clone());
    if (this.positionHistory.length > this.maxPositionHistory) {
      this.positionHistory.shift(); // Keep only last 10
    }

    // Calculate movement distance
    const movementDist = this.position.distanceTo(this.lastPosition);

    // Check for oscillation (v4.0.0)
    if (this.isOscillating()) {
      console.log('🔄 Oscillation detected - treating as stuck');
      return true;
    }

    if (movementDist < 0.1) {
      // Very little movement
      this.stuckTimer += timeSinceCheck;
    } else {
      // Reset stuck timer
      this.stuckTimer = 0;
    }

    // Update check time and position
    this.lastMovementCheck = now;
    this.lastPosition.copy(this.position);

    return this.stuckTimer >= this.stuckThreshold;
  }

  /**
   * Handle stuck situation
   * v4.0.0: Intelligent recovery based on stuck cause
   */
  handleStuck() {
    const cause = this.analyzeStuckCause();
    console.log(`🛑 ${this.typeConfig?.name || 'Monster'} is stuck! Cause: ${cause}`);

    // Record stuck position
    this.recordStuckPosition(this.gridX, this.gridY);

    // Clear current path and target
    this.currentPath = [];
    this.nextPath = null;
    this.explorationTarget = null;

    // Clear position history to prevent false oscillation detection
    this.positionHistory = [];

    // Recovery strategy based on cause
    switch (cause) {
      case 'OSCILLATION':
        console.log('🔄 Oscillation recovery: Forcing long-range frontier jump');
        // Force frontier explorer to pick a far target
        if (this.frontierExplorer) {
          // Temporarily increase scan radius to find distant frontier
          const oldRadius = this.frontierExplorer.scanRadius;
          this.frontierExplorer.scanRadius = 50;

          const frontier = this.frontierExplorer.selectBestFrontier(
            this.gridX,
            this.gridY,
            null // Ignore current direction
          );

          this.frontierExplorer.scanRadius = oldRadius; // Restore

          if (frontier) {
            const tileSize = CONFIG.TILE_SIZE;
            this.explorationTarget = new THREE.Vector3(
              frontier.x * tileSize,
              this.position.y,
              frontier.y * tileSize
            );
            console.log(`→ Jump to distant frontier: (${frontier.x}, ${frontier.y})`);
          }
        }
        break;

      case 'DEAD_END':
        console.log('🚧 Dead end recovery: Turning around');
        // Turn 180 degrees
        this.model.rotation.y += Math.PI;
        // Reset direction
        this.currentExplorationDirection = null;
        this.actualMovementDirection = null;
        break;

      case 'WALL_COLLISION':
        console.log('🧱 Wall collision recovery: Slight rotation');
        // Rotate randomly to try different angle
        this.model.rotation.y += (Math.random() - 0.5) * Math.PI / 2;
        break;

      case 'PATH_BLOCKED':
        console.log('🚫 Path blocked recovery: Recompute path');
        // Path is invalid, frontier explorer will pick new target
        break;

      default:
        console.log('❓ Unknown stuck cause: Random recovery');
        // Random rotation
        this.model.rotation.y += (Math.random() - 0.5) * Math.PI;
    }

    // Reset direction persistence to try new direction
    this.currentExplorationDirection = null;
    this.directionPersistence = 0;

    // Reset stuck timer
    this.stuckTimer = 0;

    console.log(`🔄 ${this.typeConfig?.name || 'Monster'} reset direction, will explore new area`);

    // Force immediate target selection on next update
  }
}
