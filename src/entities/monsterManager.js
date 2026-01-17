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
import { EVENTS } from '../core/events.js';
import { canOccupyCircle } from '../world/collision.js';

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
    this.perception = new MonsterPerception({ worldState });
    this.spawner = new MonsterSpawner(this, this.modelSelector);
    this.damage = new MonsterDamage(this);

    this.levelConfig = null;
    this.enemyCatalog = new EnemyCatalog();
    this.projectileManager = null;
    this.squadCoordinator = new SquadCoordinator();
    this.audioManager = null;
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

  setWorldState(worldState) {
    this.worldState = worldState;
    this.pathfinder = new Pathfinding(worldState);
    this.perception?.setWorldState?.(worldState);
  }

  setProjectileManager(projectileManager) {
    this.projectileManager = projectileManager;
  }

  setEventBus(eventBus) {
    this.eventBus = eventBus;
  }

  setAudioManager(audioManager) {
    this.audioManager = audioManager || null;
  }

  setAutoRespawnEnabled(enabled) {
    this.spawner?.setAutoRespawnEnabled?.(enabled);
  }

  registerNoise(position, options = {}) {
    return this.perception?.registerNoise?.(position, options) ?? null;
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
    return this.perception?.pickAudibleNoise?.(monster, brain, this.pathfinder) ?? null;
  }

  registerScent(position, options = {}) {
    return this.perception?.registerScent?.(position, options) ?? null;
  }

  updateScent(dt) {
    this.perception?.updateScent?.(dt);
  }

  getMonsterSmellRange(monster, brain) {
    return this.perception?.getMonsterSmellRange?.(monster, brain) ?? 0;
  }

  pickSmelledScent(monster, brain) {
    return this.perception?.pickSmelledScent?.(monster, brain) ?? null;
  }

  updatePlayerNoise(dt, playerPos) {
    const sprinting = this.playerRef?.isSprinting
      ? this.playerRef.isSprinting()
      : (this.playerRef?.input?.isSprinting?.() ?? false);

    const inSmoke = this.isPositionInSmoke?.(playerPos) ?? false;
    const radiusMult = inSmoke
      ? (Number.isFinite(CONFIG.AI_SMOKE_FOOTSTEP_NOISE_MULT) ? CONFIG.AI_SMOKE_FOOTSTEP_NOISE_MULT : 0.55)
      : 1.0;
    const strengthMult = inSmoke ? 0.8 : 1.0;

    const pm = this.playerRef?.getPerceptionModifiers?.();
    const pr = Number.isFinite(pm?.noiseRadiusMult) ? Math.max(0.1, pm.noiseRadiusMult) : 1.0;
    const ps = Number.isFinite(pm?.noiseStrengthMult) ? Math.max(0.1, pm.noiseStrengthMult) : 1.0;

    const entry = this.perception?.updatePlayerNoise?.(dt, playerPos, {
      sprinting,
      radiusMult: radiusMult * pr,
      strengthMult: strengthMult * ps
    }) ?? null;
    if (entry && this.eventBus?.emit) {
      this.eventBus.emit(EVENTS.NOISE_EMITTED, entry);
    }
  }

  updatePlayerScent(dt, playerPos) {
    const sprinting = this.playerRef?.isSprinting
      ? this.playerRef.isSprinting()
      : (this.playerRef?.input?.isSprinting?.() ?? false);

    const inSmoke = this.isPositionInSmoke?.(playerPos) ?? false;
    const radiusMult = inSmoke
      ? (Number.isFinite(CONFIG.AI_SMOKE_SCENT_RADIUS_MULT) ? CONFIG.AI_SMOKE_SCENT_RADIUS_MULT : 0.85)
      : 1.0;
    const strengthMult = inSmoke
      ? (Number.isFinite(CONFIG.AI_SMOKE_SCENT_STRENGTH_MULT) ? CONFIG.AI_SMOKE_SCENT_STRENGTH_MULT : 0.55)
      : 1.0;

    const pm = this.playerRef?.getPerceptionModifiers?.();
    const pr = Number.isFinite(pm?.scentRadiusMult) ? Math.max(0.1, pm.scentRadiusMult) : 1.0;
    const ps = Number.isFinite(pm?.scentStrengthMult) ? Math.max(0.1, pm.scentStrengthMult) : 1.0;

    return this.perception?.updatePlayerScent?.(dt, playerPos, {
      sprinting,
      radiusMult: radiusMult * pr,
      strengthMult: strengthMult * ps
    }) ?? null;
  }

  isPositionInSmoke(worldPos) {
    if (!worldPos) return false;
    const ws = this.worldState;
    const clouds = typeof ws?.getSmokeClouds === 'function'
      ? ws.getSmokeClouds()
      : (Array.isArray(ws?.smokeClouds) ? ws.smokeClouds : []);
    if (!Array.isArray(clouds) || clouds.length === 0) return false;

    const x = Number(worldPos.x) || 0;
    const z = Number(worldPos.z) || 0;
    for (const cloud of clouds) {
      if (!cloud) continue;
      const life = Number(cloud.life) || 0;
      if (!(life > 0)) continue;
      const radius = Number(cloud.radius) || 0;
      if (!(radius > 0)) continue;
      const cx = Number.isFinite(cloud.x) ? cloud.x : (Number.isFinite(cloud.position?.x) ? cloud.position.x : 0);
      const cz = Number.isFinite(cloud.z) ? cloud.z : (Number.isFinite(cloud.position?.z) ? cloud.position.z : 0);
      const dx = x - cx;
      const dz = z - cz;
      if (dx * dx + dz * dz <= radius * radius) return true;
    }
    return false;
  }

  applyCommanderAura() {
    const monsters = this.monsters || [];
    if (!monsters || monsters.length === 0) return;

    const commanders = [];
    for (const m of monsters) {
      if (!m || m.isDead || m.isDying) continue;
      const aura = m.typeConfig?.special?.commanderAura || null;
      if (!aura) continue;
      const radiusTiles = Math.max(1, Math.round(Number(aura.radiusTiles) || 8));
      const speedMult = Number.isFinite(aura.speedMult) ? Math.max(1.0, Math.min(2.0, aura.speedMult)) : 1.25;
      commanders.push({ monster: m, radiusTiles, speedMult });
    }
    if (commanders.length === 0) return;

    for (const m of monsters) {
      if (!m || m.isDead || m.isDying) continue;
      if (!Number.isFinite(m._baseSpeedMultiplier)) {
        m._baseSpeedMultiplier = Number.isFinite(m.speedMultiplier) ? m.speedMultiplier : 1.0;
      }
      let mult = 1.0;
      const gp = m.getGridPosition?.() || m.gridPos || null;
      if (gp) {
        for (const c of commanders) {
          const cg = c.monster?.getGridPosition?.() || c.monster?.gridPos || null;
          if (!cg) continue;
          const dist = Math.abs(gp.x - cg.x) + Math.abs(gp.y - cg.y);
          if (dist <= c.radiusTiles) {
            mult = Math.max(mult, c.speedMult);
          }
        }
      }
      m.speedMultiplier = (m._baseSpeedMultiplier || 1.0) * mult;
    }
  }

  applyFearAura(playerPos) {
    const monsters = this.monsters || [];
    if (!monsters || monsters.length === 0) return;
    if (!playerPos) return;

    const tileSize = CONFIG.TILE_SIZE || 1;
    const nowSec = this.playerRef?.gameState?.getElapsedTime?.() ?? 0;

    let bestIntensity = 0;
    for (const m of monsters) {
      if (!m || m.isDead || m.isDying) continue;
      const aura = m.typeConfig?.special?.fearAura || null;
      if (!aura) continue;
      const radiusTiles = Math.max(1, Math.round(Number(aura.radiusTiles) || 8));
      const maxIntensity = Number.isFinite(aura.maxIntensity) ? Math.max(0.1, Math.min(1.0, aura.maxIntensity)) : 0.85;

      const mp = m.getWorldPosition?.() || m.model?.position || m.position || null;
      if (!mp) continue;
      const dx = mp.x - playerPos.x;
      const dz = mp.z - playerPos.z;
      const distTiles = Math.hypot(dx, dz) / Math.max(0.01, tileSize);
      if (distTiles > radiusTiles) continue;
      const t = 1 - distTiles / radiusTiles;
      bestIntensity = Math.max(bestIntensity, Math.max(0, Math.min(1, t * maxIntensity)));
    }

    if (bestIntensity > 0) {
      this.playerRef?.setFearState?.({
        intensity: bestIntensity,
        untilSec: Math.round(nowSec + 1)
      });
    }
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
    const typePoolRaw = levelConfig?.monsters?.typePool;
    const typePool = Array.isArray(typePoolRaw)
      ? typePoolRaw.map((v) => String(v || '').trim()).filter(Boolean)
      : null;

    const weights =
      typeWeights ||
      (typePool && typePool.length > 0
        ? Object.fromEntries(typePool.map((key) => [key, 1]))
        : null);

    return this.initialize(requested, weights, levelConfig);
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
          const squadSize = Math.max(2, Math.round(CONFIG.AI_SQUAD_SIZE ?? 3));
          const squadIndex = Math.floor(i / squadSize);
          const roleIndex = i % squadSize;
          const roleCycle = ['leader', 'flanker', 'cover', 'rusher', 'support'];
          const role = roleCycle[Math.min(roleIndex, roleCycle.length - 1)] || 'leader';
          const squad = { squadId: `squad_${squadIndex}`, role };

          const modelPath = this.pickEnemyModelFromBag(enemyModelPool);

          if (modelPath) {
            console.log(`   🎲 Model: ${modelPath}`);
            const { model, animations } = await this.modelLoader.loadModelWithAnimations(modelPath);
            await this.spawnMonster(model, animations, spawnPosition, typeConfig, levelConfig, null, { modelPath, squad });
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
            await this.spawnMonster(spriteGroup, [], spawnPosition, typeConfig, levelConfig, spriteResult.updateAnimation, { squad });
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

    if (instanceTypeConfig && options?.squad && typeof options.squad === 'object') {
      const squadId = String(options.squad.squadId || '').trim();
      const role = String(options.squad.role || '').trim();
      if (squadId && role) {
        instanceTypeConfig.squad = { squadId, role };
      }
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

    this.applyPatrolRouteToMonster(monster, spawnPosition, instanceTypeConfig || typeConfig || {});
    this.applyEliteTraitsToMonster(monster, levelConfig, options?.elite || null);

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

  applyPatrolRouteToMonster(monster, spawnGrid, typeConfig) {
    if (!monster || !spawnGrid || !this.worldState) return;
    if (Array.isArray(monster.patrolRoute) && monster.patrolRoute.length >= 2) return;

    const ws = this.worldState;
    const origin = { x: spawnGrid.x, y: spawnGrid.y };
    const roomTypesPref = Array.isArray(typeConfig?.behavior?.patrolRoomTypes) ? typeConfig.behavior.patrolRoomTypes : null;
    const roomTypeAt = ws.getRoomType ? ws.getRoomType(origin.x, origin.y) : null;
    const preferRooms = roomTypeAt !== null ? (roomTypeAt !== 0) : true;

    const maxWaypoints = Math.max(3, Math.min(8, Math.round(typeConfig?.behavior?.patrolWaypoints ?? 5)));
    const radius = Math.max(4, Math.min(18, Math.round(typeConfig?.behavior?.patrolRadius ?? (typeConfig?.behavior?.searchRadius ? typeConfig.behavior.searchRadius * 2 : 10))));

    const isOk = (t) => {
      if (!t) return false;
      if (!Number.isFinite(t.x) || !Number.isFinite(t.y)) return false;
      if (!ws.isWalkableWithMargin?.(t.x, t.y, 1)) return false;
      if (roomTypesPref && ws.getRoomType) {
        const rt = ws.getRoomType(t.x, t.y);
        if (!roomTypesPref.includes(rt)) return false;
      }
      return true;
    };

    const pickCandidate = () => {
      for (let i = 0; i < 60; i++) {
        const base = ws.findRandomWalkableTile?.();
        if (!base) continue;
        const dx = base.x - origin.x;
        const dy = base.y - origin.y;
        const dist = Math.abs(dx) + Math.abs(dy);
        if (dist > radius) continue;
        if (!isOk(base)) continue;
        if (preferRooms && ws.getRoomType && ws.getRoomType(base.x, base.y) === 0) continue;
        return base;
      }
      for (let i = 0; i < 60; i++) {
        const base = ws.findRandomWalkableTile?.();
        if (!base) continue;
        const dx = base.x - origin.x;
        const dy = base.y - origin.y;
        const dist = Math.abs(dx) + Math.abs(dy);
        if (dist > radius) continue;
        if (!isOk(base)) continue;
        return base;
      }
      return null;
    };

    const route = [];
    if (isOk(origin)) route.push({ x: origin.x, y: origin.y });

    // Guard against an infinite loop when candidates repeatedly fail constraints (e.g. tiny rooms/radius).
    // This can otherwise hard-freeze the game during monster spawn.
    const maxAttempts = Math.max(120, maxWaypoints * 80);
    let attempts = 0;
    while (route.length < maxWaypoints && attempts < maxAttempts) {
      attempts++;
      const cand = pickCandidate();
      if (!cand) break;
      const tooClose = route.some((p) => (Math.abs(p.x - cand.x) + Math.abs(p.y - cand.y)) < 3);
      if (tooClose) continue;
      route.push({ x: cand.x, y: cand.y });
    }

    if (attempts >= maxAttempts && route.length < maxWaypoints) {
      console.warn('⚠️ Patrol route generation capped; using partial route', {
        monster: monster?.type || monster?.name || 'unknown',
        origin,
        got: route.length,
        wanted: maxWaypoints,
        radius
      });
    }

    if (route.length < 2) return;

    monster.patrolRoute = route;
    monster.patrolIndex = 0;
  }

  applyEliteTraitsToMonster(monster, levelConfig, eliteHint = null) {
    if (!monster || monster.isDead || monster.isDying) return;

    const difficulty = Number(levelConfig?.monsters?.difficulty) || Number(CONFIG.AI_DIFFICULTY) || 1.0;
    const baseChance = Number.isFinite(CONFIG.MONSTER_ELITE_CHANCE) ? CONFIG.MONSTER_ELITE_CHANCE : 0.08;
    const chance = Math.max(0, Math.min(0.35, baseChance + Math.max(0, difficulty - 1) * 0.02));

    const isElite = eliteHint === true ? true : (eliteHint === false ? false : (Math.random() < chance));
    if (!isElite) return;

    const traits = [
      { id: 'shielded', weakness: 'pierce', hpMult: 1.7, speedMult: 1.08, guardChanceMult: 1.6 },
      { id: 'berserker', weakness: 'explosive', hpMult: 1.55, speedMult: 1.18, guardChanceMult: 1.1 },
    ];
    const picked = traits[Math.floor(Math.random() * traits.length)] || traits[0];

    monster.isElite = true;
    monster.elite = {
      id: picked.id,
      weakness: picked.weakness,
      hpMult: picked.hpMult,
      speedMult: picked.speedMult,
      guardChanceMult: picked.guardChanceMult
    };

    const maxBefore = Math.max(1, Math.round(Number(monster.maxHealth) || 1));
    const hpBefore = Math.max(0, Math.round(Number(monster.health) || maxBefore));
    monster.maxHealth = Math.max(1, Math.round(maxBefore * picked.hpMult));
    // Preserve current % health when scaling.
    const ratio = maxBefore > 0 ? (hpBefore / maxBefore) : 1.0;
    monster.health = Math.max(1, Math.round(monster.maxHealth * Math.max(0.05, Math.min(1, ratio))));

    monster.baseSpeed = (monster.baseSpeed || monster.speed || 0) * picked.speedMult;
    monster.speed = monster.baseSpeed;

    // Visual hint: stronger emissive on elite
    const eliteColor = picked.id === 'shielded' ? 0x88ffcc : 0xff6688;
    const root = monster.getModel?.() || monster.model || null;
    if (root?.traverse) {
      root.traverse((child) => {
        if (!child?.isMesh) return;
        const mat = child.material;
        const applyMat = (m) => {
          if (!m) return;
          if ('emissive' in m && m.emissive) m.emissive.setHex(eliteColor);
          if ('emissiveIntensity' in m) m.emissiveIntensity = Math.max(Number(m.emissiveIntensity) || 0, 0.35);
        };
        if (Array.isArray(mat)) mat.forEach(applyMat);
        else applyMat(mat);
      });
    }
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

        let searchDurationSeconds =
          behavior.searchDuration ?
            (behavior.searchDuration / 1000) :
            undefined;
        if (Number.isFinite(searchDurationSeconds)) {
          searchDurationSeconds *= memoryMult;
        }

        return applyOverrides(applySquadRoleDefaults({
          ...baseConfig,
          chaseRange: behavior.chaseRange ?? defaultChaseRange,
          maxChaseDuration: behavior.maxChaseDuration ?? chaseTimeout,
          searchRadius: behavior.searchRadius,
          searchDurationSeconds
        }));
      }

      case 'roomHunter':
      case 'hunter': {
        const inferredHomeRadius = Number.isFinite(behavior.searchRadius)
          ? Math.max(4, Math.round(behavior.searchRadius * 2))
          : undefined;

        let chaseCooldownSeconds =
          behavior.chaseCooldown ?
            (behavior.chaseCooldown / 1000) :
            undefined;
        if (Number.isFinite(chaseCooldownSeconds)) {
          chaseCooldownSeconds *= memoryMult;
        }

        let searchDurationSeconds =
          behavior.searchDuration ?
            (behavior.searchDuration / 1000) :
            undefined;
        if (Number.isFinite(searchDurationSeconds)) {
          searchDurationSeconds *= memoryMult;
        }

        return applyOverrides(applySquadRoleDefaults({
          ...baseConfig,
          homeRadius: behavior.homeRadius ?? inferredHomeRadius,
          chaseTimeout,
          chaseCooldownSeconds,
          searchRadius: behavior.searchRadius,
          searchDurationSeconds,
          interceptEnabled: behavior.interceptEnabled
        }));
      }

      case 'distanceStalker': {
        let memoryDuration = behavior.memoryDuration ? behavior.memoryDuration / 1000 : chaseTimeout;
        if (behavior.memoryDuration && Number.isFinite(memoryDuration)) {
          memoryDuration *= memoryMult;
        }

        let searchDurationSeconds =
          behavior.searchDuration ?
            (behavior.searchDuration / 1000) :
            undefined;
        if (Number.isFinite(searchDurationSeconds)) {
          searchDurationSeconds *= memoryMult;
        }

        return applyOverrides(applySquadRoleDefaults({
          ...baseConfig,
          followDistance: behavior.followDistance,
          memoryDuration,
          followWhenPlayerSprints: behavior.followWhenPlayerSprints ?? true,
          followWhenHasLineOfSight: behavior.followWhenHasLineOfSight ?? true,
          searchRadius: behavior.searchRadius,
          searchDurationSeconds
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
    let move = allowSteering ? this.applySteering(monster, desiredMove) : desiredMove;

    // If flashed (blinded), back off instead of face-tanking at point-blank.
    if ((monster?.perceptionBlindedTimer || 0) > 0) {
      const playerPos = this.playerRef?.position || (this.playerRef?.getPosition ? this.playerRef.getPosition() : null);
      const selfPos = monster?.getWorldPosition?.() || monster?.position || null;
      if (playerPos && selfPos) {
        const tileSize = CONFIG.TILE_SIZE || 1;
        const distTiles = Math.hypot((playerPos.x - selfPos.x) / tileSize, (playerPos.z - selfPos.z) / tileSize);
        const retreatDist = Number(CONFIG.AI_BLIND_RETREAT_DISTANCE_TILES) || 2;
        if (distTiles <= retreatDist) {
          const vx = playerPos.x - selfPos.x;
          const vz = playerPos.z - selfPos.z;
          const len = Math.hypot(vx, vz) || 1;
          const toPlayerX = vx / len;
          const toPlayerZ = vz / len;
          const dot = (Number(move?.x) || 0) * toPlayerX + (Number(move?.y) || 0) * toPlayerZ;
          if (dot > 0.15) {
            const m = Number(CONFIG.AI_BLIND_RETREAT_MOVE_MULT);
            const mult = Number.isFinite(m) ? Math.max(0.2, Math.min(1.2, m)) : 0.9;
            move = { x: -toPlayerX * mult, y: -toPlayerZ * mult };
          }
          // Force a short guard window while blind up close.
          if ((monster.guardTimer || 0) <= 0) {
            monster.guardTimer = Math.max(monster.guardTimer || 0, 0.55);
            monster.guardCooldown = Math.max(monster.guardCooldown || 0, 1.2);
          }
        }
      }
    }

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

      // Sweep via step subdivision to reduce corner tunneling when dt spikes.
      const tileSize = CONFIG.TILE_SIZE || 1;
      const radius = (CONFIG.PLAYER_RADIUS || 0.35) * 0.9;
      const maxStep = Math.max(0.05, Math.min(tileSize * 0.25, radius * 0.5));
      const dist = Math.hypot(dx, dz);
      const steps = Math.max(1, Math.ceil(dist / maxStep));
      const stepX = dx / steps;
      const stepZ = dz / steps;

      let pos = current.clone();
      for (let i = 0; i < steps; i++) {
        const delta = new THREE.Vector3(stepX, 0, stepZ);
        const targetPos = pos.clone().add(delta);
        const movedStep = this.tryMoveMonster(monster, pos, targetPos, delta);
        if (!movedStep) break;
        moved = true;
        const after = monster.getWorldPosition?.() || null;
        pos = after ? after.clone() : targetPos;
      }
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
    const pos = monster?.model?.position || monster?.position || null;
    if (!pos) return move;

    const avoidRadius = 1.2 * (CONFIG.TILE_SIZE || 1);
    let avoidX = 0;
    let avoidZ = 0;
    let count = 0;
    let doorYield = 1.0;

    // Doorway yield: if on a door and another monster is closer to center, slow down a bit
    const tileSize = CONFIG.TILE_SIZE || 1;
    const gx = Math.floor(pos.x / tileSize);
    const gy = Math.floor(pos.z / tileSize);
    const onDoor = this.worldState?.getTile && this.worldState.getTile(gx, gy) === 2;
    const doorCx = (gx + 0.5) * tileSize;
    const doorCz = (gy + 0.5) * tileSize;

    for (const other of this.monsters) {
      if (other === monster) continue;
      const op = other?.model?.position || other?.position || null;
      if (!op) continue;
      const dx = pos.x - op.x;
      const dz = pos.z - op.z;
      const dist = Math.hypot(dx, dz);
      if (dist > avoidRadius || dist <= 0.001) continue;
      const t = (avoidRadius - dist) / avoidRadius;
      avoidX += (dx / dist) * t;
      avoidZ += (dz / dist) * t;
      count++;

      if (onDoor) {
        const otherDistToDoorCenter = Math.hypot(op.x - doorCx, op.z - doorCz);
        const selfDist = Math.hypot(pos.x - doorCx, pos.z - doorCz);
        if (otherDistToDoorCenter < selfDist) {
          doorYield = 0.55; // slow down to let the other pass
        }
      }
    }

    // Avoid player only at close range to reduce overlap jitter while chasing.
    let playerAvoidX = 0;
    let playerAvoidZ = 0;
    const playerPos = this.playerRef?.position || (this.playerRef?.getPosition ? this.playerRef.getPosition() : null);
    if (playerPos) {
      const dx = pos.x - playerPos.x;
      const dz = pos.z - playerPos.z;
      const dist = Math.hypot(dx, dz);
      const playerAvoidRadius = Math.min(avoidRadius, Math.max((CONFIG.PLAYER_RADIUS || 0.35) * 2.0, tileSize * 0.55));
      if (dist > 0.001 && dist < playerAvoidRadius) {
        const t = (playerAvoidRadius - dist) / playerAvoidRadius;
        const inv = 1 / dist;
        playerAvoidX = dx * inv * t;
        playerAvoidZ = dz * inv * t;
      }
    }

    const hasAvoid = count > 0 || (playerAvoidX !== 0 || playerAvoidZ !== 0);
    if (count > 0) {
      avoidX /= count;
      avoidZ /= count;
    }

    if (hasAvoid) {
      const desiredX = move.x + avoidX * 0.6 + playerAvoidX * 0.45;
      const desiredZ = move.y + avoidZ * 0.6 + playerAvoidZ * 0.45;
      const len = Math.hypot(desiredX, desiredZ) || 1;
      return { x: (desiredX / len) * doorYield, y: (desiredZ / len) * doorYield };
    }

    return { x: move.x * doorYield, y: move.y * doorYield };
  }

  tryMoveMonster(monster, currentPos, targetPos, deltaVec) {
    // Prevent monsters from "pushing" the player: treat the player as a solid obstacle.
    // If a monster is already overlapping (edge cases), allow steps that increase separation so it can escape.
    const playerPos = this.playerRef?.position || null;
    const playerHidden = this.playerRef
      ? (typeof this.playerRef.isHidden === 'function' ? this.playerRef.isHidden() : !!this.playerRef.hidden)
      : false;

    const tileSize = CONFIG.TILE_SIZE || 1;
    const playerRadius = CONFIG.PLAYER_RADIUS || 0.35;
    const monsterRadius = (CONFIG.PLAYER_RADIUS || 0.35) * 0.9;
    const minPlayerDist = Math.max(tileSize * 0.65, playerRadius + monsterRadius + 0.02);
    const minPlayerDistSq = minPlayerDist * minPlayerDist;

    const canStepTo = (fromPos, toPos) => {
      if (!toPos) return false;
      if (playerPos && !playerHidden) {
        const fx = (fromPos?.x || 0) - playerPos.x;
        const fz = (fromPos?.z || 0) - playerPos.z;
        const tx = (toPos.x || 0) - playerPos.x;
        const tz = (toPos.z || 0) - playerPos.z;
        const fromSq = fx * fx + fz * fz;
        const toSq = tx * tx + tz * tz;
        if (!Number.isFinite(fromSq) || !Number.isFinite(toSq)) return false;
        if (toSq < minPlayerDistSq) {
          // Allow only if we were already overlapping and are moving away.
          if (!(fromSq < minPlayerDistSq && toSq > fromSq + 1e-6)) return false;
        }
      }
      return this.canMonsterMoveTo(toPos.x, toPos.z);
    };

    if (canStepTo(currentPos, targetPos)) {
      monster.setWorldPosition(targetPos);
      return true;
    }

    let moved = false;
    let basePos = currentPos;
    if (Math.abs(deltaVec.x) > Math.abs(deltaVec.z)) {
      const posX = basePos.clone().add(new THREE.Vector3(deltaVec.x, 0, 0));
      if (canStepTo(basePos, posX)) {
        monster.setWorldPosition(posX);
        moved = true;
        basePos = monster?.model?.position || monster?.position || posX;
      }
      const posZ = basePos.clone().add(new THREE.Vector3(0, 0, deltaVec.z));
      if (canStepTo(basePos, posZ)) {
        monster.setWorldPosition(posZ);
        moved = true;
      }
    } else {
      const posZ = basePos.clone().add(new THREE.Vector3(0, 0, deltaVec.z));
      if (canStepTo(basePos, posZ)) {
        monster.setWorldPosition(posZ);
        moved = true;
        basePos = monster?.model?.position || monster?.position || posZ;
      }
      const posX = basePos.clone().add(new THREE.Vector3(deltaVec.x, 0, 0));
      if (canStepTo(basePos, posX)) {
        monster.setWorldPosition(posX);
        moved = true;
      }
    }
    return moved;
  }

  canMonsterMoveTo(worldX, worldZ) {
    if (!this.worldState?.isWalkable) return true;
    const tileSize = CONFIG.TILE_SIZE || 1;
    const radius = (CONFIG.PLAYER_RADIUS || 0.35) * 0.9;
    return canOccupyCircle(this.worldState, worldX, worldZ, radius, tileSize);
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
    this.updateScent(dt);

    const playerPos =
      playerPosition && playerPosition.isVector3 ? playerPosition :
      this.playerRef?.getPosition ? this.playerRef.getPosition() :
      null;
    const playerGrid = this.playerRef?.getAIPerceivedGridPosition
      ? this.playerRef.getAIPerceivedGridPosition()
      : (this.playerRef?.getGridPosition ? this.playerRef.getGridPosition() : null);

    if (playerPos) {
      this.updatePlayerNoise(dt, playerPos);
      this.updatePlayerScent(dt, playerPos);
    }

    // Special archetypes (Commander aura, fear/pressure).
    this.applyCommanderAura();
    if (playerPos) this.applyFearAura(playerPos);

	    const tileSize = CONFIG.TILE_SIZE || 1;
	    const farDistanceTiles = CONFIG.MONSTER_AI_FAR_DISTANCE_TILES ?? 12;
	    const farDistanceWorld = Math.max(0, farDistanceTiles) * tileSize;
	    const farDistanceSq = farDistanceWorld * farDistanceWorld;
	    const farTickSeconds = Math.max(0.05, CONFIG.MONSTER_AI_FAR_TICK_SECONDS ?? 0.35);
	    const cullTiles = CONFIG.MONSTER_RENDER_CULL_DISTANCE_TILES ?? 0;
	    const cullWorld = Number.isFinite(cullTiles) && cullTiles > 0 ? cullTiles * tileSize : 0;
	    const cullSq = cullWorld > 0 ? cullWorld * cullWorld : 0;

    // Fairness: optionally limit how many monsters may actively "chase" at once.
    const maxChasers = Number(CONFIG.AI_MAX_CHASERS);
    if (playerGrid && Number.isFinite(maxChasers) && maxChasers > 0) {
      const candidates = [];
      for (const m of this.monsters) {
        if (!m || m.isDead || m.isDying) continue;
        const brain = this.brains.get(m) || null;
        const state = brain?.state ?? brain?.mode ?? null;
        const canSee = this.canMonsterSeePlayer(m, playerGrid);
        const mg = m.getGridPosition?.() || m.gridPos || null;
        const dist = mg ? (Math.abs(mg.x - playerGrid.x) + Math.abs(mg.y - playerGrid.y)) : Infinity;
        const score = (state === 'chase' ? 2000 : 0) + (canSee ? 1000 : 0) - (Number.isFinite(dist) ? dist : 999);
        candidates.push({ monster: m, score });
      }
      candidates.sort((a, b) => b.score - a.score);
      const allowed = new Set(candidates.slice(0, Math.max(1, Math.round(maxChasers))).map((c) => c.monster));
      for (const m of this.monsters) {
        if (!m) continue;
        m.aiChaseSuppressed = !allowed.has(m);
      }
    } else {
      for (const m of this.monsters) {
        if (!m) continue;
        m.aiChaseSuppressed = false;
      }
    }

    if (CONFIG.DEBUG_NAV_HEATMAP_ENABLED !== false && this.worldState?.recordNavHeat) {
      for (const m of this.monsters) {
        if (!m || m.isDead || m.isDying) continue;
        const g = m.getGridPosition?.() || m.gridPos || null;
        if (g) this.worldState.recordNavHeat(g, 1);
      }
      if (playerGrid) this.worldState.recordNavHeat(playerGrid, 0.35);
    }

    for (const monster of this.monsters) {
      if (monster?.isDead) continue;
      if (monster?.isDying) {
        if (monster.updateAnimation) {
          monster.updateAnimation(dt);
        }
        continue;
      }
      if ((monster.guardTimer || 0) > 0) {
        monster.guardTimer = Math.max(0, (monster.guardTimer || 0) - dt);
      }
      if ((monster.guardCooldown || 0) > 0) {
        monster.guardCooldown = Math.max(0, (monster.guardCooldown || 0) - dt);
      }
      if ((monster.perceptionJammedTimer || 0) > 0) {
        monster.perceptionJammedTimer = Math.max(0, (monster.perceptionJammedTimer || 0) - dt);
      }
      if ((monster.perceptionBlindedTimer || 0) > 0) {
        monster.perceptionBlindedTimer = Math.max(0, (monster.perceptionBlindedTimer || 0) - dt);
      }
      if ((monster.corrosionTimer || 0) > 0) {
        monster.corrosionTimer = Math.max(0, (monster.corrosionTimer || 0) - dt);
      }
      if ((monster.burnTimer || 0) > 0) {
        monster.burnTimer = Math.max(0, (monster.burnTimer || 0) - dt);
        monster.burnTick = (monster.burnTick || 0) + dt;
        if ((monster.burnTick || 0) >= 0.95) {
          const ticks = Math.floor((monster.burnTick || 0) / 0.95);
          monster.burnTick = (monster.burnTick || 0) - ticks * 0.95;
          const dps = Number(monster.burnDps) || 0;
          const dmg = Math.round(Math.max(0, dps) * ticks);
          if (dmg > 0) {
            this.damage?.applyDamageToMonster?.(monster, dmg, { cause: 'burn', isDot: true });
          }
        }
        if ((monster.burnTimer || 0) <= 0) {
          monster.burnDps = 0;
          monster.burnTick = 0;
        }
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
	      const isCulled = cullSq > 0 && playerPos && posRef ? distSq > cullSq : false;
	      if (monster?.model) {
	        monster.model.visible = !isCulled;
	      }

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
      let tickDt = dt;

      if (shouldTick) {
        // Keep grid in sync with any external changes before AI reads it.
        if (monster.syncGridFromWorld) {
          monster.syncGridFromWorld();
        }

        tickDt = isFar ? (monster.aiTickAccumulator || dt) : dt;
        monster.aiTickAccumulator = 0;

        const heard = this.pickAudibleNoise(monster, brain);
        if (heard && typeof brain.hearNoise === 'function') {
          brain.hearNoise(heard);
        }

        const smelled = this.pickSmelledScent(monster, brain);
        if (smelled && typeof brain.smellScent === 'function') {
          brain.smellScent(smelled);
        }

        if (playerPos && playerGrid) {
          this.maybeBroadcastAlert(monster, playerPos, playerGrid, tickDt);
        }

        let rawCommand = null;
        try {
          rawCommand = brain.tick(tickDt) || null;
        } catch (err) {
          console.warn('⚠️ Monster brain tick failed:', err?.message || err);
          rawCommand = null;
        }
        if (!rawCommand || typeof rawCommand !== 'object') {
          rawCommand = { move: { x: 0, y: 0 }, lookYaw: 0, sprint: false };
        }

        try {
          command = typeof brain.decorateCommand === 'function'
            ? brain.decorateCommand(rawCommand, tickDt)
            : rawCommand;
        } catch (err) {
          console.warn('⚠️ Monster brain decorateCommand failed:', err?.message || err);
          command = rawCommand;
        }

        // Sanitize command to prevent NaNs / oversized vectors from breaking movement.
        const mv = command?.move || {};
        let mx = Number(mv.x);
        let my = Number(mv.y);
        if (!Number.isFinite(mx)) mx = 0;
        if (!Number.isFinite(my)) my = 0;
        const len = Math.hypot(mx, my);
        if (len > 1e-6 && len > 1.25) {
          mx /= len;
          my /= len;
        }
        const lookYaw = Number(command?.lookYaw);
        command = {
          ...command,
          move: { x: mx, y: my },
          lookYaw: Number.isFinite(lookYaw) ? lookYaw : 0,
          sprint: !!command?.sprint
        };

        monster.lastBrainCommand = command;
      }

      command = command || { move: { x: 0, y: 0 }, lookYaw: 0, sprint: false };
      // Always apply movement each frame for smooth motion; only throttle *AI thinking* when far.
      // (Previously far monsters only moved when shouldTick, causing visible "jumping".)
      const moveDt = dt;
      if (moveDt > 0) {
        try {
          this.applyBrainCommand(monster, command, moveDt, {
            allowSteering: !isFar,
            allowLook: shouldTick
          });
        } catch (err) {
          console.warn('⚠️ Monster movement failed:', err?.message || err);
          monster.isMoving = false;
          monster.isSprinting = false;
        }
      } else {
        monster.isMoving = false;
        monster.isSprinting = false;
      }

	      if (monster.updateAnimation && !isCulled) {
	        if (!isFar || shouldTick) {
	          monster.updateAnimation(dt);
	        }
	      }

	      if (shouldTick && command?.fire && !isFar) {
	        this.fireMonsterProjectile(monster, command.fire);
	      }
	    }
	  }

  fireMonsterProjectile(monster, fire) {
    if (!monster || monster.isDead || monster.isDying) return;
    if (!fire) return;
    if (!this.projectileManager?.spawnMonsterProjectile) return;
    if (this.projectileManager?.canSpawnProjectile && !this.projectileManager.canSpawnProjectile('monster')) return;

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

    if (fire?.blindFire) {
      this.eventBus?.emit?.(EVENTS.NOISE_REQUESTED, {
        kind: 'blind_fire',
        position: origin.clone(),
        radius: Math.max(6, Number(CONFIG.AI_BLIND_FIRE_NOISE_RADIUS) || 14),
        ttl: 0.9,
        strength: 0.9,
        source: monster
      });
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
   * Debug helper: return a lightweight snapshot of monster AI state.
   * Intended for console inspection (debug pages / main game).
   */
  getAIDebugSnapshot() {
    return this.getAIDebugSnapshotFiltered();
  }

  getAIDebugSnapshotFiltered(options = {}) {
    const out = [];
    const picks = this._pickAIDebugMonsters(options);
    for (const { monster, brain } of picks) {
      if (!monster) continue;
      out.push({
        id: monster.id,
        type: monster.type || monster.typeConfig?.id || monster.typeConfig?.name || null,
        grid: monster.getGridPosition?.() || monster.gridPos || null,
        state: brain?.state ?? brain?.mode ?? null,
        targetType: brain?.targetType ?? null,
        currentTarget: brain?.currentTarget ?? null,
        pathLen: Array.isArray(brain?.currentPath) ? brain.currentPath.length : null,
        lastKnown: brain?.lastKnownPlayerGrid ?? null,
        lastSeenSecAgo: Number.isFinite(brain?.lastSeenPlayerTime) ? Math.max(0, (brain.now?.() ?? performance.now() / 1000) - brain.lastSeenPlayerTime) : null,
        lastNoise: brain?.lastHeardNoise?.grid ? { kind: brain.lastHeardNoise.kind, grid: brain.lastHeardNoise.grid } : null,
        lastScent: brain?.lastSmelledScent?.grid ? { kind: brain.lastSmelledScent.kind, grid: brain.lastSmelledScent.grid } : null,
        confidence: Number.isFinite(brain?.targetConfidence) ? brain.targetConfidence : null,
        squadRole: monster?.typeConfig?.squad?.role ?? null,
        squadId: monster?.typeConfig?.squad?.squadId ?? null
      });
    }
    return out;
  }

  /**
   * Debug helper: markers for minimap overlay (targets / last-known / noises).
   * @returns {Array<{kind:string,x:number,y:number,color:string,monsterId:number|null}>}
   */
  getAIDebugMinimapMarkers(options = {}) {
    const markers = [];
    const picks = this._pickAIDebugMonsters(options);
    for (const { monster, brain } of picks) {
      const monsterId = Number.isFinite(monster.id) ? monster.id : null;

      const push = (kind, grid, color) => {
        if (!grid || !Number.isFinite(grid.x) || !Number.isFinite(grid.y)) return;
        markers.push({ kind, x: grid.x, y: grid.y, color, monsterId });
      };

      push('ai_target', brain?.currentTarget || null, 'rgba(0, 220, 255, 0.95)');
      push('ai_lastKnown', brain?.lastKnownPlayerGrid || null, 'rgba(255, 235, 59, 0.95)');
      push('ai_noise', brain?.lastHeardNoise?.grid || null, 'rgba(255, 112, 67, 0.95)');
      push('ai_scent', brain?.lastSmelledScent?.grid || null, 'rgba(156, 39, 176, 0.9)');
    }
    return markers;
  }

  /**
   * Debug helper: 3D debug primitives (paths/targets/last-known) for in-world rendering.
   * @returns {Array<{id:number|null,worldPos:any,target:any,lastKnown:any,lastNoise:any,path:any,state:any}>}
   */
  getAIDebug3DData(options = {}) {
    const out = [];
    const maxPts = Math.max(8, Math.round(Number(CONFIG.DEBUG_AI_3D_MAX_PATH_POINTS) || 64));
    const picks = this._pickAIDebugMonsters(options);
    for (const { monster, brain } of picks) {
      const pos = monster.getWorldPosition?.() || monster.position || null;
      out.push({
        id: Number.isFinite(monster.id) ? monster.id : null,
        worldPos: pos?.clone ? pos.clone() : pos,
        state: brain?.state ?? brain?.mode ?? null,
        target: brain?.currentTarget || null,
        lastKnown: brain?.lastKnownPlayerGrid || null,
        lastNoise: brain?.lastHeardNoise?.grid || null,
        path: Array.isArray(brain?.currentPath) ? brain.currentPath.slice(0, maxPts) : null
      });
    }
    return out;
  }

  _pickAIDebugMonsters(options = {}) {
    const onlyChasing = options.onlyChasing === true;
    const onlyLeader = options.onlyLeader === true;
    const nearestN = Math.max(0, Math.round(Number(options.nearestN) || 0));

    const playerGrid = this.playerRef?.getGridPosition?.() || null;
    const scored = [];
    for (const monster of this.monsters || []) {
      if (!monster || monster.isDead || monster.isDying) continue;
      const brain = this.brains.get(monster) || null;

      const role = monster?.typeConfig?.squad?.role ?? null;
      if (onlyLeader && role !== 'leader') continue;

      const state = String(brain?.state ?? brain?.mode ?? '');
      const isChasing = state === 'chase' || state.startsWith('chase');
      if (onlyChasing && !isChasing) continue;

      let dist = 0;
      if (playerGrid && monster.getGridPosition) {
        const mg = monster.getGridPosition();
        dist = Math.abs(mg.x - playerGrid.x) + Math.abs(mg.y - playerGrid.y);
      } else if (playerGrid && monster.gridPos) {
        dist = Math.abs(monster.gridPos.x - playerGrid.x) + Math.abs(monster.gridPos.y - playerGrid.y);
      }

      scored.push({ monster, brain, dist });
    }

    if (nearestN > 0 && scored.length > nearestN) {
      scored.sort((a, b) => a.dist - b.dist);
      return scored.slice(0, nearestN);
    }
    return scored;
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

  applyAreaBlindness(centerPos, radius, seconds, options = {}) {
    if (!centerPos) return;
    const r = Number.isFinite(radius) ? radius : 0;
    const baseSeconds = Number.isFinite(seconds) ? seconds : 0;
    if (r <= 0 || baseSeconds <= 0) return;

    const falloff = options?.falloff !== false;

    const center = centerPos.clone ? centerPos.clone() : new THREE.Vector3(centerPos.x || 0, centerPos.y || 0, centerPos.z || 0);
    center.y = 0;

    for (const monster of this.monsters) {
      if (!monster || monster.isDead || monster.isDying) continue;
      const pos = monster.getWorldPosition?.();
      if (!pos) continue;

      const dx = pos.x - center.x;
      const dz = pos.z - center.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > r) continue;

      let scaled = baseSeconds;
      if (falloff) {
        const t = 1 - dist / r;
        scaled = baseSeconds * (0.4 + 0.6 * Math.max(0, t));
      }

      monster.perceptionBlindedTimer = Math.max(monster.perceptionBlindedTimer || 0, scaled);
    }
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
