/**
 * Monster Manager
 * Handles spawning, updating, and managing all monsters
 * Now supports multiple monster types with different behaviors
 */

import * as THREE from 'three';
import { Monster } from './monster.js';
import { ModelLoader } from './modelLoader.js';
import { createMonsterMix } from '../ai/monsterTypes.js';
import { CONFIG } from '../core/config.js';

export class MonsterManager {
  /**
   * Create monster manager
   * @param {THREE.Scene} scene - Three.js scene
   * @param {WorldState} worldState - Reference to world state
   */
  constructor(scene, worldState) {
    this.scene = scene;
    this.worldState = worldState;
    this.monsters = [];
    this.modelLoader = new ModelLoader();
    this.currentModelPath = CONFIG.MONSTER_MODEL; // Track current model
  }

  /**
   * Initialize monsters with mixed types
   * @param {number} count - Number of monsters to spawn
   */
  async initialize(count = 1) {
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
      const monsterTypeMix = createMonsterMix(count);
      console.log(`🎲 Monster type distribution:`, monsterTypeMix.map(t => t.name));

      // Load the unified model once
      console.log(`\n📦 Loading unified model: ${this.currentModelPath}`);
      const { model, animations } = await this.modelLoader.loadModelWithAnimations(this.currentModelPath);
      console.log(`   ✅ Model loaded successfully`);

      // Spawn each monster with the same model (but different AI types)
      for (let i = 0; i < count; i++) {
        const typeConfig = monsterTypeMix[i];
        console.log(`\n🦊 Spawning ${typeConfig.name} (${i + 1}/${count})...`);

        try {
          // Clone the unified model for this monster
          const clonedModel = model.clone(true);
          await this.spawnMonster(clonedModel, animations, spawnPoints[i], typeConfig);
        } catch (error) {
          console.error(`   ❌ Failed to spawn ${typeConfig.name}:`, error.message);
          console.warn(`   ⚠️ Creating placeholder instead`);
          this.spawnPlaceholderMonster(spawnPoints[i], typeConfig);
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
  async spawnMonster(model, animations, spawnPosition, typeConfig = null) {
    const typeName = typeConfig?.name || 'Generic';
    console.log(`\n🎭 Creating ${typeName} at grid (${spawnPosition.x}, ${spawnPosition.y})`);
    console.log('   Model children count:', model.children.length);
    console.log('   Model type:', model.type);
    console.log('   Model visible (before):', model.visible);

    const monster = new Monster(model, spawnPosition, this.worldState, typeConfig);

    // Setup animations
    if (animations && animations.length > 0) {
      console.log(`   Setting up ${animations.length} animations`);
      monster.setupAnimations(animations);
    }

    // Add to scene
    this.scene.add(model);
    console.log(`   ✅ Model added to scene`);
    console.log(`   World position:`, model.position);
    console.log(`   Model scale:`, model.scale);
    console.log(`   Model visible (after):`, model.visible);
    console.log(`   Scene children count:`, this.scene.children.length);

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
  update(deltaTime, playerPosition) {
    for (const monster of this.monsters) {
      monster.update(deltaTime, playerPosition);
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
  checkPlayerCaught(playerPosition, catchDistance = 1) {
    for (const monster of this.monsters) {
      const distance = monster.getWorldPosition().distanceTo(playerPosition);
      if (distance < catchDistance) {
        return true;
      }
    }
    return false;
  }

  /**
   * Spawn a single placeholder monster
   * @param {Object} spawnPosition - Grid position {x, y}
   * @param {Object} typeConfig - Monster type configuration
   */
  spawnPlaceholderMonster(spawnPosition, typeConfig) {
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
    const monster = new Monster(group, spawnPosition, this.worldState, typeConfig);

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

        // Copy position and rotation from old model
        newModel.position.copy(oldModel.position);
        newModel.rotation.copy(oldModel.rotation);
        newModel.scale.copy(oldModel.scale);

        // Remove old model from scene
        this.scene.remove(oldModel);

        // Add new model to scene
        this.scene.add(newModel);

        // Update monster's model reference
        monster.model = newModel;

        // Setup animations for new model
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
