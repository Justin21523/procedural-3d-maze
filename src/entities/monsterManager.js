/**
 * Monster Manager
 * Handles spawning, updating, and managing all monsters
 * Now supports multiple monster types with different behaviors
 */

import * as THREE from 'three';
import { Monster } from './monster.js';
import { ModelLoader } from './modelLoader.js';
import { createSpriteBillboard } from './monsterSprite.js';
import { createMonsterMix } from '../ai/monsterTypes.js';
import { createMonsterBrain } from '../ai/monsterAI.js';
import { Pathfinding } from '../ai/pathfinding.js';
import { CONFIG } from '../core/config.js';

export class MonsterManager {
  /**
   * Create monster manager
   * @param {THREE.Scene} scene - Three.js scene
   * @param {WorldState} worldState - Reference to world state
   */
  constructor(scene, worldState, playerRef = null) {
    this.scene = scene;
    this.worldState = worldState;
    this.playerRef = playerRef;
    this.monsters = [];
    this.brains = new Map();
    this.modelLoader = new ModelLoader();
    this.currentModelPath = CONFIG.MONSTER_MODEL; // Track current model
    this.pathfinder = new Pathfinding(worldState);
  }

  setPlayerRef(playerRef) {
    this.playerRef = playerRef;
    for (const brain of this.brains.values()) {
      brain.playerRef = playerRef;
    }
  }

  /**
   * Initialize monsters with mixed types
   * @param {number} count - Number of monsters to spawn
   */
  async initializeForLevel(levelConfig = null) {
    const requested = levelConfig?.monsters?.count ?? CONFIG.MONSTER_COUNT;
    const typeWeights = levelConfig?.monsters?.typeWeights || null;
    return this.initialize(requested, typeWeights, levelConfig);
  }

  /**
   * Initialize monsters with mixed types
   * @param {number} count - Number of monsters to spawn
   * @param {Object|null} weights - Optional type weights for mix
   * @param {Object|null} levelConfig - Level configuration for scaling
   */
  async initialize(count = 1, weights = null, levelConfig = null) {
    console.log(`🎮 Initializing ${count} monsters with mixed types...`);

    try {
      // Get spawn points from world state
      const spawnPoints = this.worldState.getMonsterSpawns();
      console.log(`📍 Got ${spawnPoints.length} spawn points`);

      if (spawnPoints.length < count) {
        console.warn(`⚠️ Only ${spawnPoints.length} spawn points available for ${count} monsters`);
        count = spawnPoints.length;
      }

      // Create a mix of monster types
      const monsterTypeMix = createMonsterMix(count, weights);
      console.log(`🎲 Monster type distribution:`, monsterTypeMix.map(t => t.name));

      // Spawn each monster using 2D billboard sprites (keeps other objects 3D)
      for (let i = 0; i < count; i++) {
        const typeConfig = monsterTypeMix[i];
        console.log(`\n🦊 Spawning ${typeConfig.name} (${i + 1}/${count})...`);

        try {
          const spriteResult = createSpriteBillboard({
            path: typeConfig.sprite || '/models/monster.png',
            framesFolder: typeConfig.spriteFramesPath ?? '../assets/moonman-sequence',
            frameRate: typeConfig.spriteFrameRate ?? 8,
            randomStart: true,
            clipLengthRange: { min: 20, max: 60 },
            scale: { x: 1.5, y: 2.5 }
          });
          const spriteGroup = spriteResult.group || spriteResult;
          await this.spawnMonster(spriteGroup, [], spawnPoints[i], typeConfig, levelConfig, spriteResult.updateAnimation);
        } catch (error) {
          console.error(`   ❌ Failed to spawn ${typeConfig.name}:`, error.message);
          console.warn(`   ⚠️ Creating placeholder instead`);
          this.spawnPlaceholderMonster(spawnPoints[i], typeConfig, levelConfig);
        }
      }

      console.log(`\n✅ Successfully spawned ${this.monsters.length} monsters`);
      this.printMonsterSummary();
    } catch (error) {
      console.error('❌ Failed to initialize monsters:', error);
      console.error('   Error details:', error.message);
      console.error('   Stack trace:', error.stack);
      console.warn('⚠️ Falling back to placeholder monsters...');
      this.spawnPlaceholderMonstersWithTypes(count);
    }
  }

  /**
   * Spawn a monster at a specific position
   * @param {THREE.Group} model - Cloned model
   * @param {Array} animations - Animation clips
   * @param {Object} spawnPosition - Grid position {x, y}
   * @param {Object} typeConfig - Monster type configuration
   */
  async spawnMonster(model, animations, spawnPosition, typeConfig = null, levelConfig = null, spriteUpdater = null) {
    const typeName = typeConfig?.name || 'Generic';
    console.log(`\n🎭 Creating ${typeName} at grid (${spawnPosition.x}, ${spawnPosition.y})`);
    console.log('   Model children count:', model.children.length);
    console.log('   Model type:', model.type);
    console.log('   Model visible (before):', model.visible);

    const monster = new Monster(model, spawnPosition, this.worldState, typeConfig, levelConfig);

    // Setup animations
    if (animations && animations.length > 0) {
      console.log(`   Setting up ${animations.length} animations`);
      monster.setupAnimations(animations);
    }

    if (spriteUpdater) {
      const prev = monster.updateAnimation?.bind(monster);
      monster.updateAnimation = (dt) => {
        prev?.(dt);
        spriteUpdater(dt);
      };
    }

    // Add to scene
    this.scene.add(model);
    console.log(`   ✅ Model added to scene`);
    console.log(`   World position:`, model.position);
    console.log(`   Model scale:`, model.scale);
    console.log(`   Model visible (after):`, model.visible);
    console.log(`   Scene children count:`, this.scene.children.length);

    // Create AI brain
    this.attachBrain(monster, typeConfig, levelConfig);

    // Add to monsters array
    this.monsters.push(monster);

    console.log(`✅ ${typeName} spawned successfully`);
  }

  /**
   * Spawn placeholder cube monsters WITH TYPE CONFIG (for debugging)
   * @param {number} count - Number of monsters
   */
  spawnPlaceholderMonstersWithTypes(count) {
    console.log(`⚠️ Creating ${count} placeholder monsters WITH AI (cubes)`);

    // Get spawn points
    let spawnPoints = this.worldState.getMonsterSpawns();
    console.log(`📍 Got ${spawnPoints.length} monster spawn points from world state`);

    if (spawnPoints.length < count) {
      console.warn(`⚠️ Not enough spawn points, generating near player...`);
      const playerSpawn = this.worldState.getSpawnPoint();
      spawnPoints = [];

      const offsets = [
        { x: 3, y: 0 }, { x: -3, y: 0 }, { x: 0, y: 3 }, { x: 0, y: -3 },
        { x: 5, y: 5 }, { x: -5, y: 5 }, { x: 5, y: -5 }, { x: -5, y: -5 }
      ];

      for (let i = 0; i < Math.min(count, offsets.length); i++) {
        const point = { x: playerSpawn.x + offsets[i].x, y: playerSpawn.y + offsets[i].y };
        if (this.worldState.isWalkable(point.x, point.y)) {
          spawnPoints.push(point);
        } else {
          spawnPoints.push(playerSpawn);
        }
      }
    }

    // Create a mix of monster types
    const monsterTypeMix = createMonsterMix(count);
    console.log(`🎲 Monster type distribution:`, monsterTypeMix.map(t => t.name));

    for (let i = 0; i < Math.min(count, spawnPoints.length); i++) {
      const typeConfig = monsterTypeMix[i];
      this.spawnPlaceholderMonster(spawnPoints[i], typeConfig);
    }

    console.log(`\n📦 Created ${this.monsters.length} placeholder monsters with AI`);
    this.printMonsterSummary();
  }

  attachBrain(monster, typeConfig, levelConfig = null) {
    const aiType = this.resolveAiType(typeConfig);
    const brainConfig = this.buildBrainConfig(typeConfig, levelConfig);
    const brain = createMonsterBrain({
      type: aiType,
      worldState: this.worldState,
      pathfinder: this.pathfinder,
      monster,
      playerRef: this.playerRef,
      config: brainConfig
    });
    this.brains.set(monster, brain);
  }

  resolveAiType(typeConfig) {
    if (typeConfig?.aiType) return typeConfig.aiType;
    const name = typeConfig?.name?.toLowerCase() || '';
    if (name.includes('hunt')) return 'hunter';
    if (name.includes('rush')) return 'speedJitter';
    if (name.includes('stalk')) return 'teleportStalker';
    if (name.includes('sentinel') || name.includes('guard')) return 'corridorGuardian';
    return 'wanderCritter';
  }

  buildBrainConfig(typeConfig, levelConfig) {
    const stats = typeConfig?.stats || {};
    const behavior = typeConfig?.behavior || {};
    const allowSprintTypes = levelConfig?.monsters?.allowSprintTypes || [];
    return {
      visionRange: stats.visionRange,
      chaseTimeout: behavior.chaseMemory ? behavior.chaseMemory / 1000 : undefined,
      chaseCooldown: behavior.chaseCooldown ? behavior.chaseCooldown / 1000 : undefined,
      searchRadius: behavior.searchRadius,
      preferredMode: behavior.preferredMode,
      allowSprint: allowSprintTypes.includes(typeConfig?.name)
    };
  }

  applyBrainCommand(monster, command, deltaTime) {
    const move = command?.move || { x: 0, y: 0 };
    const speed = monster.getSpeed ? monster.getSpeed(command?.sprint) : CONFIG.MONSTER_SPEED;
    const dx = move.x * speed * deltaTime;
    const dz = move.y * speed * deltaTime;

    if (!Number.isFinite(dx) || !Number.isFinite(dz)) {
      return;
    }

    const current = monster.getWorldPosition?.();
    if (current) {
      if (!Number.isFinite(current.x) || !Number.isFinite(current.z)) {
        return;
      }
      const desiredDelta = new THREE.Vector3(dx, 0, dz);
      const targetPos = current.clone().add(desiredDelta);
      this.tryMoveMonster(monster, current, targetPos, desiredDelta);
    }

    if (typeof command?.lookYaw === 'number' && command.lookYaw !== 0) {
      const currentYaw = monster.getYaw ? monster.getYaw() : 0;
      if (monster.setYaw) {
        monster.setYaw(currentYaw + command.lookYaw);
      }
    }
  }

  tryMoveMonster(monster, currentPos, targetPos, deltaVec) {
    if (this.canMonsterMoveTo(targetPos.x, targetPos.z)) {
      monster.setWorldPosition(targetPos);
      return true;
    }

    let moved = false;
    if (Math.abs(deltaVec.x) > Math.abs(deltaVec.z)) {
      const posX = currentPos.clone().add(new THREE.Vector3(deltaVec.x, 0, 0));
      if (this.canMonsterMoveTo(posX.x, posX.z)) {
        monster.setWorldPosition(posX);
        moved = true;
      }
      const posZ = currentPos.clone().add(new THREE.Vector3(0, 0, deltaVec.z));
      if (this.canMonsterMoveTo(posZ.x, posZ.z)) {
        monster.setWorldPosition(posZ);
        moved = true;
      }
    } else {
      const posZ = currentPos.clone().add(new THREE.Vector3(0, 0, deltaVec.z));
      if (this.canMonsterMoveTo(posZ.x, posZ.z)) {
        monster.setWorldPosition(posZ);
        moved = true;
      }
      const posX = currentPos.clone().add(new THREE.Vector3(deltaVec.x, 0, 0));
      if (this.canMonsterMoveTo(posX.x, posX.z)) {
        monster.setWorldPosition(posX);
        moved = true;
      }
    }
    return moved;
  }

  canMonsterMoveTo(worldX, worldZ) {
    if (!this.worldState || !this.worldState.isWalkable) return true;

    const tileSize = CONFIG.TILE_SIZE || 1;
    const gridX = Math.floor(worldX / tileSize);
    const gridY = Math.floor(worldZ / tileSize);

    if (!Number.isFinite(gridX) || !Number.isFinite(gridY)) return false;
    if (!this.worldState.isWalkable(gridX, gridY)) return false;

    const radius = (CONFIG.PLAYER_RADIUS || 0.35) * 0.9;
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
      const gx = Math.floor((worldX + offset.x) / tileSize);
      const gy = Math.floor((worldZ + offset.z) / tileSize);
      if (!this.worldState.isWalkable(gx, gy)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Spawn placeholder cube monsters (for testing or if model loading fails)
   * @param {number} count - Number of monsters
   */
  spawnPlaceholderMonsters(count) {
    console.log(`⚠️ Creating ${count} placeholder monsters (cubes)`);

    // Try to get proper monster spawn points first
    let spawnPoints = this.worldState.getMonsterSpawns();
    console.log(`📍 Got ${spawnPoints.length} monster spawn points from world state`);

    // If not enough spawn points, generate near player
    if (spawnPoints.length < count) {
      console.warn(`⚠️ Not enough spawn points, generating near player...`);
      const playerSpawn = this.worldState.getSpawnPoint();
      spawnPoints = [];

      // Create spawn points around player
      const offsets = [
        { x: 3, y: 0 },
        { x: -3, y: 0 },
        { x: 0, y: 3 },
        { x: 0, y: -3 },
        { x: 5, y: 5 },
        { x: -5, y: 5 },
        { x: 5, y: -5 },
        { x: -5, y: -5 }
      ];

      for (let i = 0; i < Math.min(count, offsets.length); i++) {
        const point = {
          x: playerSpawn.x + offsets[i].x,
          y: playerSpawn.y + offsets[i].y
        };
        // Make sure it's walkable
        if (this.worldState.isWalkable(point.x, point.y)) {
          spawnPoints.push(point);
        } else {
          console.warn(`   Point (${point.x}, ${point.y}) not walkable, trying player spawn`);
          spawnPoints.push(playerSpawn);
        }
      }
    }

    console.log(`📍 Using ${spawnPoints.length} spawn points:`, spawnPoints);

    for (let i = 0; i < Math.min(count, spawnPoints.length); i++) {
      console.log(`\n🔶 Creating placeholder monster ${i + 1}/${count}`);

      // Create a simple red cube as placeholder
      const geometry = new THREE.BoxGeometry(0.8, 1.8, 0.8);
      const material = new THREE.MeshStandardMaterial({
        color: 0xff0000,
        emissive: 0x440000,
        roughness: 0.5,
        metalness: 0.2
      });
      const cube = new THREE.Mesh(geometry, material);
      cube.castShadow = true;
      cube.receiveShadow = true;

      const group = new THREE.Group();
      group.add(cube);

      // Add eyes
      const eyeGeometry = new THREE.SphereGeometry(0.1, 8, 8);
      const eyeMaterial = new THREE.MeshStandardMaterial({
        color: 0xffff00,
        emissive: 0xffff00,
        emissiveIntensity: 0.5
      });

      const leftEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
      leftEye.position.set(-0.2, 0.5, 0.4);
      group.add(leftEye);

      const rightEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
      rightEye.position.set(0.2, 0.5, 0.4);
      group.add(rightEye);

      console.log(`   Grid position: (${spawnPoints[i].x}, ${spawnPoints[i].y})`);

      const monster = new Monster(group, spawnPoints[i], this.worldState);

      // Attach default AI
      this.attachBrain(monster, null);

      // CRITICAL: Add to scene BEFORE pushing to monsters array
      this.scene.add(group);
      console.log(`   ✅ Added to scene at world position:`, group.position);
      console.log(`   Scene children count:`, this.scene.children.length);
      console.log(`   Model visible:`, group.visible);
      console.log(`   Model scale:`, group.scale);

      this.monsters.push(monster);

      console.log(`✅ Monster ${i + 1} added to scene and monsters array`);
    }

    console.log(`\n📦 Created ${this.monsters.length} placeholder monsters`);
    console.log(`📊 Scene total children:`, this.scene.children.length);
  }

  /**
   * Update all monsters
   * @param {number} deltaTime - Time since last frame
   * @param {THREE.Vector3} playerPosition - Player position
   */
  update(deltaTime) {
    const dt = deltaTime ?? 0;
    for (const monster of this.monsters) {
      // Keep grid in sync with any external changes
      if (monster.syncGridFromWorld) {
        monster.syncGridFromWorld();
      }

      const brain = this.brains.get(monster);
      if (!brain) continue;

      const command = brain.tick(dt) || { move: { x: 0, y: 0 }, lookYaw: 0, sprint: false };
      this.applyBrainCommand(monster, command, dt);

      if (monster.updateAnimation) {
        monster.updateAnimation(dt);
      }
    }
  }

  /**
   * Get all monster positions (for minimap)
   * @returns {Array<Object>} Array of {x, y} grid positions
   */
  getMonsterPositions() {
    return this.monsters.map(m => m.getGridPosition());
  }

  /**
   * Get all monsters
   * @returns {Array<Monster>} Array of monsters
   */
  getMonsters() {
    return this.monsters;
  }

  /**
   * Check if player is caught by any monster
   * @param {THREE.Vector3} playerPosition - Player position
   * @param {number} catchDistance - Distance for catching player
   * @returns {boolean} True if caught
   */
  /**
   * Check if player is caught by any monster
   * @param {THREE.Vector3} playerPosition - Player world position
   * @param {number} catchDistance - Distance threshold
   * @returns {{hit: boolean, monster: Monster|null}}
   */
  checkPlayerCaught(playerPosition, catchDistance = 1) {
    let nearest = null;
    let nearestDist = Infinity;

    for (const monster of this.monsters) {
      const distance = monster.getWorldPosition().distanceTo(playerPosition);
      if (distance < catchDistance && distance < nearestDist) {
        nearest = monster;
        nearestDist = distance;
      }
    }

    return {
      hit: !!nearest,
      monster: nearest
    };
  }

  /**
   * Spawn a single placeholder monster
   * @param {Object} spawnPosition - Grid position {x, y}
   * @param {Object} typeConfig - Monster type configuration
   */
  spawnPlaceholderMonster(spawnPosition, typeConfig, levelConfig = null) {
    const typeName = typeConfig?.name || 'Generic';
    console.log(`\n🔶 Creating placeholder ${typeName} at (${spawnPosition.x}, ${spawnPosition.y})`);

    // Create a LARGER cube as placeholder (INCREASED SIZE)
    const geometry = new THREE.BoxGeometry(1.6, 3.6, 1.6); // DOUBLED size
    const material = new THREE.MeshStandardMaterial({
      color: typeConfig?.appearance?.emissiveColor || 0xff0000,
      emissive: typeConfig?.appearance?.emissiveColor || 0x440000,
      emissiveIntensity: 0.3, // Add glow
      roughness: 0.5,
      metalness: 0.2
    });
    const cube = new THREE.Mesh(geometry, material);
    cube.castShadow = true;
    cube.receiveShadow = true;

    const group = new THREE.Group();
    group.add(cube);

    // Add LARGER eyes
    const eyeGeometry = new THREE.SphereGeometry(0.2, 8, 8); // DOUBLED
    const eyeMaterial = new THREE.MeshStandardMaterial({
      color: 0xffff00,
      emissive: 0xffff00,
      emissiveIntensity: 1.0 // Brighter
    });

    const leftEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
    leftEye.position.set(-0.4, 1.0, 0.8); // Adjusted for larger cube
    group.add(leftEye);

    const rightEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
    rightEye.position.set(0.4, 1.0, 0.8);
    group.add(rightEye);

    console.log(`   Creating Monster instance with typeConfig:`, typeConfig?.name);
    const monster = new Monster(group, spawnPosition, this.worldState, typeConfig, levelConfig);

    // AI brain
    this.attachBrain(monster, typeConfig, levelConfig);

    console.log(`   Adding to scene...`);
    this.scene.add(group);
    console.log(`   Scene children count:`, this.scene.children.length);
    console.log(`   Group position:`, group.position);
    console.log(`   Group visible:`, group.visible);

    this.monsters.push(monster);

    console.log(`✅ Placeholder ${typeName} created and added`);
  }

  /**
   * Print summary of spawned monsters
   */
  printMonsterSummary() {
    const summary = {};
    for (const monster of this.monsters) {
      const typeName = monster.typeConfig?.name || 'Generic';
      summary[typeName] = (summary[typeName] || 0) + 1;
    }

    console.log('\n📊 Monster Summary:');
    for (const [type, count] of Object.entries(summary)) {
      console.log(`   ${type}: ${count}`);
    }
  }

  /**
   * Remove all monsters
   */
  clear() {
    for (const monster of this.monsters) {
      this.scene.remove(monster.getModel());
    }
    this.monsters = [];
    this.brains.clear();
    console.log('🗑️ All monsters removed');
  }

  /**
   * Change all monster models (unified model system)
   * @param {string} modelPath - Path to new model (e.g., 'VascodaGama.dae')
   */
  async changeMonsterModel(modelPath) {
    console.log(`🔄 Changing all monsters to model: ${modelPath}`);

    try {
      // Load new model
      const { model, animations } = await this.modelLoader.loadModelWithAnimations(modelPath);
      console.log(`   ✅ New model loaded`);

      // For each monster, replace its model
      for (let i = 0; i < this.monsters.length; i++) {
        const monster = this.monsters[i];
        const oldModel = monster.getModel();

        // Clone new model
        const newModel = model.clone(true);

        // 先移除舊模型
        this.scene.remove(oldModel);

        // ★ 交給 Monster 自己做縮放 & 對齊
        monster.setModel(newModel);

        // 再把新模型加回場景
        this.scene.add(newModel);

        if (animations && animations.length > 0) {
          monster.setupAnimations(animations);
        }

        console.log(`   ✅ Monster ${i + 1}/${this.monsters.length} model updated`);
      }

      // Update current model path
      this.currentModelPath = modelPath;
      console.log(`✅ Successfully changed all monsters to ${modelPath}`);

    } catch (error) {
      console.error(`❌ Failed to change model:`, error);
      throw error;
    }
  }
}
