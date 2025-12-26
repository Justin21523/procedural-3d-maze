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
import { EnemyModelSelector } from './monsterManager/modelSelection.js';
import { MonsterPerception } from './monsterManager/perception.js';
import { MonsterSpawner } from './monsterManager/spawn.js';
import { MonsterDamage } from './monsterManager/damage.js';
import { EnemyCatalog, applyEnemyMetaToTypeConfig, applyEnemyModelMeta } from '../ai/enemyCatalog.js';
import { Pathfinding } from '../ai/pathfinding.js';
import { SquadCoordinator } from '../ai/components/tactics/squadCoordinator.js';
import { getSquadRoleBrainDefaults } from '../ai/squadRoleCatalog.js';
import { CONFIG, resolveMonsterCount } from '../core/config.js';

export class MonsterManager {
  /**
   * Create monster manager
   * @param {THREE.Scene} scene - Three.js scene
   * @param {WorldState} worldState - Reference to world state
   */
  constructor(scene, worldState, playerRef = null, eventBus = null) {
    this.scene = scene;
    this.worldState = worldState;
    this.playerRef = playerRef;
    this.eventBus = eventBus;
    this.monsters = [];
    this.brains = new Map();
    this.modelLoader = new ModelLoader();
    this.currentModelPath = CONFIG.MONSTER_MODEL; // Track current model
    this.pathfinder = new Pathfinding(worldState);

    this.modelSelector = new EnemyModelSelector();
    this.perception = new MonsterPerception();
    this.spawner = new MonsterSpawner(this, this.modelSelector);
    this.damage = new MonsterDamage(this);

    this.levelConfig = null;
    this.enemyCatalog = new EnemyCatalog();
    this.projectileManager = null;
    this.squadCoordinator = new SquadCoordinator();
  }

  setPlayerRef(playerRef) {
    this.playerRef = playerRef;
    for (const brain of this.brains.values()) {
      if (brain?.setPlayerRef) {
        brain.setPlayerRef(playerRef);
      } else {
        brain.playerRef = playerRef;
      }
    }
    this.perception?.clear?.();
  }

  setProjectileManager(projectileManager) {
    this.projectileManager = projectileManager;
  }

  setEventBus(eventBus) {
    this.eventBus = eventBus;
  }

  setAutoRespawnEnabled(enabled) {
    this.spawner?.setAutoRespawnEnabled?.(enabled);
  }

  registerNoise(position, options = {}) {
    this.perception?.registerNoise?.(position, options);
  }

  updateNoise(dt) {
    this.perception?.updateNoise?.(dt);
  }

  getNoisePriority(kind) {
    return this.perception?.getNoisePriority?.(kind) ?? 0;
  }

  getMonsterHearingRange(monster, brain) {
    return this.perception?.getMonsterHearingRange?.(monster, brain) ?? 0;
  }

  pickAudibleNoise(monster, brain) {
    return this.perception?.pickAudibleNoise?.(monster, brain) ?? null;
  }

  updatePlayerNoise(dt, playerPos) {
    const sprinting = this.playerRef?.isSprinting
      ? this.playerRef.isSprinting()
      : (this.playerRef?.input?.isSprinting?.() ?? false);
    this.perception?.updatePlayerNoise?.(dt, playerPos, { sprinting });
  }

  canMonsterSeePlayer(monster, playerGrid) {
    return this.perception?.canMonsterSeePlayer?.(monster, playerGrid, this.worldState) ?? false;
  }

  maybeBroadcastAlert(monster, playerPos, playerGrid, dt) {
    this.perception?.maybeBroadcastAlert?.(monster, playerPos, playerGrid, dt, this.worldState);
  }

  async loadEnemyModelManifest() {
    return this.modelSelector?.loadManifest?.() || [];
  }

  pickEnemyModelPool(allModels) {
    return this.modelSelector?.pickModelPool?.(allModels) || [];
  }

  pickRandomEnemyModel(models) {
    return this.modelSelector?.pickRandom?.(models) || null;
  }

  pickEnemyModelFromBag(models) {
    return this.modelSelector?.pickFromBag?.(models) || null;
  }

  manhattan(a, b) {
    return this.spawner?.manhattan?.(a, b) ?? 0;
  }

  getPlayerSpawnGrid() {
    return this.spawner?.getPlayerSpawnGrid?.() || null;
  }

  pickSpreadOutSpawn(occupied = [], options = {}) {
    return this.spawner?.pickSpreadOutSpawn?.(occupied, options) || this.worldState?.getSpawnPoint?.() || { x: 1, y: 1 };
  }

  /**
   * Initialize monsters with mixed types
   * @param {number} count - Number of monsters to spawn
   */
  async initializeForLevel(levelConfig = null) {
    this.levelConfig = levelConfig;
    const requested = resolveMonsterCount(levelConfig);
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
    this.levelConfig = levelConfig;
    console.log(`🎮 Initializing ${count} monsters with mixed types...`);

    try {
      const manifest = await this.loadEnemyModelManifest();
      const enemyModelPool = this.pickEnemyModelPool(manifest);
      if (enemyModelPool.length > 0) {
        console.log(`📦 Enemy model pool: ${enemyModelPool.length} models`);
      } else {
        console.log('📦 Enemy model pool: (empty) using sprite billboards');
      }

      const precomputedSpawns = this.worldState?.getMonsterSpawns?.() || [];
      console.log(`📍 Precomputed monster spawns: ${precomputedSpawns.length}`);
      const chosenSpawns = [];

      // Create a mix of monster types
      const monsterTypeMix = createMonsterMix(count, weights);
      console.log(`🎲 Monster type distribution:`, monsterTypeMix.map(t => t.name));

      // Spawn each monster using 2D billboard sprites (keeps other objects 3D)
      for (let i = 0; i < count; i++) {
        const typeConfig = monsterTypeMix[i];
        const spawnPosition = this.pickSpreadOutSpawn(chosenSpawns);
        chosenSpawns.push(spawnPosition);
        console.log(`\n🦊 Spawning ${typeConfig.name} (${i + 1}/${count})...`);

        try {
          const modelPath = this.pickEnemyModelFromBag(enemyModelPool);

          if (modelPath) {
            console.log(`   🎲 Model: ${modelPath}`);
            const { model, animations } = await this.modelLoader.loadModelWithAnimations(modelPath);
            await this.spawnMonster(model, animations, spawnPosition, typeConfig, levelConfig, null, { modelPath });
          } else {
            const spriteResult = createSpriteBillboard({
              path: typeConfig.sprite || '/models/monster.png',
              framesFolder: typeConfig.spriteFramesPath ?? '../assets/moonman-sequence',
              frameRate: typeConfig.spriteFrameRate ?? 8,
              randomStart: true,
              clipLengthRange: { min: 20, max: 60 },
              scale: { x: 1.5, y: 2.5 }
            });
            const spriteGroup = spriteResult.group || spriteResult;
            await this.spawnMonster(spriteGroup, [], spawnPosition, typeConfig, levelConfig, spriteResult.updateAnimation);
          }
        } catch (error) {
          console.error(`   ❌ Failed to spawn ${typeConfig.name}:`, error.message);
          console.warn(`   ⚠️ Creating placeholder instead`);
          this.spawnPlaceholderMonster(spawnPosition, typeConfig, levelConfig);
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
  async spawnMonster(model, animations, spawnPosition, typeConfig = null, levelConfig = null, spriteUpdater = null, options = null) {
    const modelPath = options?.modelPath || null;
    let meta = options?.meta || null;
    if (!meta && modelPath) {
      meta = await this.enemyCatalog.getMeta(modelPath);
    }

    const instanceTypeConfig = typeConfig ? JSON.parse(JSON.stringify(typeConfig)) : null;
    if (instanceTypeConfig && meta) {
      applyEnemyMetaToTypeConfig(instanceTypeConfig, meta);
    }

    if (meta) {
      applyEnemyModelMeta(model, meta);
    }

    const typeName = instanceTypeConfig?.name || typeConfig?.name || 'Generic';
    console.log(`\n🎭 Creating ${typeName} at grid (${spawnPosition.x}, ${spawnPosition.y})`);
    console.log('   Model children count:', model.children.length);
    console.log('   Model type:', model.type);
    console.log('   Model visible (before):', model.visible);

    const monster = new Monster(model, spawnPosition, this.worldState, instanceTypeConfig || typeConfig || {}, levelConfig);
    monster.modelPath = modelPath;
    monster.modelMeta = meta;

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
    this.attachBrain(monster, instanceTypeConfig || typeConfig, levelConfig);

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

    // Create a mix of monster types
    const monsterTypeMix = createMonsterMix(count);
    console.log(`🎲 Monster type distribution:`, monsterTypeMix.map(t => t.name));

    const chosenSpawns = [];
    for (let i = 0; i < count; i++) {
      const typeConfig = monsterTypeMix[i];
      const spawnPosition = this.pickSpreadOutSpawn(chosenSpawns);
      chosenSpawns.push(spawnPosition);
      this.spawnPlaceholderMonster(spawnPosition, typeConfig);
    }

    console.log(`\n📦 Created ${this.monsters.length} placeholder monsters with AI`);
    this.printMonsterSummary();
  }

  attachBrain(monster, typeConfig, levelConfig = null) {
    const aiType = this.resolveAiType(typeConfig);
    const brainConfig = this.buildBrainConfig(aiType, typeConfig, levelConfig);
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
    if (name.includes('stalk')) return 'distanceStalker';
    if (name.includes('sentinel') || name.includes('guard')) return 'roomHunter';
    if (name.includes('greet')) return 'greeter';
    return 'autopilotWanderer';
  }

  buildBrainConfig(aiType, typeConfig, levelConfig) {
    const stats = typeConfig?.stats || {};
    const behavior = typeConfig?.behavior || {};
    const allowSprintTypes = levelConfig?.monsters?.allowSprintTypes || [];
    const typeId = typeConfig?.id || typeConfig?.name;

    const visionMult = levelConfig?.monsters?.visionMultiplier ?? 1.0;
    const memoryMult = levelConfig?.monsters?.memoryMultiplier ?? 1.0;

    const visionRange = Number.isFinite(stats.visionRange)
      ? stats.visionRange * visionMult
      : undefined;

    let chaseTimeout =
      behavior.chaseTimeout ??
      (behavior.chaseMemory ? behavior.chaseMemory / 1000 : undefined);

    if (Number.isFinite(chaseTimeout)) {
      chaseTimeout *= memoryMult;
    }

    const baseConfig = {
      visionRange,
      hearingRange: stats.hearingRange,
      allowSprint: allowSprintTypes.includes(typeId)
    };

    const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

    const normalizeModules = (modules) => {
      if (!modules) return null;
      if (Array.isArray(modules)) {
        const next = {};
        for (const name of modules) {
          if (typeof name === 'string' && name) next[name] = true;
        }
        return Object.keys(next).length > 0 ? next : null;
      }
      if (isObject(modules)) return modules;
      return null;
    };

    const mergeModules = (baseModules, overrideModules) => {
      const a = normalizeModules(baseModules) || {};
      const b = normalizeModules(overrideModules) || null;
      if (!b) return Object.keys(a).length > 0 ? a : null;

      const next = { ...a };
      for (const [key, value] of Object.entries(b)) {
        const existing = next[key];
        if (isObject(existing) && isObject(value)) {
          next[key] = { ...existing, ...value };
          continue;
        }
        next[key] = value;
      }
      return Object.keys(next).length > 0 ? next : null;
    };

	    const applySquadRoleDefaults = (config) => {
	      const squad = typeConfig?.squad || null;
	      const squadId = typeof squad?.squadId === 'string' ? squad.squadId : null;
	      const role = typeof squad?.role === 'string' ? squad.role : null;
	      if (!squadId || !role) return config;

	      const defaults = getSquadRoleBrainDefaults(role);
	      const next = { ...config };

	      next.modules = mergeModules(next.modules, defaults?.modules);

	      if (isObject(defaults?.tactics)) {
	        next.tactics = { ...(isObject(next.tactics) ? next.tactics : {}), ...defaults.tactics };
	      }

	      if (isObject(defaults?.combat)) {
	        next.combat = { ...(isObject(next.combat) ? next.combat : {}), ...defaults.combat };
	      }

	      const squadCfg = isObject(defaults?.squad) ? defaults.squad : {};
	      next.squad = {
	        ...(isObject(next.squad) ? next.squad : {}),
	        ...squadCfg,
	        squadId,
	        role,
	        waveIndex: squad?.waveIndex,
	        coordinator: this.squadCoordinator
	      };

	      // Provide squad info to combat modules (used for focus-fire + role cadence).
	      next.combat = {
	        ...(isObject(next.combat) ? next.combat : {}),
	        squadCoordinator: this.squadCoordinator,
	        squadId,
	        role
	      };

	      return next;
	    };

    const applyOverrides = (config) => {
      const overrides = typeConfig?.brain;
      if (!overrides || typeof overrides !== 'object') return config;
      const next = { ...config, ...overrides };
      if (overrides.tactics && typeof overrides.tactics === 'object') {
        next.tactics = { ...(config?.tactics || {}), ...overrides.tactics };
      }
      if (overrides.combat && typeof overrides.combat === 'object') {
        next.combat = { ...(config?.combat || {}), ...overrides.combat };
      }
      if ('modules' in overrides) {
        next.modules = mergeModules(config?.modules, overrides.modules);
      }
      if (overrides.squad && typeof overrides.squad === 'object') {
        next.squad = { ...(config?.squad || {}), ...overrides.squad };
      }
      return next;
    };

    switch (aiType) {
      case 'autopilotWanderer':
      case 'autopilot': {
        const aggressiveness = behavior.aggressiveness || 'low';
        const defaultChaseRange =
          aggressiveness === 'very_high' ? 4 :
          aggressiveness === 'high' ? 3 :
          aggressiveness === 'medium' ? 2 :
          1;

        return applyOverrides(applySquadRoleDefaults({
          ...baseConfig,
          chaseRange: behavior.chaseRange ?? defaultChaseRange,
          maxChaseDuration: behavior.maxChaseDuration ?? chaseTimeout
        }));
      }

      case 'roomHunter':
      case 'hunter': {
        const inferredHomeRadius = Number.isFinite(behavior.searchRadius)
          ? Math.max(4, Math.round(behavior.searchRadius * 2))
          : undefined;

        return applyOverrides(applySquadRoleDefaults({
          ...baseConfig,
          homeRadius: behavior.homeRadius ?? inferredHomeRadius,
          chaseTimeout
        }));
      }

      case 'distanceStalker': {
        let memoryDuration = behavior.memoryDuration ? behavior.memoryDuration / 1000 : chaseTimeout;
        if (behavior.memoryDuration && Number.isFinite(memoryDuration)) {
          memoryDuration *= memoryMult;
        }

        return applyOverrides(applySquadRoleDefaults({
          ...baseConfig,
          followDistance: behavior.followDistance,
          memoryDuration,
          followWhenPlayerSprints: behavior.followWhenPlayerSprints ?? true,
          followWhenHasLineOfSight: behavior.followWhenHasLineOfSight ?? true
        }));
      }

      case 'speedJitter':
      case 'jitter':
        return applyOverrides(applySquadRoleDefaults({
          ...baseConfig,
          slowDuration: behavior.slowDuration,
          sprintDuration: behavior.sprintDuration,
          sprintMultiplier: behavior.sprintMultiplier,
          followPlayer: behavior.followPlayer
        }));

      case 'shyGreeter':
      case 'greeter': {
        const greetDistance = behavior.greetDistance ?? 4;
        return applyOverrides(applySquadRoleDefaults({
          ...baseConfig,
          greetDistance,
          tooCloseDistance: behavior.tooCloseDistance ?? behavior.avoidPlayerDistance ?? 2,
          idealDistance: behavior.idealDistance ?? Math.max(1, greetDistance - 1),
          roamRadius: behavior.roamRadius ?? 4
        }));
      }

      case 'teleportStalker':
      case 'stalker':
        return applyOverrides(applySquadRoleDefaults({
          ...baseConfig,
          chaseRange: behavior.chaseRange,
          teleportCooldown: behavior.teleportCooldown,
          teleportTriggerDistance: behavior.teleportTriggerDistance,
          minTeleportDist: behavior.minTeleportDist,
          maxTeleportDist: behavior.maxTeleportDist
        }));

      default:
        return applyOverrides(applySquadRoleDefaults(baseConfig));
    }
  }

  applyBrainCommand(monster, command, deltaTime, options = {}) {
    const allowSteering = options.allowSteering !== false;
    const allowLook = options.allowLook !== false;

    const desiredMove = command?.move || { x: 0, y: 0 };
    const move = allowSteering ? this.applySteering(monster, desiredMove) : desiredMove;
    const speed = monster.getSpeed ? monster.getSpeed(command?.sprint) : CONFIG.MONSTER_SPEED;
    const dx = move.x * speed * deltaTime;
    const dz = move.y * speed * deltaTime;
    monster.isSprinting = !!command?.sprint;

    if (!Number.isFinite(dx) || !Number.isFinite(dz)) {
      monster.isMoving = false;
      return;
    }

    const current = monster.getWorldPosition?.();
    let moved = false;
    if (current) {
      if (!Number.isFinite(current.x) || !Number.isFinite(current.z)) {
        monster.isMoving = false;
        return;
      }
      const desiredDelta = new THREE.Vector3(dx, 0, dz);
      const targetPos = current.clone().add(desiredDelta);
      moved = this.tryMoveMonster(monster, current, targetPos, desiredDelta);
    }

    const intentMag = Math.hypot(dx, dz);
    monster.isMoving = moved && intentMag > 0.001;

    if (allowLook && typeof command?.lookYaw === 'number' && command.lookYaw !== 0) {
      const currentYaw = monster.getYaw ? monster.getYaw() : 0;
      if (monster.setYaw) {
        monster.setYaw(currentYaw + command.lookYaw);
      }
    }
  }

  applySteering(monster, desiredMove) {
    if (!this.monsters || this.monsters.length === 0) return desiredMove;
    const move = { ...desiredMove };
    const pos = monster.getWorldPosition ? monster.getWorldPosition() : null;
    if (!pos) return move;

    const avoidRadius = 1.2 * (CONFIG.TILE_SIZE || 1);
    const avoidForce = new THREE.Vector3(0, 0, 0);
    let count = 0;
    let doorYield = 1.0;

    // Doorway yield: if on a door and another monster is closer to center, slow down a bit
    const tileSize = CONFIG.TILE_SIZE || 1;
    const gx = Math.floor(pos.x / tileSize);
    const gy = Math.floor(pos.z / tileSize);
    const onDoor = this.worldState?.getTile && this.worldState.getTile(gx, gy) === 2;

    for (const other of this.monsters) {
      if (other === monster) continue;
      const op = other.getWorldPosition ? other.getWorldPosition() : null;
      if (!op) continue;
      const dist = pos.distanceTo(op);
      if (dist > avoidRadius || dist <= 0.001) continue;
      const away = pos.clone().sub(op).setY(0);
      away.normalize().multiplyScalar((avoidRadius - dist) / avoidRadius);
      avoidForce.add(away);
      count++;

      if (onDoor) {
        const otherDistToDoorCenter = Math.hypot(
          op.x - (gx + 0.5) * tileSize,
          op.z - (gy + 0.5) * tileSize
        );
        const selfDist = Math.hypot(
          pos.x - (gx + 0.5) * tileSize,
          pos.z - (gy + 0.5) * tileSize
        );
        if (otherDistToDoorCenter < selfDist) {
          doorYield = 0.55; // slow down to let the other pass
        }
      }
    }

    // Lightly avoid player as well
    if (this.playerRef?.getPosition) {
      const p = this.playerRef.getPosition();
      const dist = pos.distanceTo(p);
      if (dist > 0.001 && dist < avoidRadius) {
        const away = pos.clone().sub(p).setY(0);
        away.normalize().multiplyScalar((avoidRadius - dist) / avoidRadius);
        avoidForce.add(away);
        count++;
      }
    }

    if (count > 0) {
      avoidForce.divideScalar(count);
      const desired = new THREE.Vector3(move.x, 0, move.y);
      desired.add(avoidForce.multiplyScalar(0.6)).normalize();
      return { x: desired.x * doorYield, y: desired.z * doorYield };
    }

    return { x: move.x * doorYield, y: move.y * doorYield };
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
  update(deltaTime, playerPosition = null) {
    const dt = deltaTime ?? 0;
    this.updateDeathEffects(dt);
    this.updatePendingDeaths(dt);
    this.updateRespawns(dt);
    this.updateNoise(dt);

    const playerPos =
      playerPosition && playerPosition.isVector3 ? playerPosition :
      this.playerRef?.getPosition ? this.playerRef.getPosition() :
      null;
    const playerGrid = this.playerRef?.getGridPosition ? this.playerRef.getGridPosition() : null;

    if (playerPos) {
      this.updatePlayerNoise(dt, playerPos);
    }

    const tileSize = CONFIG.TILE_SIZE || 1;
    const farDistanceTiles = CONFIG.MONSTER_AI_FAR_DISTANCE_TILES ?? 12;
    const farDistanceWorld = Math.max(0, farDistanceTiles) * tileSize;
    const farDistanceSq = farDistanceWorld * farDistanceWorld;
    const farTickSeconds = Math.max(0.05, CONFIG.MONSTER_AI_FAR_TICK_SECONDS ?? 0.35);

    for (const monster of this.monsters) {
      if (monster?.isDead) continue;
      if (monster?.isDying) {
        if (monster.updateAnimation) {
          monster.updateAnimation(dt);
        }
        continue;
      }
      if ((monster.stunTimer || 0) > 0) {
        monster.stunTimer = Math.max(0, (monster.stunTimer || 0) - dt);
        monster.isMoving = false;
        monster.isSprinting = false;
        if (monster.updateAnimation) {
          monster.updateAnimation(dt);
        }
        continue;
      }

      const brain = this.brains.get(monster);
      if (!brain) continue;

      const posRef = monster?.model?.position || monster?.position || null;
      const dx = playerPos && posRef ? (posRef.x - playerPos.x) : 0;
      const dz = playerPos && posRef ? (posRef.z - playerPos.z) : 0;
      const distSq = playerPos && posRef ? (dx * dx + dz * dz) : 0;
      const isFar = playerPos && posRef ? distSq > farDistanceSq : false;

      if (isFar) {
        monster.aiTickAccumulator = (monster.aiTickAccumulator || 0) + dt;
      } else {
        monster.aiTickAccumulator = 0;
      }

      const shouldTick =
        !isFar ||
        (monster.aiTickAccumulator || 0) >= farTickSeconds ||
        !monster.lastBrainCommand;

      let command = monster.lastBrainCommand;

      if (shouldTick) {
        // Keep grid in sync with any external changes before AI reads it.
        if (monster.syncGridFromWorld) {
          monster.syncGridFromWorld();
        }

        const tickDt = isFar ? (monster.aiTickAccumulator || dt) : dt;
        monster.aiTickAccumulator = 0;

        const heard = this.pickAudibleNoise(monster, brain);
        if (heard && typeof brain.hearNoise === 'function') {
          brain.hearNoise(heard);
        }

        if (playerPos && playerGrid) {
          this.maybeBroadcastAlert(monster, playerPos, playerGrid, tickDt);
        }

        const rawCommand = brain.tick(tickDt) || { move: { x: 0, y: 0 }, lookYaw: 0, sprint: false };
        command = typeof brain.decorateCommand === 'function'
          ? brain.decorateCommand(rawCommand, tickDt)
          : rawCommand;
        monster.lastBrainCommand = command;
      }

      command = command || { move: { x: 0, y: 0 }, lookYaw: 0, sprint: false };
      this.applyBrainCommand(monster, command, dt, {
        allowSteering: !isFar,
        allowLook: shouldTick
      });

      if (monster.updateAnimation) {
        if (!isFar || shouldTick) {
          monster.updateAnimation(dt);
        }
      }

      if (shouldTick && command?.fire) {
        this.fireMonsterProjectile(monster, command.fire);
      }
    }
  }

  fireMonsterProjectile(monster, fire) {
    if (!monster || monster.isDead || monster.isDying) return;
    if (!fire) return;
    if (!this.projectileManager?.spawnMonsterProjectile) return;

    const origin = monster.getWorldPosition?.();
    if (!origin) return;

    // Raise to chest height and nudge forward to avoid spawning inside the monster.
    const height =
      (CONFIG.MONSTER_BASE_HEIGHT ?? 1.6) *
      (monster.scale || monster.typeConfig?.stats?.scale || 1);
    origin.y += Math.max(0.35, height * 0.7);

    const aim = fire.aimAt;
    const aimAt = aim && Number.isFinite(aim.x) && Number.isFinite(aim.y) && Number.isFinite(aim.z)
      ? new THREE.Vector3(aim.x, aim.y, aim.z)
      : (this.playerRef?.getPosition ? this.playerRef.getPosition() : null);
    if (!aimAt) return;

    const dir = aimAt.clone().sub(origin);
    if (dir.lengthSq() <= 1e-8) return;
    dir.normalize();

    const spread = fire.spread ?? 0;
    if (Number.isFinite(spread) && spread > 0) {
      const up = new THREE.Vector3(0, 1, 0);
      const right = new THREE.Vector3().crossVectors(dir, up);
      if (right.lengthSq() > 1e-8) {
        right.normalize();
        const trueUp = new THREE.Vector3().crossVectors(right, dir).normalize();
        dir.addScaledVector(right, (Math.random() - 0.5) * 2 * spread);
        dir.addScaledVector(trueUp, (Math.random() - 0.5) * 2 * spread);
        dir.normalize();
      }
    }

    origin.addScaledVector(dir, 0.65);

    this.projectileManager.spawnMonsterProjectile(origin, dir, {
      kind: fire.kind,
      speed: fire.speed,
      lifetime: fire.lifetime,
      damage: fire.damage,
      color: fire.color,
      sourceMonster: monster
    });
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
   * Called when a projectile hits a monster.
   * @param {Monster} monster
   * @param {THREE.Vector3} hitPosition
   * @param {Object|null} projectile
   */
  handleProjectileHit(monster, hitPosition = null, projectile = null) {
    this.damage?.handleProjectileHit?.(monster, hitPosition, projectile);
  }

  getMonsterHitStunSeconds(monster, projectile = null) {
    return this.damage?.getMonsterHitStunSeconds?.(monster, projectile) ?? 0;
  }

  ensureMonsterHealth(monster) {
    this.damage?.ensureMonsterHealth?.(monster);
  }

  applyDamageToMonster(monster, damage, options = {}) {
    this.damage?.applyDamageToMonster?.(monster, damage, options);
  }

  applyAreaDamage(centerPos, radius, damage, options = {}) {
    this.damage?.applyAreaDamage?.(centerPos, radius, damage, options);
  }

  killMonster(monster, hitPosition = null) {
    this.damage?.killMonster?.(monster, hitPosition);
  }

  async spawnAtGrid(spawnPosition, typeConfig = null) {
    return this.spawner?.spawnAtGrid?.(spawnPosition, typeConfig);
  }

  beginMonsterDeath(monster, hitPosition = null) {
    this.damage?.beginMonsterDeath?.(monster, hitPosition);
  }

  updatePendingDeaths(dt) {
    this.damage?.updatePendingDeaths?.(dt);
  }

  createFragmentEffect(monster, hitPosition = null) {
    this.damage?.createFragmentEffect?.(monster, hitPosition);
  }

  updateDeathEffects(dt) {
    this.damage?.updateDeathEffects?.(dt);
  }

  updateRespawns(dt) {
    this.spawner?.updateRespawns?.(dt);
  }

  async spawnReplacement(typeConfig) {
    return this.spawner?.spawnReplacement?.(typeConfig);
  }

  pickRespawnPoint() {
    return this.spawner?.pickRespawnPoint?.() || null;
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
   * @returns {{hit: boolean, monster: Monster|null, damage: number}}
   */
  getMonsterContactDamage(monster) {
    const damage = monster?.typeConfig?.combat?.contactDamage;
    if (Number.isFinite(damage)) return damage;
    return 10;
  }

  checkPlayerCaught(playerPosition, catchDistance = 1) {
    let nearest = null;
    let nearestDistSq = Infinity;
    let nearestDamage = 0;
    const maxDistSq = Math.max(0, catchDistance) * Math.max(0, catchDistance);

    for (const monster of this.monsters) {
      const pos = monster?.model?.position || monster?.position || null;
      if (!pos || !playerPosition) continue;
      const dx = pos.x - playerPosition.x;
      const dz = pos.z - playerPosition.z;
      const distSq = dx * dx + dz * dz;
      const damage = this.getMonsterContactDamage(monster);
      if (damage <= 0) continue;
      if (distSq < maxDistSq && distSq < nearestDistSq) {
        nearest = monster;
        nearestDistSq = distSq;
        nearestDamage = damage;
      }
    }

    return {
      hit: !!nearest,
      monster: nearest,
      damage: nearest ? nearestDamage : 0
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
    this.damage?.clear?.();
    this.spawner?.clear?.();
    this.modelSelector?.clear?.();
    this.perception?.clear?.();
    this.squadCoordinator?.clear?.();
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
        const newModel = this.modelLoader.cloneModel(model);

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
