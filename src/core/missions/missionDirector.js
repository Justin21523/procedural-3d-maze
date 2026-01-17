import * as THREE from 'three';
import { EVENTS } from '../events.js';
import { CONFIG } from '../config.js';
import { normalizeMissionsConfig } from './missionTemplates.js';
import { pickDistinctTiles, gridToWorldCenter, manhattan } from './missionUtils.js';
import { Pathfinding } from '../../ai/pathfinding.js';
import {
  createKeycardObject,
  createEvidenceObject,
  createDeliveryItemObject,
  createPowerSwitchObject,
  setPowerSwitchState,
  createClueNoteObject,
  createKeypadObject,
  setKeypadState,
  createFuseObject,
  createFusePanelObject,
  setFusePanelState,
  createTerminalObject,
  setTerminalState,
  createLockedDoorObject,
  setLockedDoorState,
  createAltarObject,
  setAltarState,
  createPhotoTargetObject,
  createEscortBuddyObject,
  createSensorObject,
  setSensorState
} from './missionObjects.js';
import { ROOM_CONFIGS, ROOM_TYPES, TILE_TYPES } from '../../world/tileTypes.js';

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function normalizeRole(role) {
  return String(role || '').trim().toLowerCase();
}

function toSlotLabel(index) {
  const i = Number.isFinite(index) ? Math.max(0, Math.floor(index)) : 0;
  return String.fromCharCode(65 + (i % 26));
}

function toFinite(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function deepClone(obj) {
  return obj ? JSON.parse(JSON.stringify(obj)) : obj;
}

function normalizeRoomTypes(roomTypes) {
  if (!Array.isArray(roomTypes)) return null;
  const out = [];
  for (const t of roomTypes) {
    const n = Math.round(Number(t));
    if (!Number.isFinite(n)) continue;
    out.push(n);
  }
  return out.length > 0 ? out : null;
}

function formatRoomTypeList(roomTypes) {
  const list = normalizeRoomTypes(roomTypes) || [];
  if (list.length === 1) {
    const name = ROOM_CONFIGS?.[list[0]]?.name || 'Room';
    return name;
  }
  return 'target room';
}

function shuffleInPlace(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = list[i];
    list[i] = list[j];
    list[j] = tmp;
  }
  return list;
}

function pickDistinctRoomTiles(worldState, count, options = {}) {
  const ws = worldState;
  const desired = clamp(Math.round(count || 0), 0, 999);
  if (!ws?.getRooms || !ws?.isWalkableWithMargin || desired <= 0) return [];

  const allowedRoomTypes = Array.isArray(options.allowedRoomTypes) ? options.allowedRoomTypes : null;
  const allowedSet = allowedRoomTypes && allowedRoomTypes.length > 0 ? new Set(allowedRoomTypes) : null;
  const avoid = Array.isArray(options.minDistFrom) ? options.minDistFrom.filter(Boolean) : [];
  const minDist = Number.isFinite(options.minDist) ? options.minDist : 6;
  const margin = Number.isFinite(options.margin) ? options.margin : 1;

  const rooms = ws.getRooms().filter((r) => {
    if (!r || !Array.isArray(r.tiles) || r.tiles.length === 0) return false;
    if (allowedSet && !allowedSet.has(r.type)) return false;
    return true;
  });
  if (rooms.length === 0) return [];

  shuffleInPlace(rooms);

  const picked = [];
  for (const room of rooms) {
    if (picked.length >= desired) break;

    const tiles = Array.isArray(room.tiles) ? room.tiles.slice() : [];
    if (tiles.length === 0) continue;
    shuffleInPlace(tiles);

    let chosen = null;
    for (const t of tiles) {
      if (!t) continue;
      const x = Math.round(Number(t.x));
      const y = Math.round(Number(t.y));
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (!ws.isWalkableWithMargin(x, y, margin)) continue;

      let ok = true;
      for (const a of avoid) {
        if (manhattan({ x, y }, a) < minDist) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;

      chosen = { x, y, roomType: room.type };
      break;
    }

    if (chosen) picked.push(chosen);
  }

  return picked.slice(0, desired);
}

export class MissionDirector {
  constructor(options = {}) {
    this.eventBus = options.eventBus || null;
    this.worldState = options.worldState || null;
    this.monsterManager = options.monsterManager || null;
    this.scene = options.scene || null;
    this.gameState = options.gameState || null;
    this.exitPoint = options.exitPoint || null;
    this.interactables = options.interactableSystem || null;
    this.bossSystem = options.bossSystem || null;
    this.pathfinder = this.worldState ? new Pathfinding(this.worldState) : null;

    this.levelConfig = null;
    this.missionsConfig = null;

    this.missions = new Map(); // id -> mission
    this.interactableMeta = new Map(); // interactableId -> { missionId, template, index }
    this.registeredIds = [];
    this.spawnedObjects = [];

    // Content budget: cap mission interactables so content expansion doesn't tank FPS.
    this.objectBudgetMax = Number.isFinite(CONFIG.MISSION_OBJECT_BUDGET_MAX)
      ? Math.max(0, Math.round(CONFIG.MISSION_OBJECT_BUDGET_MAX))
      : 80;
    this.objectBudgetRemaining = Infinity;

    this.elapsedSec = 0;
    this.lastStatusKey = '';
    this.exitUnlocked = true;
    this.exitLockMessage = '';

    this.playerHidden = false;
    this.playerHiddenSpotId = null;

    this.hintTier = 0;
    this.hintObjectiveKey = '';

    this.completedMissionIds = new Set();
    this.failedMissionIds = new Set();

    this.unsubs = [];
  }

  setRefs({ eventBus, worldState, monsterManager, scene, gameState, exitPoint, interactableSystem, bossSystem } = {}) {
    if (eventBus) this.eventBus = eventBus;
    if (worldState) {
      this.worldState = worldState;
      this.pathfinder = new Pathfinding(worldState);
    }
    if (monsterManager) this.monsterManager = monsterManager;
    if (scene) this.scene = scene;
    if (gameState) this.gameState = gameState;
    if (exitPoint) this.exitPoint = exitPoint;
    if (interactableSystem) this.interactables = interactableSystem;
    if (bossSystem) this.bossSystem = bossSystem;
  }

  dispose() {
    this.clear();
  }

  clear() {
    this.unsubs.forEach((fn) => fn?.());
    this.unsubs = [];

    // Best-effort restore any temporary monster escalation changes.
    try {
      for (const mission of this.missions.values()) {
        if (!mission || mission.template !== 'timedEvac') continue;
        if (!mission.state?._boostApplied) continue;
        const mm = this.monsterManager;
        if (!mm) continue;

        const origMax = mission.state._origMaxCount;
        if (mm.levelConfig?.monsters && Number.isFinite(origMax)) {
          mm.levelConfig.monsters.maxCount = origMax;
        }
        const origDelay = mission.state._origRespawnDelay;
        if (Number.isFinite(origDelay) && mm.spawner?.setRespawnDelay) {
          mm.spawner.setRespawnDelay(origDelay);
        }
      }
    } catch {
      // ignore
    }

    if (this.interactables && this.registeredIds.length > 0) {
      for (const id of this.registeredIds) {
        this.interactables.unregister?.(id);
      }
    }
    this.registeredIds = [];
    this.interactableMeta.clear();

    if (this.scene && this.spawnedObjects.length > 0) {
      for (const obj of this.spawnedObjects) {
        try {
          this.scene.remove(obj);
        } catch {
          // ignore
        }
      }
    }
    this.spawnedObjects = [];

    this.missions.clear();
    this.levelConfig = null;
    this.missionsConfig = null;
    this.objectBudgetRemaining = Infinity;
    this.elapsedSec = 0;
    this.exitUnlocked = true;
    this.exitLockMessage = '';
    this.lastStatusKey = '';
    this.playerHidden = false;
    this.playerHiddenSpotId = null;
    this.hintTier = 0;
    this.hintObjectiveKey = '';
    this.completedMissionIds.clear();
    this.failedMissionIds.clear();
  }

  startLevel(levelConfig) {
    this.clear();

    this.levelConfig = levelConfig || null;
    this.missionsConfig = normalizeMissionsConfig(levelConfig);
    this.elapsedSec = 0;
    this.resetObjectBudget(levelConfig);

    this.spawnFromConfig(this.missionsConfig);
    this.bindEvents();
    this.syncStatus(true);
  }

  resetObjectBudget(levelConfig = null) {
    const levelMax = levelConfig?.budgets?.missionObjectsMax;
    const max = Number.isFinite(Number(levelMax))
      ? Math.max(0, Math.round(Number(levelMax)))
      : this.objectBudgetMax;
    this.objectBudgetRemaining = max > 0 ? max : Infinity;
  }

  canSpawnMissionObject(count = 1) {
    const n = Math.max(0, Math.round(Number(count) || 0));
    if (n <= 0) return true;
    if (!Number.isFinite(this.objectBudgetRemaining)) return true;
    return this.objectBudgetRemaining >= n;
  }

  consumeMissionObjectBudget(count = 1) {
    const n = Math.max(0, Math.round(Number(count) || 0));
    if (n <= 0) return;
    if (!Number.isFinite(this.objectBudgetRemaining)) return;
    this.objectBudgetRemaining = Math.max(0, this.objectBudgetRemaining - n);
  }

  failOpenMission(mission, reason = '') {
    const template = String(mission?.template || '').trim();
    const id = String(mission?.id || '').trim();
    const suffix = reason ? `: ${reason}` : '';
    console.warn(`⚠️ Mission fallback (${template || 'unknown'}/${id || '?'})${suffix}`);

    if (!mission?.state) mission.state = {};

    if (template === 'findKeycard') {
      mission.state.found = true;
      return;
    }

    if (template === 'collectEvidence') {
      mission.state.collected = 0;
      mission.state.required = 0;
      mission.state.total = 0;
      mission.state.items = [];
      return;
    }

    if (template === 'restorePower') {
      mission.state.total = 0;
      mission.state.switches = [];
      if (!(mission.state.activated instanceof Set)) mission.state.activated = new Set();
      return;
    }

    if (template === 'syncActivate') {
      mission.state.total = 0;
      mission.state.switches = [];
      if (!(mission.state.activated instanceof Set)) mission.state.activated = new Set();
      mission.state.windowSec = 0;
      mission.state.activeUntilSec = 0;
      mission.state.started = false;
      return;
    }

    if (template === 'reroutePower') {
      mission.state.total = 0;
      mission.state.requiredOn = 0;
      mission.state.breakers = [];
      mission.state.solutionSlots = [];
      mission.state.clueRead = true;
      mission.state.clueId = null;
      mission.state.clueGridPos = null;
      mission.state.powered = true;
      mission.state.failures = 0;
      return;
    }

    if (template === 'activateShrines') {
      mission.state.total = 0;
      mission.state.shrines = [];
      if (!(mission.state.activated instanceof Set)) mission.state.activated = new Set();
      return;
    }

    if (template === 'restorePowerFuses') {
      mission.state.fusesRequired = 0;
      mission.state.fusesCollected = 0;
      mission.state.fuses = [];
      mission.state.installed = true;
      mission.state.powered = true;
      return;
    }

    if (template === 'powerGrid') {
      mission.state.total = 0;
      mission.state.requiredPowered = 0;
      mission.state.powered = 0;
      mission.state.itemId = String(mission.params?.itemId || 'fuse').trim() || 'fuse';
      mission.state.fuses = [];
      mission.state.fusesCollected = 0;
      mission.state.branches = [];
      return;
    }

    if (template === 'uploadEvidence') {
      mission.state.collected = 0;
      mission.state.required = 0;
      mission.state.total = 0;
      mission.state.items = [];
      mission.state.uploaded = true;
      mission.state.uploading = false;
      mission.state.uploadSeconds = 0;
      mission.state.uploadProgressSec = 0;
      mission.state.uploadRadius = 0;
      return;
    }

    if (template === 'blackoutZone') {
      mission.state.total = 0;
      mission.state.required = 0;
      mission.state.restored = 0;
      mission.state.radius = 0;
      mission.state.zones = [];
      return;
    }

    if (template === 'codeLock') {
      mission.state.unlocked = true;
      mission.state.codeReady = true;
      mission.state.code = '';
      mission.state.cluesTotal = 0;
      mission.state.cluesCollected = 0;
      mission.state.clues = [];
      return;
    }

    if (template === 'codeLockScan') {
      mission.state.unlocked = true;
      mission.state.codeReady = true;
      mission.state.code = '';
      mission.state.cluesTotal = 0;
      mission.state.cluesCollected = 0;
      mission.state.clues = [];
      mission.state.scanSeconds = 0;
      mission.state.scanRequired = 0;
      mission.state.scanned = 0;
      mission.state.scanTargets = [];
      return;
    }

    if (template === 'lockedDoor') {
      mission.state.unlocked = true;
      return;
    }

    if (template === 'doorLockNetwork') {
      mission.state.total = 0;
      mission.state.unlocked = 0;
      mission.state.doors = [];
      mission.state.lastBlockedDoor = null;
      return;
    }

    if (template === 'placeItemsAtAltars') {
      mission.state.itemId = String(mission.state.itemId || mission.params?.itemId || 'relic').trim() || 'relic';
      mission.state.itemsCollected = 0;
      mission.state.itemsRequired = 0;
      mission.state.altarsFilled = 0;
      mission.state.altarsTotal = 0;
      mission.state.items = [];
      mission.state.altars = [];
      return;
    }

    if (template === 'placeKeysAtLocks') {
      mission.state.required = 0;
      mission.state.keysCollected = 0;
      mission.state.locksFilled = 0;
      mission.state.itemIds = [];
      mission.state.keys = [];
      mission.state.locks = [];
      return;
    }

    if (template === 'searchRoomTypeN') {
      mission.state.searched = 0;
      mission.state.required = 0;
      mission.state.targets = [];
      return;
    }

    if (template === 'searchAndTagRoom') {
      mission.state.tagged = 0;
      mission.state.required = 0;
      mission.state.targets = [];
      return;
    }

    if (template === 'photographEvidence') {
      mission.state.photos = 0;
      mission.state.required = 0;
      mission.state.seconds = 0;
      mission.state.targets = [];
      return;
    }

    if (template === 'holdToScan') {
      mission.state.seconds = 0;
      mission.state.scanned = 0;
      mission.state.required = 0;
      mission.state.targets = [];
      mission.state.completed = true;
      return;
    }

    if (template === 'lureToSensor') {
      mission.state.completed = true;
      mission.state.armed = true;
      mission.state.requireLure = false;
      mission.state.lureSeconds = 0;
      mission.state.lureUntilSec = 0;
      mission.state.requiredTriggers = 0;
      mission.state.triggered = 0;
      mission.state.cooldownSec = 0;
      mission.state.cooldownUntilSec = 0;
      mission.state.requireClear = false;
      mission.state.awaitingClear = false;
      mission.state.lastTriggerAtSec = 0;
      mission.state.successFlashSec = 0;
      mission.state.rearmEachTrigger = false;
      mission.state.playerRadius = 0;
      mission.state.triggerRadius = 0;
      mission.state.sensorId = null;
      mission.state.sensorGridPos = null;
      mission.state.lureId = null;
      mission.state.lureGridPos = null;
      return;
    }

    if (template === 'deliverItemToTerminal') {
      mission.state.itemId = String(mission.state.itemId || mission.params?.itemId || 'package').trim() || 'package';
      mission.state.collected = 0;
      mission.state.required = 0;
      mission.state.total = 0;
      mission.state.items = [];
      mission.state.delivered = true;
      mission.state.terminalId = null;
      mission.state.terminalGridPos = null;
      return;
    }

    if (template === 'deliverFragile') {
      mission.state.itemId = String(mission.state.itemId || mission.params?.itemId || 'fragile_package').trim() || 'fragile_package';
      mission.state.carrying = false;
      mission.state.delivered = true;
      mission.state.packageId = null;
      mission.state.packageGridPos = null;
      mission.state.terminalId = null;
      mission.state.terminalGridPos = null;
      mission.state.breakOnGunfire = false;
      mission.state.breakOnDamage = false;
      return;
    }

    if (template === 'switchSequence') {
      mission.state.total = 0;
      mission.state.sequence = [];
      mission.state.sequenceSlots = [];
      mission.state.index = 0;
      mission.state.resetOnWrong = mission.state.resetOnWrong !== false;
      mission.state.switches = [];
      return;
    }

    if (template === 'switchSequenceWithClues') {
      mission.state.total = 0;
      mission.state.sequence = [];
      mission.state.sequenceSlots = [];
      mission.state.index = 0;
      mission.state.resetOnWrong = mission.state.resetOnWrong !== false;
      mission.state.switches = [];
      mission.state.clues = [];
      mission.state.cluesTotal = 0;
      mission.state.cluesCollected = 0;
      mission.state.sequenceKnown = true;
      return;
    }

    if (template === 'surviveTimer') {
      mission.state.seconds = 0;
      mission.state.completed = true;
      return;
    }

    if (template === 'surviveInZone') {
      mission.state.seconds = 0;
      mission.state.heldForSec = 0;
      mission.state.radius = 0;
      mission.state.exitGraceSec = 0;
      mission.state.outOfZoneSec = 0;
      mission.state.started = true;
      mission.state.completed = true;
      mission.state.beaconId = null;
      mission.state.beaconGridPos = null;
      return;
    }

    if (template === 'occupyPoint') {
      mission.state.seconds = 0;
      mission.state.heldForSec = 0;
      mission.state.radius = 0;
      mission.state.exitGraceSec = 0;
      mission.state.outOfZoneSec = 0;
      mission.state.started = true;
      mission.state.completed = true;
      mission.state.beaconId = null;
      mission.state.beaconGridPos = null;
      mission.state.hazardIntervalSec = 0;
      mission.state.hazardDurationSec = 0;
      mission.state.hazardDamage = 0;
      mission.state.hazardActiveUntilSec = 0;
      mission.state.nextHazardAtSec = 0;
      return;
    }

    if (template === 'surviveNoDamage') {
      mission.state.seconds = 0;
      mission.state.lastDamagedAtSec = 0;
      mission.state.hits = 0;
      mission.state.completed = true;
      return;
    }

    if (template === 'lowHealthForSeconds') {
      mission.state.seconds = 0;
      mission.state.healthPct = 0;
      mission.state.underForSec = 0;
      mission.state.currentHealthPct = null;
      mission.state.completed = true;
      return;
    }

    if (template === 'noHitRun') {
      mission.state.hits = 0;
      mission.state.failed = false;
      mission.state.completed = true;
      mission.state.loseOnHit = true;
      return;
    }

    if (template === 'hideForSeconds') {
      mission.state.seconds = 0;
      mission.state.hiddenForSec = 0;
      mission.state.completed = true;
      return;
    }

    if (template === 'hideUntilClear') {
      mission.state.completed = true;
      mission.state.minDistance = 0;
      mission.state.quietSeconds = 0;
      mission.state.requireNoLOS = false;
      mission.state.lastNoiseAtSec = 0;
      mission.state.nearestMonsterDist = null;
      mission.state.nearestMonsterHasLOS = null;
      return;
    }

    if (template === 'escort') {
      mission.state.started = true;
      mission.state.completed = true;
      mission.state.escortId = null;
      mission.state.escortGridPos = null;
      mission.state.goalGridPos = null;
      mission.state.followDistance = 1;
      mission.state.object3d = null;
      return;
    }

    if (template === 'escortToSafeRoom') {
      mission.state.started = true;
      mission.state.completed = true;
      mission.state.stage = 0;
      mission.state.waitedSec = 0;
      mission.state.checkpointWaitSeconds = 0;
      mission.state.checkpointPlayerRadius = 0;
      mission.state.escortId = null;
      mission.state.escortGridPos = null;
      mission.state.checkpointGridPos = null;
      mission.state.safeGoalGridPos = null;
      mission.state.goalGridPos = null;
      mission.state.followDistance = 1;
      mission.state.object3d = null;
      mission.state.checkpointMarker = null;
      return;
    }

    if (template === 'bossFinale') {
      mission.state.phase = 3;
      mission.state.nodesTotal = 0;
      mission.state.nodesRemaining = 0;
      mission.state.bossMaxHealth = 1;
      mission.state.bossHealth = 0;
      mission.state.shieldActive = false;
      mission.state.escapeUntilSec = 0;
      mission.state.escapeSeconds = 0;
      return;
    }

    if (template === 'escortRescue') {
      mission.state.completed = true;
      mission.state.started = true;
      mission.state.escortId = null;
      mission.state.escortGridPos = null;
      mission.state.goalGridPos = null;
      mission.state.followDistance = 0;
      mission.state.aggroNoiseIntervalSec = 0;
      mission.state.aggroScentIntervalSec = 0;
      mission.state.lastAggroNoiseAtSec = 0;
      mission.state.lastAggroScentAtSec = 0;
      return;
    }

    if (template === 'timedEvac') {
      mission.state.started = true;
      mission.state.seconds = 0;
      mission.state.untilSec = 0;
      mission.state.startedAtSec = 0;
      mission.state.unlockExitMissionId = null;
      mission.state.autoUnlockExit = false;
      mission.state.escalateMonsters = false;
      mission.state.maxCountBonus = 0;
      mission.state.respawnDelaySec = 0;
      mission.state.spawnBurstCount = 0;
      mission.state.spawnPulseSec = 0;
      mission.state.spawnPulseCount = 0;
      mission.state.lastSpawnPulseAtSec = 0;
      mission.state._origMaxCount = null;
      mission.state._origRespawnDelay = null;
      mission.state._boostApplied = false;
      return;
    }

    if (template === 'reclaimStolenItem') {
      mission.state.itemId = String(mission.params?.itemId || 'stolen_item').trim() || 'stolen_item';
      mission.state.itemCount = 0;
      mission.state.itemLabel = String(mission.params?.itemLabel || mission.params?.label || 'stolen item').trim() || 'stolen item';
      mission.state.objectKind = String(mission.params?.objectKind || 'package').trim() || 'package';
      mission.state.recovered = true;
      mission.state.dropped = false;
      mission.state.dropId = null;
      mission.state.dropGridPos = null;
      mission.state.thiefMonsterId = null;
      mission.state.thiefHits = 0;
      mission.state.dropOnHit = false;
      mission.state.hitsToDrop = 0;
      mission.state.dropAtHealthPct = null;
      return;
    }

    if (template === 'hiddenTerminal') {
      mission.state.completed = true;
      mission.state.terminalId = null;
      mission.state.terminalGridPos = null;
      mission.state.roomType = null;
      mission.state.pingIntervalSec = 0;
      mission.state.lastPingAtSec = 0;
      mission.state.revealMarkerAtHintTier = 99;
      return;
    }

    if (template === 'scanWaypoints') {
      mission.state.required = 0;
      mission.state.scanned = 0;
      mission.state.seconds = 0;
      mission.state.radius = 0;
      mission.state.requireLOS = false;
      mission.state.targets = [];
      mission.state.completed = true;
      return;
    }
  }

  bindEvents() {
    this.unsubs.forEach((fn) => fn?.());
    this.unsubs = [];
    const bus = this.eventBus;
    if (!bus?.on) return;

    this.unsubs.push(
      bus.on(EVENTS.ITEM_PICKED, (payload) => this.onItemPicked(payload))
    );
    this.unsubs.push(
      bus.on(EVENTS.INTERACT, (payload) => this.onInteract(payload))
    );
    this.unsubs.push(
      bus.on(EVENTS.ROOM_ENTERED, (payload) => this.onRoomEntered(payload))
    );
    this.unsubs.push(
      bus.on(EVENTS.TIMER_TICK, (payload) => this.onTimerTick(payload))
    );
    this.unsubs.push(
      bus.on(EVENTS.MONSTER_KILLED, (payload) => this.onMonsterKilled(payload))
    );
    this.unsubs.push(
      bus.on(EVENTS.PLAYER_HIT_MONSTER, (payload) => this.onPlayerHitMonster(payload))
    );
    this.unsubs.push(
      bus.on(EVENTS.PLAYER_DAMAGED, (payload) => this.onPlayerDamaged(payload))
    );
    this.unsubs.push(
      bus.on(EVENTS.WEAPON_FIRED, (payload) => this.onWeaponFired(payload))
    );
    this.unsubs.push(
      bus.on(EVENTS.NOISE_EMITTED, (payload) => this.onNoiseEmitted(payload))
    );
    this.unsubs.push(
      bus.on(EVENTS.MISSION_HINT_REQUESTED, (payload) => this.onHintRequested(payload))
    );
    this.unsubs.push(
      bus.on(EVENTS.KEYPAD_CODE_SUBMITTED, (payload) => this.onKeypadCodeSubmitted(payload))
    );
    this.unsubs.push(
      bus.on(EVENTS.BOSS_UPDATED, (payload) => this.onBossUpdated(payload))
    );
  }

  spawnFromConfig(missionsConfig) {
    if (!missionsConfig?.list || !Array.isArray(missionsConfig.list)) return;
    const ws = this.worldState;
    const scene = this.scene;
    const interactables = this.interactables;
    if (!ws || !scene || !interactables) return;

    const spawn = ws.getSpawnPoint?.() || null;
    const exit = ws.getExitPoint?.() || null;

    for (const [idx, entry] of missionsConfig.list.entries()) {
      const id = String(entry.id || '').trim();
      const template = String(entry.template || '').trim();
      if (!id || !template) continue;

      const mission = {
        id,
        template,
        required: entry.required !== false,
        params: deepClone(entry.params || {}),
        state: {}
      };

      if (template === 'findKeycard') {
        mission.state = { found: false };
        this.spawnFindKeycard(mission, { avoid: [spawn, exit] });
      } else if (template === 'collectEvidence') {
        const total = clamp(Math.round(mission.params.count ?? 3), 1, 999);
        const required = clamp(Math.round(mission.params.required ?? total), 1, total);
        mission.state = { collected: 0, required, total };
        this.spawnEvidence(mission, { avoid: [spawn, exit] });
      } else if (template === 'restorePower') {
        const switches = clamp(Math.round(mission.params.switches ?? 3), 1, 12);
        mission.state = { activated: new Set(), total: switches };
        this.spawnPowerSwitches(mission, { avoid: [spawn, exit] });
      } else if (template === 'syncActivate') {
        const switches = clamp(Math.round(mission.params.switches ?? mission.params.count ?? 3), 2, 12);
        const windowSec = clamp(Math.round(mission.params.windowSec ?? mission.params.seconds ?? 15), 5, 90);
        mission.state = {
          activated: new Set(),
          total: switches,
          switches: [],
          started: false,
          windowSec,
          activeUntilSec: 0
        };
        this.spawnSyncActivateSwitches(mission, { avoid: [spawn, exit] });
      } else if (template === 'reroutePower') {
        const breakers = clamp(Math.round(mission.params.breakers ?? mission.params.switches ?? mission.params.count ?? 4), 2, 10);
        const onCount = clamp(Math.round(mission.params.onCount ?? mission.params.requiredOn ?? 3), 1, breakers);
        const requireClue = mission.params.requireClue !== false;
        mission.state = {
          total: breakers,
          requiredOn: onCount,
          breakers: [],
          solutionSlots: [],
          clueRead: requireClue ? false : true,
          clueId: null,
          clueGridPos: null,
          powered: false,
          failures: 0
        };
        this.spawnReroutePower(mission, { avoid: [spawn, exit] });
      } else if (template === 'activateShrines') {
        const shrines = clamp(Math.round(mission.params.shrines ?? mission.params.count ?? 3), 1, 12);
        mission.state = { activated: new Set(), total: shrines };
        this.spawnShrines(mission, { avoid: [spawn, exit] });
      } else if (template === 'restorePowerFuses') {
        const fuses = clamp(Math.round(mission.params.fuses ?? mission.params.required ?? 3), 1, 12);
        mission.state = {
          fusesRequired: fuses,
          fusesCollected: 0,
          installed: false,
          powered: false,
          fuses: [],
          panelId: null,
          panelGridPos: null
        };
        this.spawnRestorePowerFuses(mission, { avoid: [spawn, exit] });
      } else if (template === 'powerGrid') {
        const branches = clamp(Math.round(mission.params.branches ?? mission.params.sectors ?? mission.params.count ?? 3), 1, 8);
        const requiredPowered = clamp(Math.round(mission.params.requiredPowered ?? mission.params.required ?? branches), 1, branches);
        const itemId = String(mission.params.itemId || 'fuse').trim() || 'fuse';
        mission.state = {
          total: branches,
          requiredPowered,
          powered: 0,
          itemId,
          fuses: [],
          fusesCollected: 0,
          branches: []
        };
        this.spawnPowerGrid(mission, { avoid: [spawn, exit] });
      } else if (template === 'uploadEvidence') {
        const total = clamp(Math.round(mission.params.count ?? 3), 1, 999);
        const required = clamp(Math.round(mission.params.required ?? total), 1, total);
        const uploadSeconds = clamp(Math.round(mission.params.uploadSeconds ?? mission.params.seconds ?? 0), 0, 600);
        const uploadRadius = clamp(Math.round(mission.params.uploadRadius ?? mission.params.radius ?? 2), 1, 8);
        const uploadResetOnLeave = mission.params.uploadResetOnLeave !== false;
        mission.state = {
          collected: 0,
          required,
          total,
          uploaded: false,
          uploading: false,
          uploadSeconds,
          uploadRadius,
          uploadResetOnLeave,
          uploadProgressSec: 0,
          items: [],
          terminalId: null,
          terminalGridPos: null
        };
        this.spawnUploadEvidence(mission, { avoid: [spawn, exit] });
      } else if (template === 'blackoutZone') {
        const zones = clamp(Math.round(mission.params.zones ?? mission.params.count ?? 2), 1, 8);
        const required = clamp(Math.round(mission.params.required ?? zones), 1, zones);
        const radius = clamp(Math.round(mission.params.radius ?? mission.params.zoneRadius ?? 9), 3, 30);
        mission.state = {
          total: zones,
          required,
          restored: 0,
          radius,
          zones: []
        };
        this.spawnBlackoutZones(mission, { avoid: [spawn, exit] });
      } else if (template === 'lockedDoor') {
        mission.state = {
          unlocked: false,
          keyItemId: String(mission.params.keyItemId || mission.params.itemId || 'door_key').trim() || 'door_key',
          keyId: null,
          keyGridPos: null,
          keyPicked: false,
          doorId: null,
          doorGridPos: null,
          doorApproachGridPos: null
        };
        this.spawnLockedDoor(mission, { avoid: [spawn, exit] });
      } else if (template === 'doorLockNetwork') {
        mission.state = {
          total: 0,
          unlocked: 0,
          doors: [],
          lastBlockedDoor: null
        };
        this.spawnDoorLockNetwork(mission, { avoid: [spawn, exit] });
      } else if (template === 'placeKeysAtLocks') {
        const keys = clamp(Math.round(mission.params.keys ?? mission.params.items ?? mission.params.count ?? 3), 1, 24);
        mission.state = {
          required: keys,
          keysCollected: 0,
          locksFilled: 0,
          itemIds: [],
          keys: [],
          locks: []
        };
        this.spawnPlaceKeysAtLocks(mission, { avoid: [spawn, exit] });
      } else if (template === 'placeItemsAtAltars') {
        const itemsRequired = clamp(Math.round(mission.params.items ?? mission.params.count ?? 3), 1, 24);
        const altarsTotal = clamp(Math.round(mission.params.altars ?? itemsRequired), 1, 24);
        mission.state = {
          itemId: String(mission.params.itemId || 'relic').trim() || 'relic',
          itemsRequired,
          itemsCollected: 0,
          altarsTotal,
          altarsFilled: 0,
          items: [],
          altars: []
        };
        this.spawnPlaceItemsAtAltars(mission, { avoid: [spawn, exit] });
      } else if (template === 'searchRoomTypeN') {
        const required = clamp(Math.round(mission.params.count ?? 3), 1, 24);
        mission.state = { searched: 0, required, targets: [] };
        this.spawnSearchRoomTypeN(mission, { avoid: [spawn, exit] });
      } else if (template === 'searchAndTagRoom') {
        const required = clamp(Math.round(mission.params.count ?? 3), 1, 24);
        mission.state = { tagged: 0, required, targets: [] };
        this.spawnSearchAndTagRoom(mission, { avoid: [spawn, exit] });
      } else if (template === 'photographEvidence') {
        const required = clamp(Math.round(mission.params.count ?? 3), 1, 24);
        const seconds = clamp(Math.round(mission.params.seconds ?? mission.params.holdSeconds ?? 2), 1, 30);
        mission.state = { photos: 0, required, seconds, targets: [] };
        this.spawnPhotographEvidence(mission, { avoid: [spawn, exit] });
      } else if (template === 'holdToScan') {
        const count = clamp(Math.round(mission.params.count ?? 1), 1, 24);
        const seconds = clamp(Math.round(mission.params.seconds ?? mission.params.holdSeconds ?? 5), 2, 120);
        mission.state = { required: count, scanned: 0, seconds, targets: [], completed: false };
        this.spawnHoldToScan(mission, { avoid: [spawn, exit] });
      } else if (template === 'scanWaypoints') {
        const count = clamp(Math.round(mission.params.count ?? 4), 1, 24);
        const seconds = clamp(Math.round(mission.params.seconds ?? mission.params.holdSeconds ?? 4), 1, 120);
        const radius = clamp(Math.round(mission.params.radius ?? mission.params.playerRadius ?? 2), 0, 10);
        const requireLOS = mission.params.requireLOS === true;
        mission.state = { required: count, scanned: 0, seconds, radius, requireLOS, targets: [], completed: false };
        this.spawnScanWaypoints(mission, { avoid: [spawn, exit] });
      } else if (template === 'lureToSensor') {
        const lureSeconds = clamp(Math.round(mission.params.lureSeconds ?? mission.params.seconds ?? 10), 3, 120);
        const requiredTriggers = clamp(Math.round(mission.params.requiredTriggers ?? mission.params.count ?? mission.params.required ?? 1), 1, 12);
        const requireClear = mission.params.requireClear === undefined ? (requiredTriggers > 1) : (mission.params.requireClear !== false);
        const rearmEachTrigger = mission.params.rearmEachTrigger === true;
        const cooldownSec = clamp(Math.round(mission.params.cooldownSec ?? 3), 0, 60);
        const successFlashSec = clamp(toFinite(mission.params.successFlashSec, 2) ?? 2, 0, 10);
        mission.state = {
          armed: false,
          completed: false,
          requireLure: mission.params.requireLure !== false,
          lureSeconds,
          lureUntilSec: 0,
          requiredTriggers,
          triggered: 0,
          cooldownSec,
          cooldownUntilSec: 0,
          requireClear,
          awaitingClear: false,
          lastTriggerAtSec: -999,
          successFlashSec,
          rearmEachTrigger,
          playerRadius: clamp(Math.round(mission.params.playerRadius ?? 3), 1, 20),
          triggerRadius: clamp(Math.round(mission.params.triggerRadius ?? 1), 0, 10),
          sensorId: null,
          sensorGridPos: null,
          lureId: null,
          lureGridPos: null
        };
        this.spawnLureToSensor(mission, { avoid: [spawn, exit] });
      } else if (template === 'deliverItemToTerminal') {
        const total = clamp(Math.round(mission.params.count ?? 3), 1, 24);
        const required = clamp(Math.round(mission.params.required ?? total), 1, total);
        mission.state = {
          itemId: String(mission.params.itemId || 'package').trim() || 'package',
          collected: 0,
          required,
          total,
          delivered: false,
          items: [],
          terminalId: null,
          terminalGridPos: null
        };
        this.spawnDeliverItemToTerminal(mission, { avoid: [spawn, exit] });
      } else if (template === 'deliverFragile') {
        mission.state = {
          itemId: String(mission.params.itemId || 'fragile_package').trim() || 'fragile_package',
          carrying: false,
          delivered: false,
          packageId: null,
          packageGridPos: null,
          terminalId: null,
          terminalGridPos: null,
          breakOnGunfire: mission.params.breakOnGunfire !== false,
          breakOnDamage: mission.params.breakOnDamage !== false
        };
        this.spawnDeliverFragile(mission, { avoid: [spawn, exit] });
      } else if (template === 'switchSequence') {
        const switches = clamp(Math.round(mission.params.switches ?? mission.params.count ?? 3), 2, 10);
        mission.state = {
          total: switches,
          sequence: [],
          index: 0,
          resetOnWrong: mission.params.resetOnWrong !== false,
          switches: []
        };
        this.spawnSwitchSequence(mission, { avoid: [spawn, exit] });
      } else if (template === 'switchSequenceWithClues') {
        const switches = clamp(Math.round(mission.params.switches ?? mission.params.count ?? 3), 2, 10);
        mission.state = {
          total: switches,
          sequence: [],
          sequenceSlots: [],
          index: 0,
          resetOnWrong: mission.params.resetOnWrong !== false,
          switches: [],
          clues: [],
          cluesTotal: 0,
          cluesCollected: 0,
          sequenceKnown: false
        };
        this.spawnSwitchSequenceWithClues(mission, { avoid: [spawn, exit] });
      } else if (template === 'hideForSeconds') {
        const seconds = clamp(Math.round(mission.params.seconds ?? 10), 3, 600);
        mission.state = { seconds, hiddenForSec: 0, completed: false };
      } else if (template === 'hideUntilClear') {
        const minDistance = clamp(Math.round(mission.params.minDistance ?? mission.params.minMonsterDistance ?? 8), 1, 999);
        const quietSeconds = clamp(Math.round(mission.params.quietSeconds ?? 0), 0, 999);
        mission.state = {
          completed: false,
          minDistance,
          quietSeconds,
          requireNoLOS: mission.params.requireNoLOS !== false,
          lastNoiseAtSec: 0,
          nearestMonsterDist: null,
          nearestMonsterHasLOS: null
        };
      } else if (template === 'escort') {
        mission.state = {
          started: false,
          completed: false,
          escortId: null,
          escortGridPos: null,
          goalGridPos: null,
          followDistance: clamp(Math.round(mission.params.followDistance ?? 1), 1, 4),
          object3d: null
        };
        this.spawnEscort(mission, { avoid: [spawn, exit] });
      } else if (template === 'escortRescue') {
        const followDistance = clamp(Math.round(mission.params.followDistance ?? 1), 1, 4);
        mission.state = {
          started: false,
          completed: false,
          escortId: null,
          escortGridPos: null,
          goalGridPos: null,
          followDistance,
          object3d: null,
          // Aggro bias: periodically emits strong lure/noise and scent from the buddy position.
          aggroNoiseIntervalSec: clamp(toFinite(mission.params.aggroNoiseIntervalSec, 2) ?? 2, 0, 60),
          aggroNoiseRadius: clamp(toFinite(mission.params.aggroNoiseRadius, 16) ?? 16, 2, 80),
          aggroNoiseStrength: clamp(toFinite(mission.params.aggroNoiseStrength, 0.85) ?? 0.85, 0.05, 2.0),
          aggroNoiseTtl: clamp(toFinite(mission.params.aggroNoiseTtl, 0.9) ?? 0.9, 0.1, 6.0),
          aggroNoiseKind: String(mission.params.aggroNoiseKind || 'lure').trim() || 'lure',
          aggroScentIntervalSec: clamp(toFinite(mission.params.aggroScentIntervalSec, 1) ?? 1, 0, 60),
          aggroScentRadius: clamp(toFinite(mission.params.aggroScentRadius, 14) ?? 14, 2, 80),
          aggroScentStrength: clamp(toFinite(mission.params.aggroScentStrength, 1.15) ?? 1.15, 0.05, 3.0),
          aggroScentTtl: clamp(toFinite(mission.params.aggroScentTtl, 4) ?? 4, 0.2, 30),
          lastAggroNoiseAtSec: -999,
          lastAggroScentAtSec: -999
        };
        this.spawnEscort(mission, { avoid: [spawn, exit] });
      } else if (template === 'timedEvac') {
        const seconds = clamp(Math.round(mission.params.seconds ?? mission.params.timeSec ?? 45), 5, 600);
        const autoUnlockExit = mission.params.autoUnlockExit !== false;
        const unlockExitMissionId = String(mission.params.unlockExitMissionId || 'unlockExit').trim() || 'unlockExit';

        const maxCountBonus = clamp(Math.round(mission.params.maxCountBonus ?? mission.params.spawnMaxCountBonus ?? 2), 0, 12);
        const respawnDelaySec = clamp(toFinite(mission.params.respawnDelaySec ?? mission.params.spawnRespawnDelaySec, 0.35) ?? 0.35, 0, 10);
        const spawnBurstCount = clamp(Math.round(mission.params.spawnBurstCount ?? 2), 0, 10);
        const spawnPulseSec = clamp(toFinite(mission.params.spawnPulseSec, 6) ?? 6, 0, 60);
        const spawnPulseCount = clamp(Math.round(mission.params.spawnPulseCount ?? 1), 0, 6);

        mission.state = {
          started: false,
          seconds,
          untilSec: 0,
          startedAtSec: 0,
          unlockExitMissionId,
          autoUnlockExit,
          escalateMonsters: mission.params.escalateMonsters !== false,
          maxCountBonus,
          respawnDelaySec,
          spawnBurstCount,
          spawnPulseSec,
          spawnPulseCount,
          lastSpawnPulseAtSec: -999,
          _origMaxCount: null,
          _origRespawnDelay: null,
          _boostApplied: false
        };
      } else if (template === 'escortToSafeRoom') {
        mission.state = {
          started: false,
          completed: false,
          stage: 0,
          waitedSec: 0,
          checkpointWaitSeconds: clamp(Math.round(mission.params.checkpointWaitSeconds ?? mission.params.checkpointSeconds ?? mission.params.waitSeconds ?? 3), 0, 120),
          checkpointPlayerRadius: clamp(Math.round(mission.params.checkpointPlayerRadius ?? mission.params.checkpointRadius ?? 2), 0, 10),
          escortId: null,
          escortGridPos: null,
          checkpointGridPos: null,
          safeGoalGridPos: null,
          goalGridPos: null,
          followDistance: clamp(Math.round(mission.params.followDistance ?? 1), 1, 4),
          object3d: null,
          checkpointMarker: null
        };
        this.spawnEscortToSafeRoom(mission, { avoid: [spawn, exit] });
      } else if (template === 'surviveTimer') {
        const seconds = clamp(Math.round(mission.params.seconds ?? 60), 5, 3600);
        mission.state = { seconds, completed: false };
      } else if (template === 'surviveInZone') {
        const seconds = clamp(Math.round(mission.params.seconds ?? 25), 5, 3600);
        const radius = clamp(Math.round(mission.params.radius ?? mission.params.playerRadius ?? 2), 1, 8);
        const exitGraceSec = clamp(Math.round(mission.params.exitGraceSec ?? 2), 0, 20);
        mission.state = {
          seconds,
          radius,
          exitGraceSec,
          heldForSec: 0,
          outOfZoneSec: 0,
          started: false,
          completed: false,
          beaconId: null,
          beaconGridPos: null
        };
        this.spawnSurviveInZone(mission, { avoid: [spawn, exit] });
      } else if (template === 'occupyPoint') {
        const seconds = clamp(Math.round(mission.params.seconds ?? 30), 5, 3600);
        const radius = clamp(Math.round(mission.params.radius ?? mission.params.playerRadius ?? 2), 1, 8);
        const exitGraceSec = clamp(Math.round(mission.params.exitGraceSec ?? 2), 0, 20);
        const hazardIntervalSec = clamp(Math.round(mission.params.hazardIntervalSec ?? mission.params.pulseSec ?? 8), 2, 120);
        const hazardDurationSec = clamp(Math.round(mission.params.hazardDurationSec ?? mission.params.pulseDurationSec ?? 2), 1, 30);
        const hazardDamage = clamp(Math.round(mission.params.hazardDamage ?? 3), 0, 50);
        mission.state = {
          seconds,
          radius,
          exitGraceSec,
          heldForSec: 0,
          outOfZoneSec: 0,
          started: false,
          completed: false,
          beaconId: null,
          beaconGridPos: null,
          hazardIntervalSec,
          hazardDurationSec,
          hazardDamage,
          hazardActiveUntilSec: 0,
          nextHazardAtSec: 0
        };
        this.spawnSurviveInZone(mission, { avoid: [spawn, exit] });
      } else if (template === 'surviveNoDamage') {
        const seconds = clamp(Math.round(mission.params.seconds ?? 20), 5, 3600);
        mission.state = { seconds, lastDamagedAtSec: 0, completed: false, hits: 0 };
      } else if (template === 'lowHealthForSeconds') {
        const seconds = clamp(Math.round(mission.params.seconds ?? mission.params.timeSec ?? 12), 1, 3600);
        const healthPct = clamp(Math.round(mission.params.healthPct ?? mission.params.thresholdPct ?? 35), 1, 99);
        mission.state = { seconds, healthPct, underForSec: 0, currentHealthPct: null, completed: false };
      } else if (template === 'noHitRun') {
        const loseOnHit = mission.params.loseOnHit === undefined
          ? (mission.required !== false)
          : (mission.params.loseOnHit !== false);
        mission.state = { hits: 0, failed: false, completed: false, loseOnHit };
      } else if (template === 'reclaimStolenItem') {
        const itemId = String(mission.params.itemId || 'stolen_item').trim() || 'stolen_item';
        const itemCount = clamp(Math.round(mission.params.itemCount ?? mission.params.count ?? 1), 1, 99);
        const itemLabel = String(mission.params.itemLabel || mission.params.label || itemId).trim() || itemId;
        const objectKind = String(mission.params.objectKind || 'package').trim() || 'package';
        const dropOnHit = mission.params.dropOnHit === true;
        const hitsToDrop = clamp(Math.round(mission.params.hitsToDrop ?? 3), 1, 20);
        const dropAtHealthPctRaw = toFinite(mission.params.dropAtHealthPct ?? mission.params.dropHealthPct, null);
        const dropAtHealthPct = Number.isFinite(dropAtHealthPctRaw)
          ? clamp(dropAtHealthPctRaw, 1, 99)
          : null;

        mission.state = {
          itemId,
          itemCount,
          itemLabel,
          objectKind,
          recovered: false,
          dropped: false,
          dropId: null,
          dropGridPos: null,
          thiefMonsterId: null,
          thiefHits: 0,
          dropOnHit,
          hitsToDrop,
          dropAtHealthPct
        };
      } else if (template === 'hiddenTerminal') {
        const pingIntervalSec = clamp(Math.round(mission.params.pingIntervalSec ?? 8), 0, 120);
        const revealMarkerAtHintTier = clamp(Math.round(mission.params.revealMarkerAtHintTier ?? 99), 0, 99);
        mission.state = {
          completed: false,
          terminalId: null,
          terminalGridPos: null,
          roomType: null,
          pingIntervalSec,
          lastPingAtSec: -999,
          revealMarkerAtHintTier
        };
        this.spawnHiddenTerminal(mission, { avoid: [spawn, exit] });
      } else if (template === 'enterRoomType') {
        const required = clamp(Math.round(mission.params.count ?? 1), 1, 999);
        const roomTypes = normalizeRoomTypes(mission.params.roomTypes) || null;
        mission.state = { entered: 0, required, roomTypes };
      } else if (template === 'enterRoomSequence') {
        const desiredLen = clamp(Math.round(mission.params.length ?? 3), 2, 6);
        const raw = normalizeRoomTypes(mission.params.sequence) || [];
        const resetOnWrong = mission.params.resetOnWrong !== false;
        const ignoreCorridor = mission.params.ignoreCorridor !== false;

        let sequence = raw.length >= 2
          ? raw.slice(0, desiredLen)
          : this.pickRoomSequence(desiredLen);

        // Keep the sequence solvable even if some room types are missing in this map.
        const available = this.getAvailableRoomTypes();
        if (available.size > 0) {
          const filtered = sequence.filter((t) => available.has(t));
          if (filtered.length >= 2) {
            sequence = filtered;
          } else if (raw.length >= 2) {
            sequence = this.pickRoomSequence(desiredLen);
          }
        }

        mission.state = { sequence, index: 0, resetOnWrong, ignoreCorridor };
      } else if (template === 'killCount') {
        const required = clamp(Math.round(mission.params.count ?? 3), 1, 999);
        mission.state = { killed: 0, required };
      } else if (template === 'codeLock') {
        const cluesTotal = clamp(Math.round(mission.params.clues ?? 3), 2, 6);
        mission.state = {
          cluesTotal,
          cluesCollected: 0,
          codeReady: false,
          code: '',
          unlocked: false,
          failedAttempts: 0,
          clues: [],
          keypadId: null,
          keypadGridPos: null
        };
        this.spawnCodeLock(mission, { avoid: [spawn, exit] });
      } else if (template === 'codeLockScan') {
        const cluesTotal = clamp(Math.round(mission.params.clues ?? 3), 2, 6);
        const scanSeconds = clamp(Math.round(mission.params.sampleSeconds ?? mission.params.scanSeconds ?? mission.params.holdSeconds ?? 4), 1, 60);
        const scanCount = clamp(Math.round(mission.params.sampleCount ?? mission.params.scanCount ?? 1), 1, 6);
        mission.state = {
          cluesTotal,
          cluesCollected: 0,
          codeReady: false,
          code: '',
          unlocked: false,
          failedAttempts: 0,
          clues: [],
          keypadId: null,
          keypadGridPos: null,
          scanSeconds,
          scanRequired: scanCount,
          scanned: 0,
          scanTargets: []
        };
        this.spawnCodeLockScan(mission, { avoid: [spawn, exit] });
      } else if (template === 'unlockExit') {
        mission.state = { unlocked: false };
      } else if (template === 'stealthNoise') {
        const seconds = clamp(Math.round(mission.params.seconds ?? 20), 5, 3600);
        const resetOnGunshot = mission.params.resetOnGunshot !== false;
        const maxGunshotsTotal = toFinite(mission.params.maxGunshotsTotal, null);
        const maxNoiseStrengthRaw = Number(mission.params.maxNoiseStrength ?? mission.params.noiseLimit ?? mission.params.maxNoise ?? NaN);
        const maxNoiseStrength = Number.isFinite(maxNoiseStrengthRaw) ? clamp(maxNoiseStrengthRaw, 0, 1) : null;
        const penaltySecondsPerStrike = clamp(Math.round(mission.params.penaltySecondsPerStrike ?? mission.params.penaltySeconds ?? 0), 0, 60);
        const maxPenaltySeconds = clamp(Math.round(mission.params.maxPenaltySeconds ?? 60), 0, 600);
        const maxStrikes = clamp(Math.round(mission.params.maxStrikes ?? 0), 0, 999);
        mission.state = {
          seconds,
          resetOnGunshot,
          maxGunshotsTotal,
          maxNoiseStrength,
          penaltySecondsPerStrike,
          maxPenaltySeconds,
          maxStrikes,
          strikes: 0,
          gunshots: 0,
          lastNoiseAtSec: 0,
          lastStrikeAtSec: 0,
          lastStrikeToastAtSec: -999,
          completed: false
        };
      } else if (template === 'bossFinale') {
        mission.state = {
          phase: 0,
          nodesTotal: 0,
          nodesRemaining: 0,
          bossMaxHealth: 0,
          bossHealth: 0,
          shieldActive: false,
          escapeUntilSec: 0,
          escapeSeconds: 0
        };
        this.syncBossFinaleMission(mission);
      } else {
        console.warn(`⚠️ Unknown mission template: ${template}`);
        mission.state = {};
      }

      this.missions.set(id, mission);
      this.eventBus?.emit?.(EVENTS.MISSION_STARTED, { missionId: id, template, required: mission.required });

      void idx;
    }
  }

  getAvailableRoomTypes() {
    const rooms = this.worldState?.getRooms ? this.worldState.getRooms() : [];
    const types = new Set();
    for (const room of rooms) {
      if (!room) continue;
      if (!Number.isFinite(room.type)) continue;
      if (room.type === ROOM_TYPES.CORRIDOR) continue;
      types.add(room.type);
    }
    return types;
  }

  pickRoomSequence(desiredLen = 3) {
    const len = clamp(Math.round(desiredLen || 3), 2, 6);
    const types = Array.from(this.getAvailableRoomTypes());

    if (types.length >= 2) {
      shuffleInPlace(types);
      return types.slice(0, Math.min(len, types.length));
    }

    // Fallback to common room types (even if not present).
    return [
      ROOM_TYPES.CLASSROOM,
      ROOM_TYPES.OFFICE,
      ROOM_TYPES.BATHROOM,
      ROOM_TYPES.LAB,
      ROOM_TYPES.STORAGE
    ].slice(0, len);
  }

  spawnFindKeycard(mission, options = {}) {
    const ws = this.worldState;
    const allowedRoomTypes = Array.isArray(mission.params.roomTypes) ? mission.params.roomTypes : null;
    const avoid = Array.isArray(options.avoid) ? options.avoid.filter(Boolean) : [];
    const tiles = pickDistinctTiles(ws, 1, {
      allowedRoomTypes,
      minDistFrom: avoid,
      minDist: mission.params.minDistFromSpawn ?? 7,
      margin: 1
    });
    if (tiles.length === 0) {
      this.failOpenMission(mission, 'no valid spawn tiles');
      return;
    }
    if (!this.canSpawnMissionObject(1)) {
      this.failOpenMission(mission, 'mission object budget exhausted');
      return;
    }

    const pos = tiles[0];
    const object3d = createKeycardObject();
    const world = gridToWorldCenter(pos);
    object3d.position.set(world.x, 0, world.z);

    this.scene.add(object3d);
    this.spawnedObjects.push(object3d);
    this.consumeMissionObjectBudget(1);

    const interactableId = `keycard:${mission.id}`;
    const label = mission.params.label || 'Pick up Keycard';
    this.registeredIds.push(
      this.interactables.register({
        id: interactableId,
        kind: 'keycard',
        label,
        gridPos: { x: pos.x, y: pos.y },
        object3d,
        prompt: () => `E: ${label}`,
        interact: () => ({ ok: true, picked: true, message: 'Keycard acquired' }),
        meta: { missionId: mission.id, template: mission.template }
      })
    );
    this.interactableMeta.set(interactableId, { missionId: mission.id, template: mission.template });

    mission.state.gridPos = { x: pos.x, y: pos.y };
  }

  spawnEvidence(mission, options = {}) {
    const ws = this.worldState;
    const allowedRoomTypes = Array.isArray(mission.params.roomTypes) ? mission.params.roomTypes : null;
    const avoid = Array.isArray(options.avoid) ? options.avoid.filter(Boolean) : [];

    const desired = clamp(Math.round(mission.state.total || 0), 0, 999);
    const want = Number.isFinite(this.objectBudgetRemaining)
      ? Math.max(0, Math.min(desired, this.objectBudgetRemaining))
      : desired;

    const tiles = pickDistinctTiles(ws, want, {
      allowedRoomTypes,
      minDistFrom: avoid,
      minDist: mission.params.minDistFromSpawn ?? 6,
      margin: 1
    });
    if (tiles.length === 0) {
      this.failOpenMission(mission, want <= 0 ? 'mission object budget exhausted' : 'no valid spawn tiles');
      return;
    }

    mission.state.total = tiles.length;
    mission.state.required = clamp(Math.round(mission.state.required ?? tiles.length), 1, tiles.length);

    mission.state.items = [];

    for (let i = 0; i < tiles.length; i++) {
      if (!this.canSpawnMissionObject(1)) break;
      const pos = tiles[i];
      const object3d = createEvidenceObject();
      const world = gridToWorldCenter(pos);
      object3d.position.set(world.x, 0, world.z);
      object3d.rotation.y = Math.random() * Math.PI * 2;

      this.scene.add(object3d);
      this.spawnedObjects.push(object3d);
      this.consumeMissionObjectBudget(1);

      const interactableId = `evidence:${mission.id}:${i + 1}`;
      const label = 'Collect Evidence';
      this.registeredIds.push(
        this.interactables.register({
          id: interactableId,
          kind: 'evidence',
          label,
          gridPos: { x: pos.x, y: pos.y },
          object3d,
          prompt: () => `E: ${label}`,
          interact: () => ({ ok: true, picked: true, message: 'Evidence collected' }),
          meta: { missionId: mission.id, template: mission.template, index: i }
        })
      );
      this.interactableMeta.set(interactableId, { missionId: mission.id, template: mission.template, index: i });
      mission.state.items.push({ id: interactableId, gridPos: { x: pos.x, y: pos.y }, collected: false });
    }

    if (mission.state.items.length === 0) {
      this.failOpenMission(mission, 'mission object budget exhausted');
      return;
    }

    // Ensure required never exceeds what actually spawned.
    mission.state.required = clamp(Math.round(mission.state.required ?? tiles.length), 1, mission.state.items.length);
    mission.state.total = mission.state.items.length;
  }

  spawnPowerSwitches(mission, options = {}) {
    const ws = this.worldState;
    const avoid = Array.isArray(options.avoid) ? options.avoid.filter(Boolean) : [];
    const allowedRoomTypes = Array.isArray(mission.params.roomTypes) ? mission.params.roomTypes : null;

    const desired = clamp(Math.round(mission.state.total || 0), 0, 999);
    const want = Number.isFinite(this.objectBudgetRemaining)
      ? Math.max(0, Math.min(desired, this.objectBudgetRemaining))
      : desired;

    const tiles = pickDistinctTiles(ws, want, {
      allowedRoomTypes,
      minDistFrom: avoid,
      minDist: mission.params.minDistFromSpawn ?? 6,
      margin: 1
    });
    if (tiles.length === 0) {
      this.failOpenMission(mission, want <= 0 ? 'mission object budget exhausted' : 'no valid spawn tiles');
      return;
    }

    mission.state.total = tiles.length;
    mission.state.switches = [];

    for (let i = 0; i < tiles.length; i++) {
      if (!this.canSpawnMissionObject(1)) break;
      const pos = tiles[i];
      const object3d = createPowerSwitchObject(false);
      const world = gridToWorldCenter(pos);
      object3d.position.set(world.x, 0, world.z);

      this.scene.add(object3d);
      this.spawnedObjects.push(object3d);
      this.consumeMissionObjectBudget(1);

      const interactableId = `switch:${mission.id}:${i + 1}`;
      const label = 'Activate Power Switch';
      this.registeredIds.push(
        this.interactables.register({
          id: interactableId,
          kind: 'switch',
          label,
          gridPos: { x: pos.x, y: pos.y },
          object3d,
          prompt: () => `E: ${label}`,
          interact: ({ entry }) => {
            // One-way switch: on stays on.
            const meta = entry?.meta || {};
            if (meta?.on) return { ok: true, message: 'Switch already active', state: { on: true } };
            meta.on = true;
            setPowerSwitchState(object3d, true);
            return { ok: true, message: 'Switch activated', state: { on: true } };
          },
          meta: { missionId: mission.id, template: mission.template, index: i, on: false }
        })
      );
      this.interactableMeta.set(interactableId, { missionId: mission.id, template: mission.template, index: i });
      mission.state.switches.push({ id: interactableId, gridPos: { x: pos.x, y: pos.y }, on: false });
    }

    if (mission.state.switches.length === 0) {
      this.failOpenMission(mission, 'mission object budget exhausted');
      return;
    }

    mission.state.total = mission.state.switches.length;
  }

  spawnSyncActivateSwitches(mission, options = {}) {
    const ws = this.worldState;
    const avoid = Array.isArray(options.avoid) ? options.avoid.filter(Boolean) : [];
    const allowedRoomTypes = Array.isArray(mission.params.roomTypes) ? mission.params.roomTypes : null;

    const desired = clamp(Math.round(mission.state.total || 0), 0, 999);
    const want = Number.isFinite(this.objectBudgetRemaining)
      ? Math.max(0, Math.min(desired, this.objectBudgetRemaining))
      : desired;

    const tiles = pickDistinctTiles(ws, want, {
      allowedRoomTypes,
      minDistFrom: avoid,
      minDist: mission.params.minDistFromSpawn ?? 7,
      margin: 1
    });
    if (tiles.length === 0) {
      this.failOpenMission(mission, want <= 0 ? 'mission object budget exhausted' : 'no valid spawn tiles');
      return;
    }

    mission.state.total = tiles.length;
    mission.state.switches = [];

    const windowSec = clamp(Math.round(mission.state.windowSec ?? mission.params.windowSec ?? mission.params.seconds ?? 15), 5, 90);
    mission.state.windowSec = windowSec;
    mission.state.started = false;
    mission.state.activeUntilSec = 0;
    if (!(mission.state.activated instanceof Set)) mission.state.activated = new Set();

    for (let i = 0; i < tiles.length; i++) {
      if (!this.canSpawnMissionObject(1)) break;
      const pos = tiles[i];
      const object3d = createPowerSwitchObject(false);
      const world = gridToWorldCenter(pos);
      object3d.position.set(world.x, 0, world.z);

      this.scene.add(object3d);
      this.spawnedObjects.push(object3d);
      this.consumeMissionObjectBudget(1);

      const slot = toSlotLabel(i);
      const interactableId = `sync:${mission.id}:${slot}`;
      const label = `Sync Switch ${slot}`;
      this.registeredIds.push(
        this.interactables.register({
          id: interactableId,
          kind: 'syncSwitch',
          label,
          gridPos: { x: pos.x, y: pos.y },
          object3d,
          prompt: ({ entry }) => {
            const on = !!entry?.meta?.on;
            if (on) return `E: ${label} (On)`;
            return mission.state.started ? `E: ${label} (Sync)` : `E: ${label} (Start sync)`;
          },
          interact: ({ entry }) => {
            const meta = entry?.meta || {};
            if (meta.on) return { ok: true, message: 'Switch already on', state: { on: true, slot } };
            meta.on = true;
            setPowerSwitchState(object3d, true);
            return { ok: true, message: `Switch ${slot} activated`, state: { on: true, slot } };
          },
          meta: { missionId: mission.id, template: mission.template, index: i, slot, on: false }
        })
      );
      this.interactableMeta.set(interactableId, { missionId: mission.id, template: mission.template, index: i, slot });
      mission.state.switches.push({ id: interactableId, gridPos: { x: pos.x, y: pos.y }, slot, on: false, object3d });
    }

    if (mission.state.switches.length < 2) {
      this.failOpenMission(mission, 'mission object budget exhausted');
      return;
    }

    mission.state.total = mission.state.switches.length;
  }

  spawnSurviveInZone(mission, options = {}) {
    const ws = this.worldState;
    const avoid = Array.isArray(options.avoid) ? options.avoid.filter(Boolean) : [];
    const allowedRoomTypes = Array.isArray(mission.params.roomTypes) ? mission.params.roomTypes : null;

    const tiles = pickDistinctTiles(ws, 1, {
      allowedRoomTypes,
      minDistFrom: avoid,
      minDist: mission.params.minDistFromSpawn ?? 7,
      margin: 1
    });
    if (tiles.length === 0) {
      this.failOpenMission(mission, 'no valid beacon tiles');
      return;
    }
    if (!this.canSpawnMissionObject(1)) {
      this.failOpenMission(mission, 'mission object budget exhausted');
      return;
    }

    const pos = tiles[0];
    const object3d = createSensorObject({ armed: false, active: false, success: false });
    const world = gridToWorldCenter(pos);
    object3d.position.set(world.x, 0, world.z);

    this.scene.add(object3d);
    this.spawnedObjects.push(object3d);
    this.consumeMissionObjectBudget(1);

    const interactableId = `zone:${mission.id}`;
    const label = mission.params.label || 'Start hold zone';
    this.registeredIds.push(
      this.interactables.register({
        id: interactableId,
        kind: 'survivalBeacon',
        label,
        gridPos: { x: pos.x, y: pos.y },
        object3d,
        prompt: ({ entry }) => {
          const started = !!entry?.meta?.started;
          return started ? `E: ${label} (Active)` : `E: ${label}`;
        },
        interact: ({ entry }) => {
          const meta = entry?.meta || {};
          if (meta.started) return { ok: true, message: 'Zone already active', state: { started: true } };
          meta.started = true;
          setSensorState(object3d, { armed: true, active: true, success: false });
          return { ok: true, message: 'Zone started', state: { started: true } };
        },
        meta: { missionId: mission.id, template: mission.template, started: false }
      })
    );
    this.interactableMeta.set(interactableId, { missionId: mission.id, template: mission.template });

    mission.state.beaconId = interactableId;
    mission.state.beaconGridPos = { x: pos.x, y: pos.y };
  }

  spawnReroutePower(mission, options = {}) {
    const ws = this.worldState;
    const avoid = Array.isArray(options.avoid) ? options.avoid.filter(Boolean) : [];
    if (!ws) return;

    const breakerRoomTypes = Array.isArray(mission.params.roomTypesBreakers)
      ? mission.params.roomTypesBreakers
      : (Array.isArray(mission.params.roomTypesTargets)
        ? mission.params.roomTypesTargets
        : (Array.isArray(mission.params.roomTypes) ? mission.params.roomTypes : null));

    const requireClue = mission.params.requireClue !== false;
    const reservedClue = requireClue ? 1 : 0;
    const availableForBreakers = Number.isFinite(this.objectBudgetRemaining)
      ? Math.max(0, this.objectBudgetRemaining - reservedClue)
      : Infinity;

    const desired = clamp(Math.round(mission.state.total ?? mission.params.breakers ?? mission.params.switches ?? mission.params.count ?? 4), 2, 10);
    const want = Number.isFinite(availableForBreakers)
      ? Math.max(0, Math.min(desired, availableForBreakers))
      : desired;

    if (want < 2) {
      this.failOpenMission(mission, 'mission object budget exhausted');
      return;
    }

    const tiles = pickDistinctTiles(ws, want, {
      allowedRoomTypes: breakerRoomTypes,
      minDistFrom: avoid,
      minDist: mission.params.minDistFromSpawn ?? 7,
      margin: 1
    });
    if (tiles.length < 2) {
      this.failOpenMission(mission, 'no valid breaker tiles');
      return;
    }

    mission.state.breakers = [];

    for (let i = 0; i < tiles.length; i++) {
      if (!this.canSpawnMissionObject(1)) break;
      const pos = tiles[i];
      const slot = toSlotLabel(i);
      const object3d = createPowerSwitchObject(false);
      const world = gridToWorldCenter(pos);
      object3d.position.set(world.x, 0, world.z);

      this.scene.add(object3d);
      this.spawnedObjects.push(object3d);
      this.consumeMissionObjectBudget(1);

      const interactableId = `reroute:${mission.id}:${slot}`;
      const label = `Breaker ${slot}`;
      this.registeredIds.push(
        this.interactables.register({
          id: interactableId,
          kind: 'rerouteBreaker',
          label,
          gridPos: { x: pos.x, y: pos.y },
          object3d,
          maxDistance: 2.6,
          prompt: ({ entry }) => {
            const on = !!entry?.meta?.on;
            return on ? `E: ${label} (On)` : `E: ${label} (Off)`;
          },
          interact: ({ entry }) => {
            const meta = entry?.meta || {};
            if (meta.on) return { ok: true, message: 'Breaker already on', state: { on: true, slot } };
            meta.on = true;
            setPowerSwitchState(object3d, true);
            return { ok: true, message: `Breaker ${slot} engaged`, state: { on: true, slot } };
          },
          meta: { missionId: mission.id, template: mission.template, index: i, slot, on: false }
        })
      );
      this.interactableMeta.set(interactableId, { missionId: mission.id, template: mission.template, index: i, slot });
      mission.state.breakers.push({ id: interactableId, gridPos: { x: pos.x, y: pos.y }, slot, on: false, object3d });
    }

    if (mission.state.breakers.length < 2) {
      this.failOpenMission(mission, 'mission object budget exhausted');
      return;
    }

    mission.state.total = mission.state.breakers.length;

    const slots = mission.state.breakers.map((b) => String(b?.slot || '').trim()).filter(Boolean);

    const normalizeSlotsList = (raw) => {
      const values = [];
      const add = (v) => {
        const s = String(v || '').trim().toUpperCase();
        if (!s) return;
        if (!slots.includes(s)) return;
        if (values.includes(s)) return;
        values.push(s);
      };

      if (Array.isArray(raw)) {
        for (const v of raw) add(v);
      } else if (typeof raw === 'string') {
        for (const part of raw.split(/[,\s]+/)) add(part);
      }

      return values;
    };

    const rawSolution = mission.params.solutionSlots ?? mission.params.solution ?? null;
    let solutionSlots = normalizeSlotsList(rawSolution);

    if (solutionSlots.length < 1) {
      const desiredOn = clamp(Math.round(mission.state.requiredOn ?? mission.params.onCount ?? 3), 1, slots.length);
      solutionSlots = shuffleInPlace(slots.slice()).slice(0, desiredOn);
    }

    mission.state.solutionSlots = solutionSlots.slice();
    mission.state.requiredOn = solutionSlots.length;
    mission.state.powered = false;
    mission.state.failures = Math.max(0, Math.round(Number(mission.state.failures) || 0));

    if (!requireClue) {
      mission.state.clueRead = true;
      return;
    }

    if (!this.canSpawnMissionObject(1)) {
      mission.state.clueRead = true;
      return;
    }

    const clueRoomTypes = Array.isArray(mission.params.roomTypesClue)
      ? mission.params.roomTypesClue
      : (Array.isArray(mission.params.roomTypes) ? mission.params.roomTypes : null);

    const clueTiles = pickDistinctRoomTiles(ws, 1, {
      allowedRoomTypes: clueRoomTypes,
      minDistFrom: avoid.concat(tiles),
      minDist: mission.params.minDistFromSpawn ?? 6,
      margin: 1
    });

    const cluePos = clueTiles[0] || null;
    if (!cluePos) {
      mission.state.clueRead = true;
      return;
    }

    const clueObject = createClueNoteObject('A');
    const clueWorld = gridToWorldCenter(cluePos);
    clueObject.position.set(clueWorld.x, 0, clueWorld.z);
    clueObject.rotation.y = Math.random() * Math.PI * 2;

    this.scene.add(clueObject);
    this.spawnedObjects.push(clueObject);
    this.consumeMissionObjectBudget(1);

    const clueId = `rerouteClue:${mission.id}`;
    mission.state.clueId = clueId;
    mission.state.clueGridPos = { x: cluePos.x, y: cluePos.y };

    const label = 'Read Routing Note';
    this.registeredIds.push(
      this.interactables.register({
        id: clueId,
        kind: 'clueNote',
        label,
        gridPos: { x: cluePos.x, y: cluePos.y },
        object3d: clueObject,
        prompt: () => `E: ${label}`,
        interact: () => ({ ok: true, picked: true, message: 'Routing note read' }),
        meta: { missionId: mission.id, template: mission.template, clue: true }
      })
    );
    this.interactableMeta.set(clueId, { missionId: mission.id, template: mission.template, clue: true });
  }

  resetRerouteBreakers(mission) {
    if (!mission || mission.template !== 'reroutePower') return;
    const breakers = Array.isArray(mission.state.breakers) ? mission.state.breakers : [];
    for (const br of breakers) {
      if (!br?.id) continue;
      br.on = false;
      const entry = this.interactables?.get?.(br.id) || null;
      if (entry?.meta) {
        entry.meta.on = false;
      }
      const obj = entry?.object3d || br.object3d || null;
      if (obj) {
        setPowerSwitchState(obj, false);
      }
    }
  }

  resetSyncActivateSwitches(mission) {
    if (!mission || mission.template !== 'syncActivate') return;
    if (mission.state?.activated?.clear) mission.state.activated.clear();
    mission.state.started = false;
    mission.state.activeUntilSec = 0;

    const switches = Array.isArray(mission.state.switches) ? mission.state.switches : [];
    for (const sw of switches) {
      if (!sw?.id) continue;
      sw.on = false;
      const entry = this.interactables?.get?.(sw.id) || null;
      if (entry?.meta) entry.meta.on = false;
      const obj = entry?.object3d || sw.object3d || null;
      if (obj) setPowerSwitchState(obj, false);
    }
  }

  spawnShrines(mission, options = {}) {
    const ws = this.worldState;
    const avoid = Array.isArray(options.avoid) ? options.avoid.filter(Boolean) : [];
    const allowedRoomTypes = Array.isArray(mission.params.roomTypesShrines)
      ? mission.params.roomTypesShrines
      : (Array.isArray(mission.params.roomTypes) ? mission.params.roomTypes : null);

    const desired = clamp(Math.round(mission.state.total || 0), 0, 999);
    const want = Number.isFinite(this.objectBudgetRemaining)
      ? Math.max(0, Math.min(desired, this.objectBudgetRemaining))
      : desired;

    const tiles = pickDistinctTiles(ws, want, {
      allowedRoomTypes,
      minDistFrom: avoid,
      minDist: mission.params.minDistFromSpawn ?? 6,
      margin: 1
    });
    if (tiles.length === 0) {
      this.failOpenMission(mission, want <= 0 ? 'mission object budget exhausted' : 'no valid spawn tiles');
      return;
    }

    mission.state.shrines = [];
    mission.state.total = tiles.length;

    for (let i = 0; i < tiles.length; i++) {
      if (!this.canSpawnMissionObject(1)) break;
      const pos = tiles[i];
      const object3d = createPowerSwitchObject(false);
      const world = gridToWorldCenter(pos);
      object3d.position.set(world.x, 0, world.z);

      this.scene.add(object3d);
      this.spawnedObjects.push(object3d);
      this.consumeMissionObjectBudget(1);

      const interactableId = `shrine:${mission.id}:${i + 1}`;
      const label = String(mission.params.label || 'Activate Shrine').trim() || 'Activate Shrine';
      this.registeredIds.push(
        this.interactables.register({
          id: interactableId,
          kind: 'shrine',
          label,
          gridPos: { x: pos.x, y: pos.y },
          object3d,
          prompt: () => `E: ${label}`,
          interact: ({ entry }) => {
            const meta = entry?.meta || {};
            if (meta?.on) return { ok: true, message: 'Shrine already active', state: { on: true } };
            meta.on = true;
            setPowerSwitchState(object3d, true);
            return { ok: true, message: 'Shrine activated', state: { on: true } };
          },
          meta: { missionId: mission.id, template: mission.template, index: i, on: false }
        })
      );
      this.interactableMeta.set(interactableId, { missionId: mission.id, template: mission.template, index: i });
      mission.state.shrines.push({ id: interactableId, gridPos: { x: pos.x, y: pos.y }, on: false });
    }

    if (mission.state.shrines.length === 0) {
      this.failOpenMission(mission, 'mission object budget exhausted');
      return;
    }

    mission.state.total = mission.state.shrines.length;
  }

  spawnRestorePowerFuses(mission, options = {}) {
    const ws = this.worldState;
    const avoid = Array.isArray(options.avoid) ? options.avoid.filter(Boolean) : [];
    const fuseRoomTypes = Array.isArray(mission.params.roomTypesFuses)
      ? mission.params.roomTypesFuses
      : (Array.isArray(mission.params.roomTypes) ? mission.params.roomTypes : null);
    const panelRoomTypes = Array.isArray(mission.params.roomTypesPanel)
      ? mission.params.roomTypesPanel
      : (Array.isArray(mission.params.panelRoomTypes) ? mission.params.panelRoomTypes : null);

    if (!this.canSpawnMissionObject(1)) {
      this.failOpenMission(mission, 'mission object budget exhausted');
      return;
    }

    const panelTiles = pickDistinctTiles(ws, 1, {
      allowedRoomTypes: panelRoomTypes,
      minDistFrom: avoid,
      minDist: mission.params.minDistFromSpawn ?? 7,
      margin: 1
    });
    if (panelTiles.length === 0) {
      this.failOpenMission(mission, 'no valid power panel tile');
      return;
    }
    if (!this.canSpawnMissionObject(1)) {
      this.failOpenMission(mission, 'mission object budget exhausted');
      return;
    }

    const panelPos = panelTiles[0];
    const panelObject = createFusePanelObject({ installed: false, powered: false });
    const panelWorld = gridToWorldCenter(panelPos);
    panelObject.position.set(panelWorld.x, 0, panelWorld.z);
    this.scene.add(panelObject);
    this.spawnedObjects.push(panelObject);
    this.consumeMissionObjectBudget(1);

    const panelId = `panel:${mission.id}`;
    mission.state.panelId = panelId;
    mission.state.panelGridPos = { x: panelPos.x, y: panelPos.y };

    const desiredFuses = clamp(Math.round(mission.state.fusesRequired ?? mission.params.fuses ?? 3), 1, 12);
    const fusesRequired = Number.isFinite(this.objectBudgetRemaining)
      ? Math.max(0, Math.min(desiredFuses, this.objectBudgetRemaining))
      : desiredFuses;
    mission.state.fusesRequired = fusesRequired;

    const avoidForFuses = avoid.concat([panelPos]);
    const fuseTiles = pickDistinctTiles(ws, fusesRequired, {
      allowedRoomTypes: fuseRoomTypes,
      minDistFrom: avoidForFuses,
      minDist: mission.params.minDistFromSpawn ?? 7,
      margin: 1
    });
    if (fusesRequired > 0 && fuseTiles.length === 0) {
      mission.state.fusesRequired = 0;
    } else {
      mission.state.fusesRequired = fuseTiles.length;
    }

    mission.state.fuses = [];

    for (let i = 0; i < fuseTiles.length; i++) {
      if (!this.canSpawnMissionObject(1)) break;
      const pos = fuseTiles[i];
      const object3d = createFuseObject();
      const world = gridToWorldCenter(pos);
      object3d.position.set(world.x, 0, world.z);

      this.scene.add(object3d);
      this.spawnedObjects.push(object3d);
      this.consumeMissionObjectBudget(1);

      const interactableId = `fuse:${mission.id}:${i + 1}`;
      const label = 'Pick up Fuse';
      this.registeredIds.push(
        this.interactables.register({
          id: interactableId,
          kind: 'fuse',
          label,
          gridPos: { x: pos.x, y: pos.y },
          object3d,
          prompt: () => `E: ${label}`,
          interact: () => ({ ok: true, picked: true, message: 'Fuse acquired' }),
          meta: { missionId: mission.id, template: mission.template, index: i }
        })
      );
      this.interactableMeta.set(interactableId, { missionId: mission.id, template: mission.template, index: i });
      mission.state.fuses.push({ id: interactableId, gridPos: { x: pos.x, y: pos.y }, collected: false });
    }

    mission.state.fusesRequired = mission.state.fuses.length;

    const itemId = String(mission.params.itemId || 'fuse').trim() || 'fuse';
    const fuseCount = Math.max(0, Math.round(Number(mission.state.fusesRequired || 0)));

    const label = 'Power Panel';
    this.registeredIds.push(
      this.interactables.register({
        id: panelId,
        kind: 'fusePanel',
        label,
        gridPos: { x: panelPos.x, y: panelPos.y },
        object3d: panelObject,
        maxDistance: 2.6,
        consumeItem: fuseCount > 0 ? { itemId, count: fuseCount } : null,
        prompt: () => {
          if (mission.state.powered) return 'E: Power Panel (Online)';
          if (mission.state.installed) return 'E: Power Panel (Turn On)';
          const need = Math.max(0, (mission.state.fusesRequired || 0) - (mission.state.fusesCollected || 0));
          return need > 0 ? `E: Power Panel (Need ${need} fuse${need === 1 ? '' : 's'})` : 'E: Power Panel (Install Fuses)';
        },
        interact: ({ entry }) => {
          if (mission.state.powered) {
            return { ok: true, message: 'Power already restored', state: { powered: true } };
          }

          const meta = entry?.meta || {};

          if (!mission.state.installed) {
            meta.installed = true;
            if (entry) {
              entry.requiresItem = [];
              entry.consumeItem = [];
            }
            setFusePanelState(panelObject, { installed: true, powered: false });
            return { ok: true, message: 'Fuses installed', state: { installed: true } };
          }

          meta.powered = true;
          setFusePanelState(panelObject, { installed: true, powered: true });
          return { ok: true, message: 'Power restored', state: { powered: true } };
        },
        meta: { missionId: mission.id, template: mission.template, installed: false, powered: false }
      })
    );
    this.interactableMeta.set(panelId, { missionId: mission.id, template: mission.template });
  }

  spawnPowerGrid(mission, options = {}) {
    const ws = this.worldState;
    const scene = this.scene;
    if (!ws || !scene) return;

    const avoid = Array.isArray(options.avoid) ? options.avoid.filter(Boolean) : [];

    const desiredBranches = clamp(Math.round(mission.state.total ?? mission.params.branches ?? mission.params.count ?? 3), 1, 8);
    const requiredPoweredRaw = clamp(
      Math.round(mission.state.requiredPowered ?? mission.params.requiredPowered ?? mission.params.required ?? desiredBranches),
      1,
      desiredBranches
    );

    const itemId = String(mission.state.itemId || mission.params.itemId || 'fuse').trim() || 'fuse';
    mission.state.itemId = itemId;

    const minDist = mission.params.minDistFromSpawn ?? 7;
    const zoneRadius = clamp(Math.round(mission.params.zoneRadius ?? mission.params.darkRadius ?? 9), 3, 30);

    const panelRoomTypes = Array.isArray(mission.params.roomTypesPanels)
      ? mission.params.roomTypesPanels
      : (Array.isArray(mission.params.roomTypesPanel)
        ? mission.params.roomTypesPanel
        : (Array.isArray(mission.params.roomTypes) ? mission.params.roomTypes : null));

    const fuseRoomTypes = Array.isArray(mission.params.roomTypesFuses)
      ? mission.params.roomTypesFuses
      : (Array.isArray(mission.params.roomTypes) ? mission.params.roomTypes : null);

    const branchBudget = Number.isFinite(this.objectBudgetRemaining)
      ? Math.max(0, Math.min(desiredBranches, Math.floor(this.objectBudgetRemaining / 2)))
      : desiredBranches;
    const branchCount = Math.max(0, Math.min(desiredBranches, branchBudget));

    if (branchCount <= 0) {
      this.failOpenMission(mission, 'mission object budget exhausted');
      return;
    }

    const panelTiles = pickDistinctTiles(ws, branchCount, {
      allowedRoomTypes: panelRoomTypes,
      minDistFrom: avoid,
      minDist,
      margin: 1
    });

    if (panelTiles.length === 0) {
      this.failOpenMission(mission, 'no valid grid panel tiles');
      return;
    }

    const fuseTiles = pickDistinctTiles(ws, panelTiles.length, {
      allowedRoomTypes: fuseRoomTypes,
      minDistFrom: avoid.concat(panelTiles),
      minDist,
      margin: 1
    });

    const zones = Array.isArray(ws.darkZones) ? ws.darkZones : [];

    // Optional per-branch door locks (best-effort).
    const doorCandidates = [];
    if (ws.grid && ws.setObstacle && ws.isWalkable) {
      for (let y = 0; y < ws.height; y++) {
        for (let x = 0; x < ws.width; x++) {
          if (ws.grid?.[y]?.[x] !== TILE_TYPES.DOOR) continue;
          if (!ws.isWalkable(x, y)) continue;
          const pos = { x, y };
          if (avoid.some((p) => p && manhattan(p, pos) < minDist)) continue;
          doorCandidates.push(pos);
        }
      }
      shuffleInPlace(doorCandidates);
    }

    const doorsPicked = [];
    const minDoorDist = mission.params.minDoorDist ?? 6;
    const pickDoor = () => {
      for (const pos of doorCandidates) {
        if (!pos) continue;
        if (doorsPicked.some((p) => manhattan(p, pos) < minDoorDist)) continue;
        doorsPicked.push(pos);
        return pos;
      }
      return null;
    };

    const findApproachFor = (doorPos) => {
      const dirs = [
        { dx: 1, dy: 0 },
        { dx: -1, dy: 0 },
        { dx: 0, dy: 1 },
        { dx: 0, dy: -1 }
      ];
      for (const d of dirs) {
        const nx = doorPos.x + d.dx;
        const ny = doorPos.y + d.dy;
        if (ws.isWalkable?.(nx, ny)) return { x: nx, y: ny };
      }
      return { x: doorPos.x, y: doorPos.y };
    };

    mission.state.total = panelTiles.length;
    mission.state.requiredPowered = clamp(requiredPoweredRaw, 1, mission.state.total);
    mission.state.powered = 0;
    mission.state.fuses = [];
    mission.state.fusesCollected = 0;
    mission.state.branches = [];

    for (let i = 0; i < panelTiles.length; i++) {
      if (!this.canSpawnMissionObject(1)) break;
      const pos = panelTiles[i];
      const slot = toSlotLabel(i);

      const panelObject = createFusePanelObject({ installed: false, powered: false });
      const panelWorld = gridToWorldCenter(pos);
      panelObject.position.set(panelWorld.x, 0, panelWorld.z);
      scene.add(panelObject);
      this.spawnedObjects.push(panelObject);
      this.consumeMissionObjectBudget(1);

      const panelId = `gridPanel:${mission.id}:${slot}`;

      const label = `Power Node ${slot}`;
      this.registeredIds.push(
        this.interactables.register({
          id: panelId,
          kind: 'powerGridPanel',
          label,
          gridPos: { x: pos.x, y: pos.y },
          object3d: panelObject,
          maxDistance: 2.6,
          consumeItem: [{ itemId, count: 1, message: `Need ${itemId}.` }],
          prompt: ({ entry }) => {
            const meta = entry?.meta || {};
            if (meta.powered) return `E: ${label} (Online)`;
            if (meta.installed) return `E: ${label} (Turn On)`;
            return `E: ${label} (Install Fuse)`;
          },
          interact: ({ entry }) => {
            const meta = entry?.meta || {};
            if (meta.powered) return { ok: true, message: 'Already online', state: { powered: true } };

            if (!meta.installed) {
              meta.installed = true;
              if (entry) {
                entry.requiresItem = [];
                entry.consumeItem = [];
              }
              setFusePanelState(panelObject, { installed: true, powered: false });
              return { ok: true, message: 'Fuse installed', state: { installed: true } };
            }

            meta.powered = true;
            setFusePanelState(panelObject, { installed: true, powered: true });
            return { ok: true, message: 'Node online', state: { powered: true } };
          },
          meta: { missionId: mission.id, template: mission.template, index: i, slot, installed: false, powered: false }
        })
      );
      this.interactableMeta.set(panelId, { missionId: mission.id, template: mission.template, index: i, slot });

      const doorPos = pickDoor();
      let doorGridPos = null;
      let doorApproachGridPos = null;
      let doorObject3d = null;

      if (doorPos && ws.setObstacle && this.canSpawnMissionObject(1)) {
        doorGridPos = { x: doorPos.x, y: doorPos.y };
        doorApproachGridPos = findApproachFor(doorPos);
        ws.setObstacle(doorPos.x, doorPos.y, true);

        doorObject3d = createLockedDoorObject({ unlocked: false });
        const doorWorld = gridToWorldCenter(doorPos);
        doorObject3d.position.set(doorWorld.x, 0, doorWorld.z);

        const ew = (ws.isWalkable?.(doorPos.x - 1, doorPos.y) ? 1 : 0) + (ws.isWalkable?.(doorPos.x + 1, doorPos.y) ? 1 : 0);
        const ns = (ws.isWalkable?.(doorPos.x, doorPos.y - 1) ? 1 : 0) + (ws.isWalkable?.(doorPos.x, doorPos.y + 1) ? 1 : 0);
        doorObject3d.rotation.y = ew > ns ? Math.PI / 2 : 0;

        scene.add(doorObject3d);
        this.spawnedObjects.push(doorObject3d);
        this.consumeMissionObjectBudget(1);
      }

      const zoneCenter = doorPos ? gridToWorldCenter(doorPos) : panelWorld;
      const zoneId = `powerGridZone:${mission.id}:${slot}`;
      zones.push({
        id: zoneId,
        kind: 'powerGrid',
        x: zoneCenter.x,
        z: zoneCenter.z,
        radius: zoneRadius
      });

      mission.state.branches.push({
        slot,
        panelId,
        panelGridPos: { x: pos.x, y: pos.y },
        installed: false,
        powered: false,
        doorGridPos,
        doorApproachGridPos,
        doorObject3d,
        zoneId
      });
    }

    ws.darkZones = zones;

    for (let i = 0; i < fuseTiles.length; i++) {
      if (!this.canSpawnMissionObject(1)) break;
      const pos = fuseTiles[i];
      const object3d = createFuseObject();
      const world = gridToWorldCenter(pos);
      object3d.position.set(world.x, 0, world.z);

      scene.add(object3d);
      this.spawnedObjects.push(object3d);
      this.consumeMissionObjectBudget(1);

      const interactableId = `gridFuse:${mission.id}:${i + 1}`;
      const label = 'Pick up Fuse';
      this.registeredIds.push(
        this.interactables.register({
          id: interactableId,
          kind: 'fuse',
          label,
          gridPos: { x: pos.x, y: pos.y },
          object3d,
          prompt: () => `E: ${label}`,
          interact: () => ({ ok: true, picked: true, message: 'Fuse acquired' }),
          meta: { missionId: mission.id, template: mission.template, index: i, itemId }
        })
      );
      this.interactableMeta.set(interactableId, { missionId: mission.id, template: mission.template, index: i });
      mission.state.fuses.push({ id: interactableId, gridPos: { x: pos.x, y: pos.y }, collected: false });
    }
  }

  spawnUploadEvidence(mission, options = {}) {
    const ws = this.worldState;
    const avoid = Array.isArray(options.avoid) ? options.avoid.filter(Boolean) : [];
    const evidenceRoomTypes = Array.isArray(mission.params.roomTypesEvidence)
      ? mission.params.roomTypesEvidence
      : (Array.isArray(mission.params.roomTypes) ? mission.params.roomTypes : null);
    const terminalRoomTypes = Array.isArray(mission.params.roomTypesTerminal)
      ? mission.params.roomTypesTerminal
      : (Array.isArray(mission.params.terminalRoomTypes) ? mission.params.terminalRoomTypes : null);

    if (!this.canSpawnMissionObject(1)) {
      this.failOpenMission(mission, 'mission object budget exhausted');
      return;
    }

    const terminalTiles = pickDistinctTiles(ws, 1, {
      allowedRoomTypes: terminalRoomTypes,
      minDistFrom: avoid,
      minDist: mission.params.minDistFromSpawn ?? 7,
      margin: 1
    });
    if (terminalTiles.length === 0) {
      this.failOpenMission(mission, 'no valid terminal tile');
      return;
    }
    if (!this.canSpawnMissionObject(1)) {
      this.failOpenMission(mission, 'mission object budget exhausted');
      return;
    }

    const terminalPos = terminalTiles[0];
    const terminalObject = createTerminalObject({ uploaded: false });
    const terminalWorld = gridToWorldCenter(terminalPos);
    terminalObject.position.set(terminalWorld.x, 0, terminalWorld.z);
    this.scene.add(terminalObject);
    this.spawnedObjects.push(terminalObject);
    this.consumeMissionObjectBudget(1);

    const terminalId = `terminal:${mission.id}`;
    mission.state.terminalId = terminalId;
    mission.state.terminalGridPos = { x: terminalPos.x, y: terminalPos.y };

    const desired = clamp(Math.round(mission.state.total || 0), 0, 999);
    const want = Number.isFinite(this.objectBudgetRemaining)
      ? Math.max(0, Math.min(desired, this.objectBudgetRemaining))
      : desired;

    const tiles = pickDistinctTiles(ws, want, {
      allowedRoomTypes: evidenceRoomTypes,
      minDistFrom: avoid.concat([terminalPos]),
      minDist: mission.params.minDistFromSpawn ?? 6,
      margin: 1
    });

    mission.state.items = [];

    for (let i = 0; i < tiles.length; i++) {
      if (!this.canSpawnMissionObject(1)) break;
      const pos = tiles[i];
      const object3d = createEvidenceObject();
      const world = gridToWorldCenter(pos);
      object3d.position.set(world.x, 0, world.z);
      object3d.rotation.y = Math.random() * Math.PI * 2;

      this.scene.add(object3d);
      this.spawnedObjects.push(object3d);
      this.consumeMissionObjectBudget(1);

      const interactableId = `evidence:${mission.id}:${i + 1}`;
      const label = 'Collect Evidence';
      this.registeredIds.push(
        this.interactables.register({
          id: interactableId,
          kind: 'evidence',
          label,
          gridPos: { x: pos.x, y: pos.y },
          object3d,
          prompt: () => `E: ${label}`,
          interact: () => ({ ok: true, picked: true, message: 'Evidence collected' }),
          meta: { missionId: mission.id, template: mission.template, index: i }
        })
      );
      this.interactableMeta.set(interactableId, { missionId: mission.id, template: mission.template, index: i });
      mission.state.items.push({ id: interactableId, gridPos: { x: pos.x, y: pos.y }, collected: false });
    }

    mission.state.total = mission.state.items.length;
    if (mission.state.total > 0) {
      mission.state.required = clamp(Math.round(mission.state.required ?? mission.state.total), 1, mission.state.total);
    } else {
      mission.state.required = 0;
    }

    const itemId = String(mission.params.itemId || 'evidence').trim() || 'evidence';
    const requiresPower = mission.params.requiresPower === true;
    const powerItemId = String(mission.params.powerItemId || 'power_on').trim() || 'power_on';
    const uploadSeconds = clamp(Math.round(mission.state.uploadSeconds ?? mission.params.uploadSeconds ?? mission.params.seconds ?? 0), 0, 600);
    mission.state.uploadSeconds = uploadSeconds;

    const label = 'Upload Terminal';
    this.registeredIds.push(
      this.interactables.register({
        id: terminalId,
        kind: 'terminal',
        label,
        gridPos: { x: terminalPos.x, y: terminalPos.y },
        object3d: terminalObject,
        maxDistance: 2.6,
        requiresItem: [
          ...(requiresPower ? [{ itemId: powerItemId, count: 1, message: 'Power is off.' }] : []),
          ...((mission.state.required || 0) > 0 ? [{ itemId, count: mission.state.required || 0 }] : [])
        ],
        prompt: () => {
          if (mission.state.uploaded) return 'E: Terminal (Uploaded)';
          if (mission.state.uploading && uploadSeconds > 0) {
            const progress = Math.max(0, Math.min(1, (Number(mission.state.uploadProgressSec) || 0) / uploadSeconds));
            const pct = Math.round(progress * 100);
            return `E: Terminal (Uploading ${pct}%)`;
          }
          if (requiresPower) {
            const q = { itemId: powerItemId, result: null };
            this.eventBus?.emit?.(EVENTS.INVENTORY_QUERY_ITEM, q);
            const havePower = Number(q.result?.count) || 0;
            if (havePower <= 0) return 'E: Terminal (No Power)';
          }
          const required = Number(mission.state.required) || 0;
          const q = { itemId, result: null };
          this.eventBus?.emit?.(EVENTS.INVENTORY_QUERY_ITEM, q);
          const have = Number(q.result?.count) || 0;
          const missing = Math.max(0, required - have);
          if (missing > 0) return `E: Terminal (Need ${missing} evidence)`;
          return uploadSeconds > 0 ? 'E: Start Upload' : 'E: Upload Evidence';
        },
        interact: ({ entry }) => {
          if (mission.state.uploaded) {
            if (entry) {
              entry.requiresItem = [];
            }
            return { ok: true, message: 'Already uploaded', state: { uploaded: true } };
          }

          if (mission.state.uploading && uploadSeconds > 0) {
            return { ok: true, message: 'Uploading...', state: { uploading: true } };
          }

          if (uploadSeconds > 0) {
            mission.state.uploading = true;
            mission.state.uploadProgressSec = 0;
            const meta = entry?.meta || {};
            meta.uploading = true;
            return { ok: true, message: 'Upload started', state: { uploading: true } };
          }

          const meta = entry?.meta || {};
          meta.uploaded = true;
          if (entry) {
            entry.requiresItem = [];
          }
          if (this.eventBus?.emit && (mission.state.required || 0) > 0) {
            const consume = { actorKind: 'player', itemId, count: mission.state.required || 0, result: null };
            this.eventBus.emit(EVENTS.INVENTORY_CONSUME_ITEM, consume);
            if (!consume.result?.ok) {
              meta.uploaded = false;
              if (entry) entry.requiresItem = [{ itemId, count: mission.state.required || 0 }];
              return { ok: false, message: 'Missing evidence' };
            }
          }
          setTerminalState(terminalObject, { uploaded: true });
          mission.state.uploaded = true;
          return { ok: true, message: 'Evidence uploaded', state: { uploaded: true } };
        },
        meta: { missionId: mission.id, template: mission.template, uploaded: false, uploading: false }
      })
    );
    this.interactableMeta.set(terminalId, { missionId: mission.id, template: mission.template });
  }

  spawnHiddenTerminal(mission, options = {}) {
    const ws = this.worldState;
    const avoid = Array.isArray(options.avoid) ? options.avoid.filter(Boolean) : [];
    if (!ws) return;

    const allowedRoomTypes = Array.isArray(mission.params.roomTypesTarget)
      ? mission.params.roomTypesTarget
      : (Array.isArray(mission.params.roomTypes) ? mission.params.roomTypes : null);

    if (!this.canSpawnMissionObject(1)) {
      this.failOpenMission(mission, 'mission object budget exhausted');
      return;
    }

    const tiles = pickDistinctRoomTiles(ws, 1, {
      allowedRoomTypes,
      minDistFrom: avoid,
      minDist: mission.params.minDistFromSpawn ?? 8,
      margin: 1
    });
    const pos = tiles[0] || null;
    if (!pos) {
      this.failOpenMission(mission, 'no valid terminal tile');
      return;
    }

    const terminalObject = createTerminalObject({ uploaded: false });
    const terminalWorld = gridToWorldCenter(pos);
    terminalObject.position.set(terminalWorld.x, 0, terminalWorld.z);
    this.scene.add(terminalObject);
    this.spawnedObjects.push(terminalObject);
    this.consumeMissionObjectBudget(1);

    const terminalId = `hiddenTerminal:${mission.id}`;
    mission.state.terminalId = terminalId;
    mission.state.terminalGridPos = { x: pos.x, y: pos.y };
    mission.state.roomType = Number.isFinite(pos.roomType) ? pos.roomType : null;

    const label = String(mission.params.label || 'Terminal').trim() || 'Terminal';
    this.registeredIds.push(
      this.interactables.register({
        id: terminalId,
        kind: 'terminal',
        label,
        gridPos: { x: pos.x, y: pos.y },
        object3d: terminalObject,
        maxDistance: clamp(toFinite(mission.params.maxDistance, 2.6) ?? 2.6, 1.5, 8),
        prompt: () => mission.state.completed ? `E: ${label} (Complete)` : `E: Access ${label}`,
        interact: ({ entry }) => {
          if (mission.state.completed) return { ok: true, message: 'Already complete', state: { completed: true } };
          mission.state.completed = true;
          if (entry?.meta) entry.meta.completed = true;
          setTerminalState(terminalObject, { uploaded: true });
          this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: `${label} accessed.`, seconds: 1.7 });
          this.syncStatus();
          return { ok: true, message: 'Terminal accessed', state: { completed: true } };
        },
        meta: { missionId: mission.id, template: mission.template, completed: false }
      })
    );
    this.interactableMeta.set(terminalId, { missionId: mission.id, template: mission.template });
  }

  spawnScanWaypoints(mission, options = {}) {
    const ws = this.worldState;
    const avoid = Array.isArray(options.avoid) ? options.avoid.filter(Boolean) : [];
    if (!ws) return;

    const roomTypes = Array.isArray(mission.params.roomTypesTargets)
      ? mission.params.roomTypesTargets
      : (Array.isArray(mission.params.roomTypes) ? mission.params.roomTypes : null);

    const desired = clamp(Math.round(mission.state.required ?? mission.params.count ?? 4), 1, 24);
    const want = Number.isFinite(this.objectBudgetRemaining)
      ? Math.max(0, Math.min(desired, this.objectBudgetRemaining))
      : desired;
    const tiles = pickDistinctRoomTiles(ws, want, {
      allowedRoomTypes: roomTypes,
      minDistFrom: avoid,
      minDist: mission.params.minDistFromSpawn ?? 8,
      margin: 1
    });
    if (tiles.length === 0) {
      this.failOpenMission(mission, want <= 0 ? 'mission object budget exhausted' : 'no valid scan tiles');
      return;
    }

    const seconds = clamp(Math.round(mission.state.seconds ?? mission.params.seconds ?? mission.params.holdSeconds ?? 4), 1, 120);
    const radius = clamp(Math.round(mission.state.radius ?? mission.params.radius ?? 2), 0, 10);
    const label = String(mission.params.label || 'Scan Site').trim() || 'Scan Site';

    mission.state.seconds = seconds;
    mission.state.radius = radius;
    mission.state.required = tiles.length;
    mission.state.scanned = 0;
    mission.state.completed = false;
    mission.state.targets = [];

    for (let i = 0; i < tiles.length; i++) {
      if (!this.canSpawnMissionObject(1)) break;
      const pos = tiles[i];
      const object3d = createSensorObject({ armed: true, active: false, success: false });
      const world = gridToWorldCenter(pos);
      object3d.position.set(world.x, 0, world.z);
      this.scene.add(object3d);
      this.spawnedObjects.push(object3d);
      this.consumeMissionObjectBudget(1);

      const waypointId = `scanSite:${mission.id}:${i + 1}`;
      this.registeredIds.push(
        this.interactables.register({
          id: waypointId,
          kind: 'scanBeacon',
          label,
          gridPos: { x: pos.x, y: pos.y },
          object3d,
          maxDistance: 2.8,
          prompt: () => {
            const t = mission.state.targets?.[i] || null;
            const done = !!t?.completed;
            return done ? `${label} (Scanned)` : `${label} (Use camera)`;
          },
          interact: () => ({ ok: true, message: 'Use the camera to scan.' }),
          meta: { missionId: mission.id, template: mission.template, index: i }
        })
      );
      this.interactableMeta.set(waypointId, { missionId: mission.id, template: mission.template, index: i });
      mission.state.targets.push({ id: waypointId, gridPos: { x: pos.x, y: pos.y }, heldForSec: 0, completed: false });
    }

    mission.state.required = mission.state.targets.length;
    if ((mission.state.required || 0) <= 0) {
      this.failOpenMission(mission, 'mission object budget exhausted');
    }
  }

  spawnBlackoutZones(mission, options = {}) {
    const ws = this.worldState;
    const scene = this.scene;
    if (!ws || !scene) return;

    const avoid = Array.isArray(options.avoid) ? options.avoid.filter(Boolean) : [];
    const allowedRoomTypes = Array.isArray(mission.params.roomTypes) ? mission.params.roomTypes : null;

    const desired = clamp(Math.round(mission.state.total || 0), 1, 99);
    const want = Number.isFinite(this.objectBudgetRemaining)
      ? Math.max(0, Math.min(desired, this.objectBudgetRemaining))
      : desired;

    const tiles = pickDistinctTiles(ws, want, {
      allowedRoomTypes,
      minDistFrom: avoid,
      minDist: mission.params.minDistFromSpawn ?? 7,
      margin: 1
    });
    if (tiles.length === 0) {
      this.failOpenMission(mission, 'no valid blackout tiles');
      return;
    }

    const radius = clamp(Math.round(mission.state.radius ?? mission.params.radius ?? mission.params.zoneRadius ?? 9), 3, 30);
    mission.state.radius = radius;
    mission.state.zones = [];

    const zones = Array.isArray(ws.darkZones) ? ws.darkZones : [];

    for (let i = 0; i < tiles.length; i++) {
      if (!this.canSpawnMissionObject(1)) break;
      const pos = tiles[i];
      const world = gridToWorldCenter(pos);
      const zoneId = `blackout:${mission.id}:${i + 1}`;

      zones.push({
        id: zoneId,
        kind: 'blackout',
        x: world.x,
        z: world.z,
        radius
      });

      const object3d = createPowerSwitchObject(false);
      object3d.position.set(world.x, 0, world.z);
      scene.add(object3d);
      this.spawnedObjects.push(object3d);
      this.consumeMissionObjectBudget(1);

      const interactableId = `blackoutSwitch:${mission.id}:${i + 1}`;
      const label = `Restore Lights (${i + 1})`;
      this.registeredIds.push(
        this.interactables.register({
          id: interactableId,
          kind: 'blackoutSwitch',
          label,
          gridPos: { x: pos.x, y: pos.y },
          object3d,
          prompt: ({ entry }) => {
            const restored = !!entry?.meta?.restored;
            return restored ? `E: ${label} (Restored)` : `E: ${label}`;
          },
          interact: ({ entry }) => {
            const meta = entry?.meta || {};
            if (meta.restored) return { ok: true, message: 'Already restored', state: { restored: true } };
            meta.restored = true;
            setPowerSwitchState(object3d, true);
            return { ok: true, message: 'Lights restored', state: { restored: true } };
          },
          meta: { missionId: mission.id, template: mission.template, index: i, zoneId, restored: false }
        })
      );
      this.interactableMeta.set(interactableId, { missionId: mission.id, template: mission.template, index: i, zoneId });
      mission.state.zones.push({
        id: interactableId,
        zoneId,
        gridPos: { x: pos.x, y: pos.y },
        restored: false
      });
    }

    ws.darkZones = zones;

    mission.state.total = mission.state.zones.length;
    mission.state.required = clamp(Math.round(mission.state.required ?? mission.state.total), 1, mission.state.total);

    if (mission.state.total <= 0) {
      this.failOpenMission(mission, 'mission object budget exhausted');
    }
  }

  spawnCodeLock(mission, options = {}) {
    const ws = this.worldState;
    const avoid = Array.isArray(options.avoid) ? options.avoid.filter(Boolean) : [];
    const clueRoomTypes = Array.isArray(mission.params.roomTypesClues)
      ? mission.params.roomTypesClues
      : (Array.isArray(mission.params.roomTypes) ? mission.params.roomTypes : null);
    const keypadRoomTypes = Array.isArray(mission.params.roomTypesKeypad)
      ? mission.params.roomTypesKeypad
      : (Array.isArray(mission.params.keypadRoomTypes) ? mission.params.keypadRoomTypes : null);

    const requiresPower = mission.params.requiresPower === true;
    const powerItemId = String(mission.params.powerItemId || 'power_on').trim() || 'power_on';

    if (!this.canSpawnMissionObject(2)) {
      this.failOpenMission(mission, 'mission object budget exhausted');
      return;
    }

    const desiredClueCount = clamp(Math.round(mission.state.cluesTotal ?? 3), 2, 6);
    const clueBudget = Number.isFinite(this.objectBudgetRemaining)
      ? Math.max(0, this.objectBudgetRemaining - 1) // reserve 1 for keypad
      : desiredClueCount;
    let clueCount = Number.isFinite(clueBudget)
      ? clamp(desiredClueCount, 1, Math.max(1, Math.min(6, clueBudget)))
      : desiredClueCount;

    const clueTiles = pickDistinctTiles(ws, clueCount, {
      allowedRoomTypes: clueRoomTypes,
      minDistFrom: avoid,
      minDist: mission.params.minDistFromSpawn ?? 7,
      margin: 1
    });
    if (clueTiles.length === 0) {
      this.failOpenMission(mission, 'no valid clue tiles');
      return;
    }
    clueCount = clueTiles.length;
    mission.state.cluesTotal = clueCount;

    const avoidForKeypad = avoid.concat(clueTiles);
    const keypadTiles = pickDistinctTiles(ws, 1, {
      allowedRoomTypes: keypadRoomTypes,
      minDistFrom: avoidForKeypad,
      minDist: mission.params.minDistFromSpawn ?? 7,
      margin: 1
    });
    if (keypadTiles.length === 0) {
      this.failOpenMission(mission, 'no valid keypad tile');
      return;
    }

    const digits = shuffleInPlace(Array.from({ length: 10 }, (_, i) => i)).slice(0, clueCount);

    mission.state.clues = [];

    for (let i = 0; i < clueTiles.length; i++) {
      if (!this.canSpawnMissionObject(1)) break;
      const pos = clueTiles[i];
      const slot = toSlotLabel(i);
      const digit = digits[i] ?? Math.floor(Math.random() * 10);

      const object3d = createClueNoteObject(slot);
      const world = gridToWorldCenter(pos);
      object3d.position.set(world.x, 0, world.z);

      this.scene.add(object3d);
      this.spawnedObjects.push(object3d);
      this.consumeMissionObjectBudget(1);

      const interactableId = `clue:${mission.id}:${slot}`;
      const label = 'Read Note';
      this.registeredIds.push(
        this.interactables.register({
          id: interactableId,
          kind: 'clue',
          label,
          gridPos: { x: pos.x, y: pos.y },
          object3d,
          prompt: () => `E: ${label}`,
          interact: () => ({ ok: true, picked: true, message: `Clue ${slot}: ${digit}` }),
          meta: { missionId: mission.id, template: mission.template, index: i, slot, digit }
        })
      );
      this.interactableMeta.set(interactableId, { missionId: mission.id, template: mission.template, index: i, slot, digit });
      mission.state.clues.push({ id: interactableId, gridPos: { x: pos.x, y: pos.y }, slot, digit, collected: false });
    }

    mission.state.cluesTotal = mission.state.clues.length;
    if (mission.state.cluesTotal <= 0) {
      this.failOpenMission(mission, 'mission object budget exhausted');
      return;
    }

    if (!this.canSpawnMissionObject(1)) {
      this.failOpenMission(mission, 'mission object budget exhausted');
      return;
    }

    const keypadPos = keypadTiles[0];
    const keypadObject = createKeypadObject(false);
    const keypadWorld = gridToWorldCenter(keypadPos);
    keypadObject.position.set(keypadWorld.x, 0, keypadWorld.z);
    this.scene.add(keypadObject);
    this.spawnedObjects.push(keypadObject);
    this.consumeMissionObjectBudget(1);

    const keypadId = `keypad:${mission.id}`;
    mission.state.keypadId = keypadId;
    mission.state.keypadGridPos = { x: keypadPos.x, y: keypadPos.y };

    const label = 'Keypad';
    this.registeredIds.push(
      this.interactables.register({
        id: keypadId,
        kind: 'keypad',
        label,
        gridPos: { x: keypadPos.x, y: keypadPos.y },
        object3d: keypadObject,
        maxDistance: 2.6,
        requiresItem: requiresPower ? { itemId: powerItemId, count: 1, message: 'Power is off.' } : null,
        prompt: () => {
          const ready = !!mission.state.codeReady;
          const unlocked = !!mission.state.unlocked;
          if (unlocked) return 'E: Keypad (Unlocked)';
          if (requiresPower) {
            const q = { itemId: powerItemId, result: null };
            this.eventBus?.emit?.(EVENTS.INVENTORY_QUERY_ITEM, q);
            const havePower = Number(q.result?.count) || 0;
            if (havePower <= 0) return 'E: Keypad (No Power)';
          }
          return ready ? 'E: Keypad (Enter Code)' : 'E: Keypad (Locked)';
        },
        interact: ({ entry, actorKind }) => {
          if (mission.state.unlocked) return { ok: true, message: 'Keypad already unlocked', state: { unlocked: true } };
          if (!mission.state.codeReady) return { ok: false, message: 'Keypad locked (missing clues)' };

          if (actorKind === 'player') {
            const codeLength = String(mission.state.code || '').length || Number(mission.state.cluesTotal) || 3;
            return {
              ok: true,
              message: 'Enter code',
              openKeypad: true,
              keypadId,
              codeLength
            };
          }

          const meta = entry?.meta || {};
          meta.unlocked = true;
          setKeypadState(keypadObject, true);
          return { ok: true, message: 'Keypad unlocked', state: { unlocked: true } };
        },
        meta: { missionId: mission.id, template: mission.template, unlocked: false }
      })
    );
    this.interactableMeta.set(keypadId, { missionId: mission.id, template: mission.template });
  }

  spawnCodeLockScan(mission, options = {}) {
    this.spawnCodeLock(mission, options);
    if (mission.state.unlocked) return;

    const ws = this.worldState;
    if (!ws) return;

    const avoid = Array.isArray(options.avoid) ? options.avoid.filter(Boolean) : [];
    const sampleRoomTypes = Array.isArray(mission.params.roomTypesSample)
      ? mission.params.roomTypesSample
      : (Array.isArray(mission.params.roomTypesTargets)
        ? mission.params.roomTypesTargets
        : (Array.isArray(mission.params.roomTypes) ? mission.params.roomTypes : null));

    const desired = clamp(Math.round(mission.state.scanRequired ?? mission.params.sampleCount ?? mission.params.scanCount ?? 1), 1, 6);
    const want = Number.isFinite(this.objectBudgetRemaining)
      ? Math.max(0, Math.min(desired, this.objectBudgetRemaining))
      : desired;
    if (want <= 0) return;

    const tiles = pickDistinctTiles(ws, want, {
      allowedRoomTypes: sampleRoomTypes,
      minDistFrom: avoid.concat([mission.state.keypadGridPos].filter(Boolean)),
      minDist: mission.params.minDistFromSpawn ?? 7,
      margin: 1
    });
    if (tiles.length === 0) {
      // Keep the mission solvable: treat "scan step" as already satisfied if no targets could be spawned.
      mission.state.scanRequired = 0;
      mission.state.scanned = 0;
      mission.state.scanTargets = [];
      return;
    }

    const seconds = clamp(Math.round(mission.state.scanSeconds ?? mission.params.sampleSeconds ?? mission.params.scanSeconds ?? mission.params.holdSeconds ?? 4), 1, 60);
    mission.state.scanSeconds = seconds;
    mission.state.scanTargets = [];

    const maxDistance = clamp(toFinite(mission.params.sampleMaxDistance ?? mission.params.maxDistance, 3.6) ?? 3.6, 1.5, 10);
    const aimMinDotParam = toFinite(mission.params.sampleAimMinDot ?? mission.params.aimMinDot, null);
    const aimAngleDeg = clamp(toFinite(mission.params.sampleAimAngleDeg ?? mission.params.aimAngleDeg, 14) ?? 14, 5, 60);
    const aimMinDot = Number.isFinite(aimMinDotParam)
      ? clamp(aimMinDotParam, 0.2, 0.9999)
      : Math.cos((aimAngleDeg * Math.PI) / 180);
    const aimOffsetY = clamp(toFinite(mission.params.sampleAimOffsetY ?? mission.params.aimOffsetY, 0.9) ?? 0.9, 0, 2.5);

    for (let i = 0; i < tiles.length; i++) {
      if (!this.canSpawnMissionObject(1)) break;
      const pos = tiles[i];
      const object3d = createPhotoTargetObject();
      const world = gridToWorldCenter(pos);
      object3d.position.set(world.x, 0, world.z);
      object3d.rotation.y = Math.random() * Math.PI * 2;
      object3d.visible = false;

      this.scene.add(object3d);
      this.spawnedObjects.push(object3d);
      this.consumeMissionObjectBudget(1);

      const interactableId = `sample:${mission.id}:${i + 1}`;
      const label = 'Collect Sample';
      this.registeredIds.push(
        this.interactables.register({
          id: interactableId,
          kind: 'scanTarget',
          label,
          enabled: false,
          gridPos: { x: pos.x, y: pos.y },
          object3d,
          maxDistance,
          prompt: () => `Hold aim to sample (${seconds}s)`,
          interact: () => ({ ok: true, message: 'Hold aim to sample' }),
          meta: {
            missionId: mission.id,
            template: mission.template,
            index: i,
            aimMinDot,
            aimOffsetY,
            seconds,
            maxDistance
          }
        })
      );
      this.interactableMeta.set(interactableId, { missionId: mission.id, template: mission.template, index: i });
      mission.state.scanTargets.push({ id: interactableId, gridPos: { x: pos.x, y: pos.y }, heldForSec: 0, completed: false });
    }

    mission.state.scanRequired = mission.state.scanTargets.length;
    mission.state.scanned = 0;
  }

  spawnLockedDoor(mission, options = {}) {
    const ws = this.worldState;
    const avoid = Array.isArray(options.avoid) ? options.avoid.filter(Boolean) : [];
    if (!ws?.grid || !ws?.setObstacle) return;
    if (!this.canSpawnMissionObject(2)) {
      this.failOpenMission(mission, 'mission object budget exhausted');
      return;
    }

    const minDist = mission.params.minDistFromSpawn ?? 7;
    const candidates = [];
    for (let y = 0; y < ws.height; y++) {
      for (let x = 0; x < ws.width; x++) {
        if (ws.grid?.[y]?.[x] !== TILE_TYPES.DOOR) continue;
        if (!ws.isWalkable?.(x, y)) continue;
        const pos = { x, y };
        if (avoid.some((p) => p && manhattan(p, pos) < minDist)) continue;
        candidates.push(pos);
      }
    }

    const fallbackDoor = pickDistinctTiles(ws, 1, {
      allowedRoomTypes: Array.isArray(mission.params.roomTypesDoor) ? mission.params.roomTypesDoor : null,
      minDistFrom: avoid,
      minDist,
      margin: 0
    });

    const doorPos = candidates.length > 0
      ? candidates[Math.floor(Math.random() * candidates.length)]
      : (fallbackDoor[0] || null);
    if (!doorPos) {
      this.failOpenMission(mission, 'no valid door tile');
      return;
    }

    const findApproach = () => {
      const dirs = [
        { dx: 1, dy: 0 },
        { dx: -1, dy: 0 },
        { dx: 0, dy: 1 },
        { dx: 0, dy: -1 }
      ];
      for (const d of dirs) {
        const nx = doorPos.x + d.dx;
        const ny = doorPos.y + d.dy;
        if (ws.isWalkable?.(nx, ny)) return { x: nx, y: ny };
      }
      return doorPos;
    };

    const approachPos = findApproach();

    // Block the tile until unlocked (affects pathing + movement).
    ws.setObstacle(doorPos.x, doorPos.y, true);

    const keyItemId = String(mission.state.keyItemId || 'door_key').trim() || 'door_key';
    const consumeKey = mission.params.consumeKey !== false;

    const keyRoomTypes = Array.isArray(mission.params.roomTypesKey)
      ? mission.params.roomTypesKey
      : (Array.isArray(mission.params.roomTypes) ? mission.params.roomTypes : null);

    const spawnPos = ws.getSpawnPoint?.() || avoid[0] || null;
    const reachable = new Set();
    if (spawnPos && Number.isFinite(spawnPos.x) && Number.isFinite(spawnPos.y)) {
      const q = [{ x: spawnPos.x, y: spawnPos.y }];
      const dirs = [
        { dx: 1, dy: 0 },
        { dx: -1, dy: 0 },
        { dx: 0, dy: 1 },
        { dx: 0, dy: -1 }
      ];
      while (q.length > 0) {
        const cur = q.pop();
        const key = `${cur.x},${cur.y}`;
        if (reachable.has(key)) continue;
        if (!ws.isWalkable?.(cur.x, cur.y)) continue;
        reachable.add(key);
        for (const d of dirs) {
          q.push({ x: cur.x + d.dx, y: cur.y + d.dy });
        }
      }
    }

    const keyTiles = pickDistinctTiles(ws, 12, {
      allowedRoomTypes: keyRoomTypes,
      minDistFrom: avoid.concat([doorPos]),
      minDist,
      margin: 1
    });

    const keyPos = (reachable.size > 0
      ? keyTiles.find((t) => reachable.has(`${t.x},${t.y}`))
      : null) || keyTiles[0] || null;

    if (!keyPos) {
      ws.setObstacle(doorPos.x, doorPos.y, false);
      this.failOpenMission(mission, 'failed to place a key');
      return;
    }

    const doorObject = createLockedDoorObject({ unlocked: false });
    const doorWorld = gridToWorldCenter(doorPos);
    doorObject.position.set(doorWorld.x, 0, doorWorld.z);

    // Align door plane with corridor axis (best-effort).
    const ew = (ws.isWalkable?.(doorPos.x - 1, doorPos.y) ? 1 : 0) + (ws.isWalkable?.(doorPos.x + 1, doorPos.y) ? 1 : 0);
    const ns = (ws.isWalkable?.(doorPos.x, doorPos.y - 1) ? 1 : 0) + (ws.isWalkable?.(doorPos.x, doorPos.y + 1) ? 1 : 0);
    doorObject.rotation.y = ew > ns ? Math.PI / 2 : 0;

    this.scene.add(doorObject);
    this.spawnedObjects.push(doorObject);
    this.consumeMissionObjectBudget(1);

    const doorId = `lockedDoor:${mission.id}`;
    mission.state.doorId = doorId;
    mission.state.doorGridPos = { x: doorPos.x, y: doorPos.y };
    mission.state.doorApproachGridPos = { x: approachPos.x, y: approachPos.y };

    const label = 'Unlock Door';
    this.registeredIds.push(
      this.interactables.register({
        id: doorId,
        kind: 'lockedDoor',
        label,
        gridPos: { x: doorPos.x, y: doorPos.y },
        object3d: doorObject,
        maxDistance: 2.7,
        requiresItem: { itemId: keyItemId, count: 1, message: 'Need a key.' },
        consumeItem: consumeKey ? true : null,
        prompt: () => mission.state.unlocked ? 'E: Door (Unlocked)' : `E: ${label}`,
        interact: ({ entry }) => {
          if (mission.state.unlocked) {
            if (entry) {
              entry.requiresItem = [];
              entry.consumeItem = [];
            }
            return { ok: true, message: 'Door is already unlocked', state: { unlocked: true } };
          }

          mission.state.unlocked = true;
          ws.setObstacle(doorPos.x, doorPos.y, false);
          setLockedDoorState(doorObject, { unlocked: true });
          if (entry) {
            entry.requiresItem = [];
            entry.consumeItem = [];
          }
          return { ok: true, message: 'Door unlocked', state: { unlocked: true } };
        },
        meta: { missionId: mission.id, template: mission.template, unlocked: false }
      })
    );
    this.interactableMeta.set(doorId, { missionId: mission.id, template: mission.template });

    const keyObject = createKeycardObject();
    const keyWorld = gridToWorldCenter(keyPos);
    keyObject.position.set(keyWorld.x, 0, keyWorld.z);
    keyObject.rotation.y = Math.random() * Math.PI * 2;

    this.scene.add(keyObject);
    this.spawnedObjects.push(keyObject);
    this.consumeMissionObjectBudget(1);

    const keyId = `key:${mission.id}`;
    mission.state.keyId = keyId;
    mission.state.keyGridPos = { x: keyPos.x, y: keyPos.y };

    const keyLabel = 'Pick Up Key';
    this.registeredIds.push(
      this.interactables.register({
        id: keyId,
        kind: 'key',
        label: keyLabel,
        gridPos: { x: keyPos.x, y: keyPos.y },
        object3d: keyObject,
        prompt: () => `E: ${keyLabel}`,
        interact: () => ({ ok: true, picked: true, message: 'Key acquired' }),
        meta: { missionId: mission.id, template: mission.template, itemId: keyItemId }
      })
    );
    this.interactableMeta.set(keyId, { missionId: mission.id, template: mission.template });
  }

  spawnDoorLockNetwork(mission, options = {}) {
    const ws = this.worldState;
    const avoid = Array.isArray(options.avoid) ? options.avoid.filter(Boolean) : [];
    if (!ws?.grid || !ws?.setObstacle) return;

    const rawDoors = Array.isArray(mission.params.doors) ? mission.params.doors : null;
    if (!rawDoors || rawDoors.length === 0) {
      this.failOpenMission(mission, 'no doors configured');
      return;
    }

    const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
    const defs = [];
    for (let i = 0; i < rawDoors.length; i++) {
      const raw = rawDoors[i];
      if (!isPlainObject(raw)) continue;

      const slotRaw = String(raw.slot || raw.id || '').trim();
      const slot = (slotRaw || toSlotLabel(i)).trim().toUpperCase();
      const labelRaw = String(raw.label || '').trim();
      const label = labelRaw || `Unlock Door ${slot}`;

      const requiresMissionId = String(raw.requiresMissionId || raw.missionId || raw.requiresMission || '').trim() || null;
      const hintMissionId = String(raw.hintMissionId || raw.prereqMissionId || requiresMissionId || '').trim() || null;

      const requiresItem = raw.requiresItem ?? null;
      const consumeItem = raw.consumeItem === true ? true : (raw.consumeItem ? raw.consumeItem : null);

      const lockedMessage = String(raw.lockedMessage || raw.messageLocked || '').trim();

      defs.push({
        slot,
        label,
        requiresMissionId,
        hintMissionId,
        requiresItem,
        consumeItem,
        lockedMessage
      });
    }

    if (defs.length === 0) {
      this.failOpenMission(mission, 'no valid door entries');
      return;
    }

    const doorBudget = Number.isFinite(this.objectBudgetRemaining)
      ? Math.max(0, Math.min(defs.length, this.objectBudgetRemaining))
      : defs.length;
    const doorCount = Math.max(0, Math.min(defs.length, doorBudget));

    if (doorCount <= 0) {
      this.failOpenMission(mission, 'mission object budget exhausted');
      return;
    }

    const minDist = mission.params.minDistFromSpawn ?? 7;
    const minDoorDist = mission.params.minDoorDist ?? 6;

    const candidates = [];
    for (let y = 0; y < ws.height; y++) {
      for (let x = 0; x < ws.width; x++) {
        if (ws.grid?.[y]?.[x] !== TILE_TYPES.DOOR) continue;
        if (!ws.isWalkable?.(x, y)) continue;
        const pos = { x, y };
        if (avoid.some((p) => p && manhattan(p, pos) < minDist)) continue;
        candidates.push(pos);
      }
    }

    shuffleInPlace(candidates);

    const picked = [];
    const farEnough = (pos) => picked.every((p) => manhattan(p, pos) >= minDoorDist);
    for (const pos of candidates) {
      if (picked.length >= doorCount) break;
      if (!farEnough(pos)) continue;
      picked.push(pos);
    }

    if (picked.length < doorCount) {
      const fallback = pickDistinctTiles(ws, doorCount - picked.length, {
        allowedRoomTypes: Array.isArray(mission.params.roomTypesDoor)
          ? mission.params.roomTypesDoor
          : [ROOM_TYPES.CORRIDOR],
        minDistFrom: avoid.concat(picked),
        minDist,
        margin: 0
      });
      for (const pos of fallback) {
        if (picked.length >= doorCount) break;
        if (!pos) continue;
        if (!farEnough(pos)) continue;
        picked.push({ x: pos.x, y: pos.y });
      }
    }

    if (picked.length === 0) {
      this.failOpenMission(mission, 'no valid door tiles');
      return;
    }

    const findApproachFor = (doorPos) => {
      const dirs = [
        { dx: 1, dy: 0 },
        { dx: -1, dy: 0 },
        { dx: 0, dy: 1 },
        { dx: 0, dy: -1 }
      ];
      for (const d of dirs) {
        const nx = doorPos.x + d.dx;
        const ny = doorPos.y + d.dy;
        if (ws.isWalkable?.(nx, ny)) return { x: nx, y: ny };
      }
      return doorPos;
    };

    mission.state.total = picked.length;
    mission.state.unlocked = 0;
    mission.state.doors = [];
    mission.state.lastBlockedDoor = null;

    for (let i = 0; i < picked.length; i++) {
      if (!this.canSpawnMissionObject(1)) break;
      const doorPos = picked[i];
      const def = defs[i] || { slot: toSlotLabel(i), label: `Unlock Door ${toSlotLabel(i)}` };
      const approachPos = findApproachFor(doorPos);

      // Block the tile until unlocked (affects pathing + movement).
      ws.setObstacle(doorPos.x, doorPos.y, true);

      const doorObject = createLockedDoorObject({ unlocked: false });
      const doorWorld = gridToWorldCenter(doorPos);
      doorObject.position.set(doorWorld.x, 0, doorWorld.z);

      // Align door plane with corridor axis (best-effort).
      const ew = (ws.isWalkable?.(doorPos.x - 1, doorPos.y) ? 1 : 0) + (ws.isWalkable?.(doorPos.x + 1, doorPos.y) ? 1 : 0);
      const ns = (ws.isWalkable?.(doorPos.x, doorPos.y - 1) ? 1 : 0) + (ws.isWalkable?.(doorPos.x, doorPos.y + 1) ? 1 : 0);
      doorObject.rotation.y = ew > ns ? Math.PI / 2 : 0;

      this.scene.add(doorObject);
      this.spawnedObjects.push(doorObject);
      this.consumeMissionObjectBudget(1);

      const slot = String(def.slot || toSlotLabel(i)).trim().toUpperCase() || toSlotLabel(i);
      const doorId = `networkDoor:${mission.id}:${slot}`;

      const doorState = {
        id: doorId,
        slot,
        unlocked: false,
        doorGridPos: { x: doorPos.x, y: doorPos.y },
        doorApproachGridPos: { x: approachPos.x, y: approachPos.y },
        requiresMissionId: def.requiresMissionId || null,
        hintMissionId: def.hintMissionId || null,
        object3d: doorObject
      };
      mission.state.doors.push(doorState);

      const lockedMessage = def.lockedMessage || 'Door is locked.';
      const requiresMissionId = def.requiresMissionId || null;

      this.registeredIds.push(
        this.interactables.register({
          id: doorId,
          kind: 'networkDoor',
          label: def.label || `Unlock Door ${slot}`,
          gridPos: { x: doorPos.x, y: doorPos.y },
          object3d: doorObject,
          maxDistance: 2.7,
          requiresItem: def.requiresItem || null,
          consumeItem: def.consumeItem || null,
          prompt: () => {
            const door = mission.state.doors?.[i] || null;
            if (door?.unlocked) return `E: Door ${slot} (Unlocked)`;
            return `E: ${def.label || `Unlock Door ${slot}`}`;
          },
          interact: ({ entry }) => {
            const door = mission.state.doors?.[i] || null;
            if (!door) return { ok: false, message: 'Door error' };

            if (door.unlocked) {
              if (entry) {
                entry.requiresItem = [];
                entry.consumeItem = [];
              }
              return { ok: true, message: 'Door already unlocked', state: { unlocked: true } };
            }

            if (requiresMissionId) {
              const prereq = this.missions.get(requiresMissionId) || null;
              if (prereq && !this.isMissionComplete(prereq)) {
                mission.state.lastBlockedDoor = { doorId, slot, reason: 'mission', missionId: requiresMissionId };
                return { ok: false, message: lockedMessage, state: { unlocked: false, blocked: true, reason: 'mission', missionId: requiresMissionId } };
              }
            }

            door.unlocked = true;
            ws.setObstacle(doorPos.x, doorPos.y, false);
            setLockedDoorState(doorObject, { unlocked: true });
            this.eventBus?.emit?.(EVENTS.NOISE_REQUESTED, {
              kind: 'door_unlock',
              position: doorObject?.position ? doorObject.position.clone() : null,
              radius: Math.max(4, Number(CONFIG.AI_NOISE_DOOR_RADIUS) || 12),
              ttl: Math.max(0.1, Number(CONFIG.AI_NOISE_DOOR_TTL) || 0.9),
              strength: Math.max(0.05, Number(CONFIG.AI_NOISE_DOOR_STRENGTH) || 0.85),
              source: 'door'
            });

            if (entry) {
              entry.requiresItem = [];
              entry.consumeItem = [];
            }

            const unlockedCount = mission.state.doors.filter((d) => d?.unlocked).length;
            mission.state.unlocked = unlockedCount;
            mission.state.lastBlockedDoor = null;

            return { ok: true, message: `Door ${slot} unlocked`, state: { unlocked: true } };
          },
          meta: {
            missionId: mission.id,
            template: mission.template,
            index: i,
            slot,
            requiresMissionId: def.requiresMissionId || null,
            hintMissionId: def.hintMissionId || null
          }
        })
      );
      this.interactableMeta.set(doorId, { missionId: mission.id, template: mission.template, index: i, slot });
    }

    mission.state.total = mission.state.doors.length;
    mission.state.unlocked = mission.state.doors.filter((d) => d?.unlocked).length;

    if (mission.state.total <= 0) {
      this.failOpenMission(mission, 'mission object budget exhausted');
    }
  }

  spawnPlaceKeysAtLocks(mission, options = {}) {
    const ws = this.worldState;
    const avoid = Array.isArray(options.avoid) ? options.avoid.filter(Boolean) : [];
    if (!ws) return;

    const desired = clamp(Math.round(mission.state.required ?? mission.params.keys ?? mission.params.items ?? mission.params.count ?? 3), 1, 24);
    const pairBudget = Number.isFinite(this.objectBudgetRemaining)
      ? Math.max(0, Math.floor(this.objectBudgetRemaining / 2))
      : desired;
    const pairCount = Math.max(0, Math.min(desired, pairBudget));
    const minDist = mission.params.minDistFromSpawn ?? 7;

    if (pairCount <= 0) {
      this.failOpenMission(mission, 'mission object budget exhausted');
      return;
    }

    const keyRoomTypes = Array.isArray(mission.params.roomTypesKeys)
      ? mission.params.roomTypesKeys
      : (Array.isArray(mission.params.roomTypesItems)
        ? mission.params.roomTypesItems
        : (Array.isArray(mission.params.roomTypes) ? mission.params.roomTypes : null));

    const lockRoomTypes = Array.isArray(mission.params.roomTypesLocks)
      ? mission.params.roomTypesLocks
      : (Array.isArray(mission.params.roomTypesTargets)
        ? mission.params.roomTypesTargets
        : (Array.isArray(mission.params.roomTypes) ? mission.params.roomTypes : null));

    const keyTiles = pickDistinctRoomTiles(ws, pairCount, {
      allowedRoomTypes: keyRoomTypes,
      minDistFrom: avoid,
      minDist,
      margin: 1
    });
    if (keyTiles.length === 0) {
      this.failOpenMission(mission, 'no valid key tiles');
      return;
    }

    const lockTiles = pickDistinctRoomTiles(ws, keyTiles.length, {
      allowedRoomTypes: lockRoomTypes,
      minDistFrom: avoid.concat(keyTiles),
      minDist,
      margin: 1
    });
    if (lockTiles.length === 0) {
      this.failOpenMission(mission, 'no valid lock tiles');
      return;
    }

    const rawItemIds = Array.isArray(mission.params.itemIds) ? mission.params.itemIds : null;
    const itemIds = [];
    for (const entry of rawItemIds || []) {
      const id = String(entry || '').trim();
      if (!id) continue;
      if (itemIds.includes(id)) continue;
      itemIds.push(id);
    }

    const finalCount = Math.max(0, Math.min(keyTiles.length, lockTiles.length, pairCount, itemIds.length > 0 ? itemIds.length : pairCount));
    if (finalCount <= 0 || !this.canSpawnMissionObject(finalCount * 2)) {
      this.failOpenMission(mission, 'mission object budget exhausted');
      return;
    }

    // Generate stable per-mission ids if not provided.
    while (itemIds.length < finalCount) {
      const slot = toSlotLabel(itemIds.length);
      itemIds.push(`${mission.id}_key_${slot.toLowerCase()}`);
    }

    mission.state.required = finalCount;
    mission.state.keysCollected = 0;
    mission.state.locksFilled = 0;
    mission.state.itemIds = itemIds.slice(0, finalCount);
    mission.state.keys = [];
    mission.state.locks = [];

    for (let i = 0; i < finalCount; i++) {
      const pos = keyTiles[i];
      const slot = toSlotLabel(i);
      const itemId = mission.state.itemIds[i];

      const object3d = createKeycardObject();
      const world = gridToWorldCenter(pos);
      object3d.position.set(world.x, 0, world.z);
      object3d.rotation.y = Math.random() * Math.PI * 2;

      this.scene.add(object3d);
      this.spawnedObjects.push(object3d);
      this.consumeMissionObjectBudget(1);

      const keyId = `lockKey:${mission.id}:${slot}`;
      const label = `Pick Up Key ${slot}`;
      this.registeredIds.push(
        this.interactables.register({
          id: keyId,
          kind: 'keyItem',
          label,
          gridPos: { x: pos.x, y: pos.y },
          object3d,
          prompt: () => `E: ${label}`,
          interact: () => ({ ok: true, picked: true, message: `Key ${slot} acquired` }),
          meta: { missionId: mission.id, template: mission.template, index: i, slot, itemId }
        })
      );
      this.interactableMeta.set(keyId, { missionId: mission.id, template: mission.template, index: i, slot, itemId });
      mission.state.keys.push({ id: keyId, gridPos: { x: pos.x, y: pos.y }, collected: false, slot, itemId });
    }

    for (let i = 0; i < finalCount; i++) {
      const pos = lockTiles[i];
      const slot = toSlotLabel(i);
      const itemId = mission.state.itemIds[i];

      const object3d = createAltarObject({ filled: false });
      const world = gridToWorldCenter(pos);
      object3d.position.set(world.x, 0, world.z);
      object3d.rotation.y = Math.random() * Math.PI * 2;

      this.scene.add(object3d);
      this.spawnedObjects.push(object3d);
      this.consumeMissionObjectBudget(1);

      const lockId = `lockSocket:${mission.id}:${slot}`;
      const label = `Insert Key ${slot}`;
      this.registeredIds.push(
        this.interactables.register({
          id: lockId,
          kind: 'lockSocket',
          label,
          gridPos: { x: pos.x, y: pos.y },
          object3d,
          maxDistance: 2.7,
          requiresItem: { itemId, count: 1, message: `Need Key ${slot}.` },
          consumeItem: true,
          prompt: () => {
            const lock = mission.state.locks?.[i] || null;
            return lock?.filled ? `Lock ${slot} (Unlocked)` : `E: ${label}`;
          },
          interact: ({ entry }) => {
            const lock = mission.state.locks?.[i] || null;
            if (lock?.filled) {
              if (entry) {
                entry.requiresItem = [];
                entry.consumeItem = [];
              }
              return { ok: true, message: 'Already unlocked', state: { filled: true } };
            }
            setAltarState(object3d, { filled: true });
            if (entry) {
              entry.requiresItem = [];
              entry.consumeItem = [];
            }
            return { ok: true, message: `Key ${slot} inserted`, state: { filled: true } };
          },
          meta: { missionId: mission.id, template: mission.template, index: i, slot, itemId, filled: false }
        })
      );
      this.interactableMeta.set(lockId, { missionId: mission.id, template: mission.template, index: i, slot, itemId });
      mission.state.locks.push({ id: lockId, gridPos: { x: pos.x, y: pos.y }, filled: false, slot, itemId });
    }
  }

  spawnPlaceItemsAtAltars(mission, options = {}) {
    const ws = this.worldState;
    const avoid = Array.isArray(options.avoid) ? options.avoid.filter(Boolean) : [];
    if (!ws) return;

    const itemId = String(mission.state.itemId || mission.params.itemId || 'relic').trim() || 'relic';
    const desiredItems = clamp(Math.round(mission.state.itemsRequired ?? 3), 1, 24);
    const desiredAltars = clamp(Math.round(mission.state.altarsTotal ?? desiredItems), 1, 24);
    const desiredPairs = Math.min(desiredItems, desiredAltars);
    const pairBudget = Number.isFinite(this.objectBudgetRemaining)
      ? Math.max(0, Math.floor(this.objectBudgetRemaining / 2))
      : desiredPairs;
    const pairCount = Math.max(0, Math.min(desiredPairs, pairBudget));
    const minDist = mission.params.minDistFromSpawn ?? 7;

    const itemRoomTypes = Array.isArray(mission.params.roomTypesItems)
      ? mission.params.roomTypesItems
      : (Array.isArray(mission.params.roomTypes) ? mission.params.roomTypes : null);
    const altarRoomTypes = Array.isArray(mission.params.roomTypesAltars)
      ? mission.params.roomTypesAltars
      : (Array.isArray(mission.params.roomTypesTargets) ? mission.params.roomTypesTargets : null);

    if (pairCount <= 0) {
      this.failOpenMission(mission, 'mission object budget exhausted');
      return;
    }

    const itemTiles = pickDistinctRoomTiles(ws, pairCount, {
      allowedRoomTypes: itemRoomTypes,
      minDistFrom: avoid,
      minDist,
      margin: 1
    });
    if (itemTiles.length === 0) {
      this.failOpenMission(mission, 'no valid relic tiles');
      return;
    }

    const avoidForAltars = avoid.concat(itemTiles);
    const altarTiles = pickDistinctRoomTiles(ws, itemTiles.length, {
      allowedRoomTypes: altarRoomTypes,
      minDistFrom: avoidForAltars,
      minDist,
      margin: 1
    });
    if (altarTiles.length === 0) {
      this.failOpenMission(mission, 'no valid altar tiles');
      return;
    }

    const finalCount = Math.min(itemTiles.length, altarTiles.length);
    if (finalCount <= 0 || !this.canSpawnMissionObject(finalCount * 2)) {
      this.failOpenMission(mission, 'mission object budget exhausted');
      return;
    }

    mission.state.itemsRequired = finalCount;
    mission.state.altarsTotal = finalCount;
    mission.state.items = [];
    mission.state.altars = [];

    for (let i = 0; i < finalCount; i++) {
      const pos = itemTiles[i];
      const object3d = createEvidenceObject();
      const world = gridToWorldCenter(pos);
      object3d.position.set(world.x, 0, world.z);
      object3d.rotation.y = Math.random() * Math.PI * 2;

      this.scene.add(object3d);
      this.spawnedObjects.push(object3d);
      this.consumeMissionObjectBudget(1);

      const interactableId = `relic:${mission.id}:${i + 1}`;
      const label = 'Collect Relic';
      this.registeredIds.push(
        this.interactables.register({
          id: interactableId,
          kind: 'relic',
          label,
          gridPos: { x: pos.x, y: pos.y },
          object3d,
          prompt: () => `E: ${label}`,
          interact: () => ({ ok: true, picked: true, message: 'Relic collected' }),
          meta: { missionId: mission.id, template: mission.template, index: i, itemId }
        })
      );
      this.interactableMeta.set(interactableId, { missionId: mission.id, template: mission.template, index: i });
      mission.state.items.push({ id: interactableId, gridPos: { x: pos.x, y: pos.y }, collected: false });
    }

    for (let i = 0; i < finalCount; i++) {
      const pos = altarTiles[i];
      const object3d = createAltarObject({ filled: false });
      const world = gridToWorldCenter(pos);
      object3d.position.set(world.x, 0, world.z);
      object3d.rotation.y = Math.random() * Math.PI * 2;

      this.scene.add(object3d);
      this.spawnedObjects.push(object3d);
      this.consumeMissionObjectBudget(1);

      const altarId = `altar:${mission.id}:${i + 1}`;
      const label = 'Place Relic';
      this.registeredIds.push(
        this.interactables.register({
          id: altarId,
          kind: 'altar',
          label,
          gridPos: { x: pos.x, y: pos.y },
          object3d,
          maxDistance: 2.7,
          requiresItem: { itemId, count: 1, message: 'Need a relic.' },
          consumeItem: true,
          prompt: () => {
            const altar = mission.state.altars?.[i] || null;
            return altar?.filled ? 'E: Altar (Filled)' : `E: ${label}`;
          },
          interact: ({ entry }) => {
            const altar = mission.state.altars?.[i] || null;
            if (altar?.filled) {
              if (entry) {
                entry.requiresItem = [];
                entry.consumeItem = [];
              }
              return { ok: true, message: 'Already placed', state: { filled: true } };
            }

            setAltarState(object3d, { filled: true });
            if (entry) {
              entry.requiresItem = [];
              entry.consumeItem = [];
            }
            return { ok: true, message: 'Relic placed', state: { filled: true } };
          },
          meta: { missionId: mission.id, template: mission.template, index: i, itemId, filled: false }
        })
      );
      this.interactableMeta.set(altarId, { missionId: mission.id, template: mission.template, index: i });
      mission.state.altars.push({ id: altarId, gridPos: { x: pos.x, y: pos.y }, filled: false });
    }
  }

  spawnSearchRoomTypeN(mission, options = {}) {
    const ws = this.worldState;
    const avoid = Array.isArray(options.avoid) ? options.avoid.filter(Boolean) : [];
    if (!ws) return;

    const roomTypes = Array.isArray(mission.params.roomTypesTargets)
      ? mission.params.roomTypesTargets
      : (Array.isArray(mission.params.roomTypes) ? mission.params.roomTypes : null);

    const desired = clamp(Math.round(mission.state.required ?? mission.params.count ?? 3), 1, 24);
    const want = Number.isFinite(this.objectBudgetRemaining)
      ? Math.max(0, Math.min(desired, this.objectBudgetRemaining))
      : desired;
    const tiles = pickDistinctRoomTiles(ws, want, {
      allowedRoomTypes: roomTypes,
      minDistFrom: avoid,
      minDist: mission.params.minDistFromSpawn ?? 7,
      margin: 1
    });
    if (tiles.length === 0) {
      this.failOpenMission(mission, want <= 0 ? 'mission object budget exhausted' : 'no valid spawn tiles');
      return;
    }

    mission.state.required = tiles.length;
    mission.state.photos = 0;
    mission.state.targets = [];

    for (let i = 0; i < tiles.length; i++) {
      if (!this.canSpawnMissionObject(1)) break;
      const pos = tiles[i];
      const slot = toSlotLabel(i);
      const object3d = createClueNoteObject(slot);
      const world = gridToWorldCenter(pos);
      object3d.position.set(world.x, 0, world.z);
      object3d.rotation.y = Math.random() * Math.PI * 2;

      this.scene.add(object3d);
      this.spawnedObjects.push(object3d);
      this.consumeMissionObjectBudget(1);

      const interactableId = `search:${mission.id}:${slot}`;
      const label = 'Inspect';
      this.registeredIds.push(
        this.interactables.register({
          id: interactableId,
          kind: 'inspect',
          label,
          gridPos: { x: pos.x, y: pos.y },
          object3d,
          prompt: () => `E: ${label}`,
          interact: () => ({ ok: true, picked: true, message: `Inspected ${slot}` }),
          meta: { missionId: mission.id, template: mission.template, index: i, slot }
        })
      );
      this.interactableMeta.set(interactableId, { missionId: mission.id, template: mission.template, index: i, slot });
      mission.state.targets.push({ id: interactableId, gridPos: { x: pos.x, y: pos.y }, searched: false, slot });
    }

    mission.state.required = mission.state.targets.length;
    if ((mission.state.required || 0) <= 0) {
      this.failOpenMission(mission, 'mission object budget exhausted');
    }
  }

  spawnSearchAndTagRoom(mission, options = {}) {
    const ws = this.worldState;
    const avoid = Array.isArray(options.avoid) ? options.avoid.filter(Boolean) : [];
    if (!ws) return;

    const roomTypes = Array.isArray(mission.params.roomTypesTargets)
      ? mission.params.roomTypesTargets
      : (Array.isArray(mission.params.roomTypes) ? mission.params.roomTypes : null);

    const desired = clamp(Math.round(mission.state.required ?? mission.params.count ?? 3), 1, 24);
    const want = Number.isFinite(this.objectBudgetRemaining)
      ? Math.max(0, Math.min(desired, this.objectBudgetRemaining))
      : desired;

    const tiles = pickDistinctRoomTiles(ws, want, {
      allowedRoomTypes: roomTypes,
      minDistFrom: avoid,
      minDist: mission.params.minDistFromSpawn ?? 7,
      margin: 1
    });
    if (tiles.length === 0) {
      this.failOpenMission(mission, want <= 0 ? 'mission object budget exhausted' : 'no valid tag tiles');
      return;
    }

    mission.state.required = tiles.length;
    mission.state.targets = [];

    for (let i = 0; i < tiles.length; i++) {
      if (!this.canSpawnMissionObject(1)) break;
      const pos = tiles[i];
      const slot = toSlotLabel(i);
      const object3d = createClueNoteObject(slot);
      const world = gridToWorldCenter(pos);
      object3d.position.set(world.x, 0, world.z);
      object3d.rotation.y = Math.random() * Math.PI * 2;

      this.scene.add(object3d);
      this.spawnedObjects.push(object3d);
      this.consumeMissionObjectBudget(1);

      const interactableId = `tag:${mission.id}:${slot}`;
      const label = 'Tag';
      this.registeredIds.push(
        this.interactables.register({
          id: interactableId,
          kind: 'tagTarget',
          label,
          gridPos: { x: pos.x, y: pos.y },
          object3d,
          prompt: () => `E: ${label}`,
          interact: () => ({ ok: true, picked: true, message: `Tagged ${slot}` }),
          meta: { missionId: mission.id, template: mission.template, index: i, slot }
        })
      );
      this.interactableMeta.set(interactableId, { missionId: mission.id, template: mission.template, index: i, slot });
      mission.state.targets.push({ id: interactableId, gridPos: { x: pos.x, y: pos.y }, tagged: false, slot });
    }

    mission.state.required = mission.state.targets.length;
    if ((mission.state.required || 0) <= 0) {
      this.failOpenMission(mission, 'mission object budget exhausted');
    }
  }

  spawnPhotographEvidence(mission, options = {}) {
    const ws = this.worldState;
    const avoid = Array.isArray(options.avoid) ? options.avoid.filter(Boolean) : [];
    if (!ws) return;

    const roomTypes = Array.isArray(mission.params.roomTypesTargets)
      ? mission.params.roomTypesTargets
      : (Array.isArray(mission.params.roomTypes) ? mission.params.roomTypes : null);

    const desired = clamp(Math.round(mission.state.required ?? mission.params.count ?? 3), 1, 24);
    const want = Number.isFinite(this.objectBudgetRemaining)
      ? Math.max(0, Math.min(desired, this.objectBudgetRemaining))
      : desired;
    const tiles = pickDistinctRoomTiles(ws, want, {
      allowedRoomTypes: roomTypes,
      minDistFrom: avoid,
      minDist: mission.params.minDistFromSpawn ?? 7,
      margin: 1
    });
    if (tiles.length === 0) {
      this.failOpenMission(mission, want <= 0 ? 'mission object budget exhausted' : 'no valid spawn tiles');
      return;
    }

    mission.state.required = tiles.length;
    mission.state.targets = [];

    const maxDistance = clamp(toFinite(mission.params.maxDistance, 3.2) ?? 3.2, 1.5, 8);
    const aimMinDotParam = toFinite(mission.params.aimMinDot, null);
    const aimAngleDeg = clamp(toFinite(mission.params.aimAngleDeg, 18) ?? 18, 5, 60);
    const aimMinDot = Number.isFinite(aimMinDotParam)
      ? clamp(aimMinDotParam, 0.2, 0.9999)
      : Math.cos((aimAngleDeg * Math.PI) / 180);
    const aimOffsetY = clamp(toFinite(mission.params.aimOffsetY, 0.7) ?? 0.7, 0, 2.5);
    const seconds = clamp(Math.round(mission.state.seconds ?? mission.params.seconds ?? mission.params.holdSeconds ?? 2), 1, 30);
    mission.state.seconds = seconds;

    for (let i = 0; i < tiles.length; i++) {
      if (!this.canSpawnMissionObject(1)) break;
      const pos = tiles[i];
      const object3d = createPhotoTargetObject();
      const world = gridToWorldCenter(pos);
      object3d.position.set(world.x, 0, world.z);
      object3d.rotation.y = Math.random() * Math.PI * 2;

      this.scene.add(object3d);
      this.spawnedObjects.push(object3d);
      this.consumeMissionObjectBudget(1);

      const interactableId = `photo:${mission.id}:${i + 1}`;
      const label = 'Photograph';
      this.registeredIds.push(
        this.interactables.register({
          id: interactableId,
          kind: 'photoTarget',
          label,
          gridPos: { x: pos.x, y: pos.y },
          object3d,
          maxDistance,
          prompt: () => `Hold C to photograph (${seconds}s)`,
          interact: () => ({ ok: true, message: `Hold C to photograph (${seconds}s)` }),
          meta: {
            missionId: mission.id,
            template: mission.template,
            index: i,
            aimMinDot,
            aimOffsetY,
            aimHint: 'Keep the target centered',
            seconds,
            maxDistance,
            requiresCamera: true
          }
        })
      );
      this.interactableMeta.set(interactableId, { missionId: mission.id, template: mission.template, index: i });
      mission.state.targets.push({ id: interactableId, gridPos: { x: pos.x, y: pos.y }, heldForSec: 0, completed: false });
    }

    mission.state.required = mission.state.targets.length;
    if ((mission.state.required || 0) <= 0) {
      this.failOpenMission(mission, 'mission object budget exhausted');
    }
  }

  spawnHoldToScan(mission, options = {}) {
    const ws = this.worldState;
    const avoid = Array.isArray(options.avoid) ? options.avoid.filter(Boolean) : [];
    if (!ws) return;

    const roomTypes = Array.isArray(mission.params.roomTypesTargets)
      ? mission.params.roomTypesTargets
      : (Array.isArray(mission.params.roomTypes) ? mission.params.roomTypes : null);

    const desired = clamp(Math.round(mission.state.required ?? mission.params.count ?? 1), 1, 24);
    const want = Number.isFinite(this.objectBudgetRemaining)
      ? Math.max(0, Math.min(desired, this.objectBudgetRemaining))
      : desired;

    const tiles = pickDistinctRoomTiles(ws, want, {
      allowedRoomTypes: roomTypes,
      minDistFrom: avoid,
      minDist: mission.params.minDistFromSpawn ?? 7,
      margin: 1
    });

    if (tiles.length === 0) {
      this.failOpenMission(mission, want <= 0 ? 'mission object budget exhausted' : 'no valid scan tiles');
      return;
    }

    const seconds = clamp(Math.round(mission.state.seconds ?? mission.params.seconds ?? mission.params.holdSeconds ?? 5), 2, 120);
    const maxDistance = clamp(toFinite(mission.params.maxDistance, 3.6) ?? 3.6, 1.5, 10);
    const aimMinDotParam = toFinite(mission.params.aimMinDot, null);
    const aimAngleDeg = clamp(toFinite(mission.params.aimAngleDeg, 14) ?? 14, 5, 60);
    const aimMinDot = Number.isFinite(aimMinDotParam)
      ? clamp(aimMinDotParam, 0.2, 0.9999)
      : Math.cos((aimAngleDeg * Math.PI) / 180);
    const aimOffsetY = clamp(toFinite(mission.params.aimOffsetY, 0.9) ?? 0.9, 0, 2.5);

    mission.state.seconds = seconds;
    mission.state.required = tiles.length;
    mission.state.scanned = 0;
    mission.state.completed = false;
    mission.state.targets = [];

    for (let i = 0; i < tiles.length; i++) {
      if (!this.canSpawnMissionObject(1)) break;
      const pos = tiles[i];
      const object3d = createPhotoTargetObject();
      const world = gridToWorldCenter(pos);
      object3d.position.set(world.x, 0, world.z);
      object3d.rotation.y = Math.random() * Math.PI * 2;

      this.scene.add(object3d);
      this.spawnedObjects.push(object3d);
      this.consumeMissionObjectBudget(1);

      const interactableId = `scan:${mission.id}:${i + 1}`;
      const label = 'Scan Target';
      this.registeredIds.push(
        this.interactables.register({
          id: interactableId,
          kind: 'scanTarget',
          label,
          gridPos: { x: pos.x, y: pos.y },
          object3d,
          maxDistance,
          prompt: () => `Hold aim to scan (${seconds}s)`,
          interact: () => ({ ok: true, message: 'Hold aim to scan' }),
          meta: {
            missionId: mission.id,
            template: mission.template,
            index: i,
            aimMinDot,
            aimOffsetY,
            seconds,
            maxDistance
          }
        })
      );
      this.interactableMeta.set(interactableId, { missionId: mission.id, template: mission.template, index: i });
      mission.state.targets.push({ id: interactableId, gridPos: { x: pos.x, y: pos.y }, heldForSec: 0, completed: false });
    }

    mission.state.required = mission.state.targets.length;
    if ((mission.state.required || 0) <= 0) {
      this.failOpenMission(mission, 'mission object budget exhausted');
    }
  }

  spawnLureToSensor(mission, options = {}) {
    const ws = this.worldState;
    const avoid = Array.isArray(options.avoid) ? options.avoid.filter(Boolean) : [];
    if (!ws) return;

    const sensorRoomTypes = Array.isArray(mission.params.roomTypesSensor)
      ? mission.params.roomTypesSensor
      : (Array.isArray(mission.params.roomTypesTargets)
        ? mission.params.roomTypesTargets
        : (Array.isArray(mission.params.roomTypes) ? mission.params.roomTypes : null));

    if (!this.canSpawnMissionObject(2)) {
      this.failOpenMission(mission, 'mission object budget exhausted');
      return;
    }

    const sensorTiles = pickDistinctTiles(ws, 1, {
      allowedRoomTypes: sensorRoomTypes,
      minDistFrom: avoid,
      minDist: mission.params.minDistFromSpawn ?? 8,
      margin: 1
    });
    const sensorPos = sensorTiles[0] || null;
    if (!sensorPos) {
      this.failOpenMission(mission, 'no valid sensor tile');
      return;
    }

    const sensorObject = createSensorObject({ armed: false, active: false, success: false });
    const sensorWorld = gridToWorldCenter(sensorPos);
    sensorObject.position.set(sensorWorld.x, 0, sensorWorld.z);
    this.scene.add(sensorObject);
    this.spawnedObjects.push(sensorObject);
    this.consumeMissionObjectBudget(1);

    const sensorId = `sensor:${mission.id}`;
    mission.state.sensorId = sensorId;
    mission.state.sensorGridPos = { x: sensorPos.x, y: sensorPos.y };

    this.registeredIds.push(
      this.interactables.register({
        id: sensorId,
        kind: 'sensor',
        label: 'Sensor',
        gridPos: { x: sensorPos.x, y: sensorPos.y },
        object3d: sensorObject,
        maxDistance: 2.8,
        prompt: () => {
          if (mission.state.completed) return 'Sensor (Complete)';
          if (mission.state.armed) return 'E: Sensor (Armed)';
          return 'E: Arm Sensor';
        },
        interact: ({ entry }) => {
          if (mission.state.completed) return { ok: true, message: 'Sensor already complete', state: { armed: true } };
          if (mission.state.armed) return { ok: true, message: 'Sensor already armed', state: { armed: true } };
          mission.state.armed = true;
          if (entry?.meta) entry.meta.armed = true;
          setSensorState(sensorObject, { armed: true, active: false, success: false });
          return { ok: true, message: 'Sensor armed', state: { armed: true } };
        },
        meta: { missionId: mission.id, template: mission.template, armed: false }
      })
    );
    this.interactableMeta.set(sensorId, { missionId: mission.id, template: mission.template });

    // Place the lure device near the sensor (best effort).
    const offsets = shuffleInPlace([
      { dx: 1, dy: 0 },
      { dx: -1, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: 0, dy: -1 }
    ]);

    let lurePos = null;
    for (const o of offsets) {
      const x = sensorPos.x + o.dx;
      const y = sensorPos.y + o.dy;
      if (!ws.isWalkable?.(x, y)) continue;
      lurePos = { x, y };
      break;
    }
    if (!lurePos) lurePos = { x: sensorPos.x, y: sensorPos.y };

    const lureObject = createPowerSwitchObject(false);
    const lureWorld = gridToWorldCenter(lurePos);
    lureObject.position.set(lureWorld.x, 0, lureWorld.z);
    if (lurePos.x === sensorPos.x && lurePos.y === sensorPos.y) {
      lureObject.position.x += 0.35;
      lureObject.position.z += 0.15;
    }
    this.scene.add(lureObject);
    this.spawnedObjects.push(lureObject);
    this.consumeMissionObjectBudget(1);

    const lureId = `lure:${mission.id}`;
    mission.state.lureId = lureId;
    mission.state.lureGridPos = { x: lurePos.x, y: lurePos.y };

    this.registeredIds.push(
      this.interactables.register({
        id: lureId,
        kind: 'lureDevice',
        label: 'Lure Device',
        gridPos: { x: lurePos.x, y: lurePos.y },
        object3d: lureObject,
        maxDistance: 2.6,
        prompt: () => {
          if (mission.state.completed) return 'Lure Device (Complete)';
          const remaining = Math.max(0, (Number(mission.state.lureUntilSec) || 0) - this.elapsedSec);
          if (remaining > 0) return `Lure active (${Math.ceil(remaining)}s)`;
          return 'E: Trigger Lure';
        },
        interact: ({ entry }) => {
          if (mission.state.completed) return { ok: true, message: 'Lure already complete', state: { active: false } };
          if (!mission.state.armed) {
            return { ok: false, message: 'Arm the sensor first', state: { blocked: true } };
          }

          const seconds = clamp(Math.round(mission.state.lureSeconds ?? mission.params.lureSeconds ?? 10), 3, 120);
          mission.state.lureUntilSec = this.elapsedSec + seconds;
          if (entry?.meta) entry.meta.active = true;
          setPowerSwitchState(lureObject, true);
          this.eventBus?.emit?.(EVENTS.NOISE_REQUESTED, {
            source: 'player',
            kind: 'lure',
            strength: 0.7,
            position: lureObject.position,
            radius: 12,
            ttl: 1.0
          });
          return { ok: true, message: 'Lure triggered', state: { active: true } };
        },
        meta: { missionId: mission.id, template: mission.template, active: false }
      })
    );
    this.interactableMeta.set(lureId, { missionId: mission.id, template: mission.template });
  }

  spawnDeliverItemToTerminal(mission, options = {}) {
    const ws = this.worldState;
    const avoid = Array.isArray(options.avoid) ? options.avoid.filter(Boolean) : [];
    if (!ws) return;

    const itemRoomTypes = Array.isArray(mission.params.roomTypesItems)
      ? mission.params.roomTypesItems
      : (Array.isArray(mission.params.roomTypes) ? mission.params.roomTypes : null);
    const terminalRoomTypes = Array.isArray(mission.params.roomTypesTerminal)
      ? mission.params.roomTypesTerminal
      : (Array.isArray(mission.params.terminalRoomTypes) ? mission.params.terminalRoomTypes : null);

    if (!this.canSpawnMissionObject(1)) {
      this.failOpenMission(mission, 'mission object budget exhausted');
      return;
    }

    const terminalTiles = pickDistinctTiles(ws, 1, {
      allowedRoomTypes: terminalRoomTypes,
      minDistFrom: avoid,
      minDist: mission.params.minDistFromSpawn ?? 7,
      margin: 1
    });
    if (terminalTiles.length === 0) {
      this.failOpenMission(mission, 'no valid terminal tile');
      return;
    }
    if (!this.canSpawnMissionObject(1)) {
      this.failOpenMission(mission, 'mission object budget exhausted');
      return;
    }

    const terminalPos = terminalTiles[0];
    const terminalObject = createTerminalObject({ uploaded: false });
    const terminalWorld = gridToWorldCenter(terminalPos);
    terminalObject.position.set(terminalWorld.x, 0, terminalWorld.z);
    this.scene.add(terminalObject);
    this.spawnedObjects.push(terminalObject);
    this.consumeMissionObjectBudget(1);

    const terminalId = `deliveryTerminal:${mission.id}`;
    mission.state.terminalId = terminalId;
    mission.state.terminalGridPos = { x: terminalPos.x, y: terminalPos.y };

    const desired = clamp(Math.round(mission.state.total ?? mission.params.count ?? 3), 1, 24);
    const want = Number.isFinite(this.objectBudgetRemaining)
      ? Math.max(0, Math.min(desired, this.objectBudgetRemaining))
      : desired;

    const tiles = pickDistinctTiles(ws, want, {
      allowedRoomTypes: itemRoomTypes,
      minDistFrom: avoid.concat([terminalPos]),
      minDist: mission.params.minDistFromSpawn ?? 6,
      margin: 1
    });

    mission.state.items = [];

    for (let i = 0; i < tiles.length; i++) {
      if (!this.canSpawnMissionObject(1)) break;
      const pos = tiles[i];
      const object3d = createDeliveryItemObject();
      const world = gridToWorldCenter(pos);
      object3d.position.set(world.x, 0, world.z);
      object3d.rotation.y = Math.random() * Math.PI * 2;

      this.scene.add(object3d);
      this.spawnedObjects.push(object3d);
      this.consumeMissionObjectBudget(1);

      const interactableId = `deliveryItem:${mission.id}:${i + 1}`;
      const label = 'Pick up Package';
      this.registeredIds.push(
        this.interactables.register({
          id: interactableId,
          kind: 'deliveryItem',
          label,
          gridPos: { x: pos.x, y: pos.y },
          object3d,
          prompt: () => `E: ${label}`,
          interact: () => ({ ok: true, picked: true, message: 'Package acquired' }),
          meta: { missionId: mission.id, template: mission.template, index: i }
        })
      );
      this.interactableMeta.set(interactableId, { missionId: mission.id, template: mission.template, index: i });
      mission.state.items.push({ id: interactableId, gridPos: { x: pos.x, y: pos.y }, collected: false });
    }

    mission.state.total = mission.state.items.length;
    if (mission.state.total > 0) {
      mission.state.required = clamp(Math.round(mission.state.required ?? mission.params.required ?? mission.state.total), 1, mission.state.total);
    } else {
      mission.state.required = 0;
    }

    const itemId = String(mission.state.itemId || mission.params.itemId || 'package').trim() || 'package';
    mission.state.itemId = itemId;

    const requiresPower = mission.params.requiresPower === true;
    const powerItemId = String(mission.params.powerItemId || 'power_on').trim() || 'power_on';

    const label = 'Delivery Terminal';
    this.registeredIds.push(
      this.interactables.register({
        id: terminalId,
        kind: 'terminal',
        label,
        gridPos: { x: terminalPos.x, y: terminalPos.y },
        object3d: terminalObject,
        maxDistance: 2.6,
        requiresItem: requiresPower ? { itemId: powerItemId, count: 1, message: 'Power is off.' } : null,
        consumeItem: (mission.state.required || 0) > 0 ? { itemId, count: mission.state.required || 0 } : null,
        prompt: () => {
          if (mission.state.delivered) return 'E: Delivery Terminal (Complete)';
          if (requiresPower) {
            const q = { itemId: powerItemId, result: null };
            this.eventBus?.emit?.(EVENTS.INVENTORY_QUERY_ITEM, q);
            const havePower = Number(q.result?.count) || 0;
            if (havePower <= 0) return 'E: Delivery Terminal (No Power)';
          }
          const missing = Math.max(0, (mission.state.required || 0) - (mission.state.collected || 0));
          if (missing > 0) return `E: Delivery Terminal (Need ${missing} package${missing === 1 ? '' : 's'})`;
          return 'E: Deliver Packages';
        },
        interact: ({ entry }) => {
          if (mission.state.delivered) {
            if (entry) {
              entry.requiresItem = [];
              entry.consumeItem = [];
            }
            return { ok: true, message: 'Already delivered', state: { delivered: true } };
          }

          const meta = entry?.meta || {};
          meta.delivered = true;
          if (entry) {
            entry.requiresItem = [];
            entry.consumeItem = [];
          }
          setTerminalState(terminalObject, { uploaded: true });
          return { ok: true, message: 'Packages delivered', state: { delivered: true } };
        },
        meta: { missionId: mission.id, template: mission.template, delivered: false }
      })
    );
    this.interactableMeta.set(terminalId, { missionId: mission.id, template: mission.template });
  }

  spawnDeliverFragile(mission, options = {}) {
    const ws = this.worldState;
    const avoid = Array.isArray(options.avoid) ? options.avoid.filter(Boolean) : [];
    if (!ws) return;

    const itemRoomTypes = Array.isArray(mission.params.roomTypesItems)
      ? mission.params.roomTypesItems
      : (Array.isArray(mission.params.roomTypes) ? mission.params.roomTypes : null);
    const terminalRoomTypes = Array.isArray(mission.params.roomTypesTerminal)
      ? mission.params.roomTypesTerminal
      : (Array.isArray(mission.params.terminalRoomTypes) ? mission.params.terminalRoomTypes : null);

    if (!this.canSpawnMissionObject(2)) {
      this.failOpenMission(mission, 'mission object budget exhausted');
      return;
    }

    const terminalTiles = pickDistinctTiles(ws, 1, {
      allowedRoomTypes: terminalRoomTypes,
      minDistFrom: avoid,
      minDist: mission.params.minDistFromSpawn ?? 7,
      margin: 1
    });
    const terminalPos = terminalTiles[0] || null;
    if (!terminalPos) {
      this.failOpenMission(mission, 'no valid terminal tile');
      return;
    }

    const itemTiles = pickDistinctTiles(ws, 1, {
      allowedRoomTypes: itemRoomTypes,
      minDistFrom: avoid.concat([terminalPos]),
      minDist: mission.params.minDistFromSpawn ?? 6,
      margin: 1
    });
    const itemPos = itemTiles[0] || null;
    if (!itemPos) {
      this.failOpenMission(mission, 'no valid package tile');
      return;
    }

    const itemId = String(mission.state.itemId || mission.params.itemId || 'fragile_package').trim() || 'fragile_package';
    mission.state.itemId = itemId;

    const pkgLabel = String(mission.params.packageLabel || mission.params.label || 'fragile package').trim() || 'fragile package';
    const terminalLabel = String(mission.params.terminalLabel || 'Delivery Terminal').trim() || 'Delivery Terminal';

    const terminalObject = createTerminalObject({ uploaded: false });
    const terminalWorld = gridToWorldCenter(terminalPos);
    terminalObject.position.set(terminalWorld.x, 0, terminalWorld.z);
    this.scene.add(terminalObject);
    this.spawnedObjects.push(terminalObject);
    this.consumeMissionObjectBudget(1);

    const terminalId = `fragileTerminal:${mission.id}`;
    mission.state.terminalId = terminalId;
    mission.state.terminalGridPos = { x: terminalPos.x, y: terminalPos.y };

    this.registeredIds.push(
      this.interactables.register({
        id: terminalId,
        kind: 'terminal',
        label: terminalLabel,
        gridPos: { x: terminalPos.x, y: terminalPos.y },
        object3d: terminalObject,
        maxDistance: 2.6,
        requiresItem: { itemId, count: 1, message: `Need the ${pkgLabel}.` },
        consumeItem: true,
        prompt: () => (mission.state.delivered ? 'E: Terminal (Delivered)' : `E: Deliver ${pkgLabel}`),
        interact: ({ entry }) => {
          if (mission.state.delivered) {
            if (entry) {
              entry.requiresItem = [];
              entry.consumeItem = [];
            }
            return { ok: true, message: 'Already delivered', state: { delivered: true } };
          }

          mission.state.delivered = true;
          mission.state.carrying = false;
          if (entry) {
            entry.requiresItem = [];
            entry.consumeItem = [];
          }
          setTerminalState(terminalObject, { uploaded: true });

          const pkgEntry = mission.state.packageId ? (this.interactables?.get?.(mission.state.packageId) || null) : null;
          if (pkgEntry?.object3d) pkgEntry.object3d.visible = false;
          if (pkgEntry) pkgEntry.enabled = false;

          return { ok: true, message: `${pkgLabel} delivered`, state: { delivered: true } };
        },
        meta: { missionId: mission.id, template: mission.template, delivered: false }
      })
    );
    this.interactableMeta.set(terminalId, { missionId: mission.id, template: mission.template });

    const packageObject = createDeliveryItemObject();
    const itemWorld = gridToWorldCenter(itemPos);
    packageObject.position.set(itemWorld.x, 0, itemWorld.z);
    packageObject.rotation.y = Math.random() * Math.PI * 2;
    this.scene.add(packageObject);
    this.spawnedObjects.push(packageObject);
    this.consumeMissionObjectBudget(1);

    const packageId = `fragile:${mission.id}`;
    mission.state.packageId = packageId;
    mission.state.packageGridPos = { x: itemPos.x, y: itemPos.y };

    this.registeredIds.push(
      this.interactables.register({
        id: packageId,
        kind: 'fragilePackage',
        label: pkgLabel,
        gridPos: { x: itemPos.x, y: itemPos.y },
        object3d: packageObject,
        prompt: () => (mission.state.carrying ? `${pkgLabel} (carried)` : `E: Pick Up ${pkgLabel}`),
        interact: ({ actorKind, entry }) => {
          if (mission.state.delivered) return { ok: true, message: 'Already delivered', state: { carrying: false } };
          if (mission.state.carrying) return { ok: true, message: 'Already carrying', state: { carrying: true } };

          mission.state.carrying = true;
          if (entry) entry.enabled = false;
          packageObject.visible = false;
          this.eventBus?.emit?.(EVENTS.INVENTORY_GIVE_ITEM, { actorKind: actorKind || 'player', itemId, count: 1, sourceId: packageId });
          return { ok: true, message: `${pkgLabel} acquired`, state: { carrying: true } };
        },
        meta: { missionId: mission.id, template: mission.template, itemId }
      })
    );
    this.interactableMeta.set(packageId, { missionId: mission.id, template: mission.template });
  }

  spawnSwitchSequence(mission, options = {}) {
    const ws = this.worldState;
    const avoid = Array.isArray(options.avoid) ? options.avoid.filter(Boolean) : [];
    if (!ws) return;

    const roomTypes = Array.isArray(mission.params.roomTypesSwitches)
      ? mission.params.roomTypesSwitches
      : (Array.isArray(mission.params.roomTypesTargets)
        ? mission.params.roomTypesTargets
        : (Array.isArray(mission.params.roomTypes) ? mission.params.roomTypes : null));

    const desired = clamp(Math.round(mission.state.total ?? mission.params.switches ?? mission.params.count ?? 3), 2, 10);
    const want = Number.isFinite(this.objectBudgetRemaining)
      ? Math.max(0, Math.min(desired, this.objectBudgetRemaining))
      : desired;

    const tiles = pickDistinctTiles(ws, want, {
      allowedRoomTypes: roomTypes,
      minDistFrom: avoid,
      minDist: mission.params.minDistFromSpawn ?? 7,
      margin: 1
    });
    if (tiles.length < 2) {
      this.failOpenMission(mission, want <= 0 ? 'mission object budget exhausted' : 'no valid switch tiles');
      return;
    }

    mission.state.total = tiles.length;
    mission.state.switches = [];

    for (let i = 0; i < tiles.length; i++) {
      if (!this.canSpawnMissionObject(1)) break;
      const pos = tiles[i];
      const slot = toSlotLabel(i);
      const object3d = createPowerSwitchObject(false);
      const world = gridToWorldCenter(pos);
      object3d.position.set(world.x, 0, world.z);

      this.scene.add(object3d);
      this.spawnedObjects.push(object3d);
      this.consumeMissionObjectBudget(1);

      const interactableId = `seqSwitch:${mission.id}:${slot}`;
      const label = `Sequence Switch ${slot}`;
      this.registeredIds.push(
        this.interactables.register({
          id: interactableId,
          kind: 'sequenceSwitch',
          label,
          gridPos: { x: pos.x, y: pos.y },
          object3d,
          maxDistance: 2.6,
          prompt: ({ entry }) => {
            const on = !!entry?.meta?.on;
            return on ? `E: ${label} (On)` : `E: ${label} (Off)`;
          },
          interact: ({ entry }) => {
            const meta = entry?.meta || {};
            if (meta.on) {
              return { ok: true, message: 'Already activated', state: { on: true, slot } };
            }
            meta.on = true;
            setPowerSwitchState(object3d, true);
            return { ok: true, message: `Activated ${slot}`, state: { on: true, slot } };
          },
          meta: { missionId: mission.id, template: mission.template, index: i, slot, on: false }
        })
      );
      this.interactableMeta.set(interactableId, { missionId: mission.id, template: mission.template, index: i });
      mission.state.switches.push({ id: interactableId, gridPos: { x: pos.x, y: pos.y }, slot, on: false });
    }

    mission.state.total = mission.state.switches.length;
    const slots = mission.state.switches.map((s) => s?.slot).filter(Boolean);
    if (slots.length < 2) {
      this.failOpenMission(mission, 'mission object budget exhausted');
      return;
    }

    const rawSeq = Array.isArray(mission.params.sequence) ? mission.params.sequence : null;
    const desiredLen = clamp(Math.round(mission.params.length ?? slots.length), 2, slots.length);

    const normalized = [];
    if (rawSeq) {
      for (const entry of rawSeq) {
        if (normalized.length >= desiredLen) break;
        if (typeof entry === 'string') {
          const label = entry.trim().toUpperCase();
          if (slots.includes(label)) normalized.push(label);
        } else if (Number.isFinite(Number(entry))) {
          const idx = clamp(Math.round(Number(entry)), 0, slots.length - 1);
          normalized.push(slots[idx]);
        }
      }
    }

    let sequenceSlots = normalized.filter((v, i, a) => a.indexOf(v) === i);
    if (sequenceSlots.length < 2) {
      sequenceSlots = shuffleInPlace(slots.slice()).slice(0, desiredLen);
    }

    mission.state.sequenceSlots = sequenceSlots.slice();
    mission.state.sequence = sequenceSlots
      .map((slot) => mission.state.switches.find((s) => s?.slot === slot)?.id)
      .filter(Boolean);
    mission.state.index = 0;
  }

  spawnSwitchSequenceWithClues(mission, options = {}) {
    const ws = this.worldState;
    const avoid = Array.isArray(options.avoid) ? options.avoid.filter(Boolean) : [];
    if (!ws) return;

    // Reuse the switch spawner (creates `switches`, `sequenceSlots`, `sequence`).
    this.spawnSwitchSequence(mission, options);

    const seqSlots = Array.isArray(mission.state.sequenceSlots) ? mission.state.sequenceSlots : [];
    if (seqSlots.length < 2) {
      this.failOpenMission(mission, 'no valid sequence');
      return;
    }

    const clueRoomTypes = Array.isArray(mission.params.roomTypesClues)
      ? mission.params.roomTypesClues
      : (Array.isArray(mission.params.roomTypes) ? mission.params.roomTypes : null);

    const switchTiles = Array.isArray(mission.state.switches)
      ? mission.state.switches.map((s) => s?.gridPos).filter(Boolean)
      : [];

    const desiredClues = clamp(Math.round(mission.params.clues ?? mission.params.countClues ?? seqSlots.length), 2, seqSlots.length);
    const maxClues = Number.isFinite(this.objectBudgetRemaining)
      ? Math.max(0, Math.min(desiredClues, this.objectBudgetRemaining))
      : desiredClues;

    const clueTiles = pickDistinctRoomTiles(ws, maxClues, {
      allowedRoomTypes: clueRoomTypes,
      minDistFrom: avoid.concat(switchTiles),
      minDist: mission.params.minDistFromSpawn ?? 7,
      margin: 1
    });

    const count = clueTiles.length;
    mission.state.clues = [];
    mission.state.cluesTotal = count;
    mission.state.cluesCollected = 0;
    mission.state.sequenceKnown = false;

    if (count < 2) {
      // Still solvable without clues; fail-open the clue gating.
      mission.state.sequenceKnown = true;
      return;
    }

    for (let i = 0; i < count; i++) {
      if (!this.canSpawnMissionObject(1)) break;
      const pos = clueTiles[i];
      const stepIndex = i;
      const slot = seqSlots[stepIndex] || '?';
      const object3d = createClueNoteObject(slot);
      const world = gridToWorldCenter(pos);
      object3d.position.set(world.x, 0, world.z);
      object3d.rotation.y = Math.random() * Math.PI * 2;

      this.scene.add(object3d);
      this.spawnedObjects.push(object3d);
      this.consumeMissionObjectBudget(1);

      const clueId = `seqClue:${mission.id}:${stepIndex + 1}`;
      const label = `Read Sequence Note ${stepIndex + 1}`;
      this.registeredIds.push(
        this.interactables.register({
          id: clueId,
          kind: 'sequenceClue',
          label,
          gridPos: { x: pos.x, y: pos.y },
          object3d,
          prompt: () => `E: ${label}`,
          interact: () => ({ ok: true, picked: true, message: `Note ${stepIndex + 1} found` }),
          meta: { missionId: mission.id, template: mission.template, index: stepIndex, stepIndex, slot }
        })
      );
      this.interactableMeta.set(clueId, { missionId: mission.id, template: mission.template, index: stepIndex, stepIndex, slot });
      mission.state.clues.push({ id: clueId, gridPos: { x: pos.x, y: pos.y }, collected: false, stepIndex, slot });
    }

    mission.state.cluesTotal = mission.state.clues.length;
    if (mission.state.cluesTotal < 2) {
      mission.state.sequenceKnown = true;
    }
  }

  spawnEscort(mission, options = {}) {
    const ws = this.worldState;
    const avoid = Array.isArray(options.avoid) ? options.avoid.filter(Boolean) : [];
    if (!ws) return;

    const roomTypes = Array.isArray(mission.params.roomTypesEscort)
      ? mission.params.roomTypesEscort
      : (Array.isArray(mission.params.roomTypes) ? mission.params.roomTypes : null);

    const tiles = pickDistinctTiles(ws, 1, {
      allowedRoomTypes: roomTypes,
      minDistFrom: avoid,
      minDist: mission.params.minDistFromSpawn ?? 8,
      margin: 1
    });
    if (tiles.length === 0) {
      this.failOpenMission(mission, 'no valid escort tile');
      return;
    }
    if (!this.canSpawnMissionObject(1)) {
      this.failOpenMission(mission, 'mission object budget exhausted');
      return;
    }

    const pos = tiles[0];
    const object3d = createEscortBuddyObject();
    const world = gridToWorldCenter(pos);
    object3d.position.set(world.x, 0, world.z);

    this.scene.add(object3d);
    this.spawnedObjects.push(object3d);
    this.consumeMissionObjectBudget(1);

    const escortId = `escort:${mission.id}`;
    mission.state.escortId = escortId;
    mission.state.escortGridPos = { x: pos.x, y: pos.y };
    mission.state.goalGridPos = ws.getExitPoint?.() || null;
    mission.state.object3d = object3d;

    const label = 'Escort Survivor';
    this.registeredIds.push(
      this.interactables.register({
        id: escortId,
        kind: 'escortBuddy',
        label,
        gridPos: { x: pos.x, y: pos.y },
        object3d,
        maxDistance: 2.6,
        prompt: () => (mission.state.started ? 'Escort in progress' : 'E: Start Escort'),
        interact: ({ entry }) => {
          void entry;
          if (mission.state.started) return { ok: true, message: 'Escort already started', state: { started: true } };
          return { ok: true, message: 'Escort started', state: { started: true } };
        },
        meta: { missionId: mission.id, template: mission.template, started: false }
      })
    );
    this.interactableMeta.set(escortId, { missionId: mission.id, template: mission.template });
  }

  spawnEscortToSafeRoom(mission, options = {}) {
    const ws = this.worldState;
    const avoid = Array.isArray(options.avoid) ? options.avoid.filter(Boolean) : [];
    if (!ws) return;

    const escortRoomTypes = Array.isArray(mission.params.roomTypesEscort)
      ? mission.params.roomTypesEscort
      : (Array.isArray(mission.params.roomTypes) ? mission.params.roomTypes : null);

    const safeRoomTypes = Array.isArray(mission.params.safeRoomTypes)
      ? mission.params.safeRoomTypes
      : (Array.isArray(mission.params.roomTypesGoal)
        ? mission.params.roomTypesGoal
        : (Array.isArray(mission.params.roomTypes) ? mission.params.roomTypes : null));

    const tiles = pickDistinctTiles(ws, 1, {
      allowedRoomTypes: escortRoomTypes,
      minDistFrom: avoid,
      minDist: mission.params.minDistFromSpawn ?? 8,
      margin: 1
    });
    if (tiles.length === 0) {
      this.failOpenMission(mission, 'no valid escort tile');
      return;
    }
    if (!this.canSpawnMissionObject(1)) {
      this.failOpenMission(mission, 'mission object budget exhausted');
      return;
    }

    const pos = tiles[0];
    const buddy = createEscortBuddyObject();
    const world = gridToWorldCenter(pos);
    buddy.position.set(world.x, 0, world.z);

    this.scene.add(buddy);
    this.spawnedObjects.push(buddy);
    this.consumeMissionObjectBudget(1);

    const escortId = `escortSafe:${mission.id}`;
    mission.state.escortId = escortId;
    mission.state.escortGridPos = { x: pos.x, y: pos.y };
    mission.state.object3d = buddy;

    const goalTiles = pickDistinctRoomTiles(ws, 1, {
      allowedRoomTypes: safeRoomTypes,
      minDistFrom: avoid.concat([pos]),
      minDist: mission.params.minDistFromSpawn ?? 10,
      margin: 1
    });

    const safeGoal = goalTiles[0] ? { x: goalTiles[0].x, y: goalTiles[0].y } : (ws.getExitPoint?.() || null);
    mission.state.safeGoalGridPos = safeGoal;

    // Compute a checkpoint roughly halfway (best effort).
    let checkpoint = safeGoal;
    if (safeGoal && this.pathfinder?.findPath) {
      const path = this.pathfinder.findPath(pos, safeGoal, true, null) || [];
      if (Array.isArray(path) && path.length >= 4) {
        checkpoint = path[Math.floor(path.length / 2)] || safeGoal;
      }
    }

    mission.state.checkpointGridPos = checkpoint;
    mission.state.goalGridPos = checkpoint;

    // Visual marker for the checkpoint (not interactable).
    if (checkpoint && this.canSpawnMissionObject(1)) {
      const marker = createSensorObject({ armed: true, active: true, success: false });
      const mWorld = gridToWorldCenter(checkpoint);
      marker.position.set(mWorld.x, 0, mWorld.z);
      this.scene.add(marker);
      this.spawnedObjects.push(marker);
      this.consumeMissionObjectBudget(1);
      mission.state.checkpointMarker = marker;
    } else {
      mission.state.checkpointMarker = null;
    }

    const label = 'Escort Survivor';
    this.registeredIds.push(
      this.interactables.register({
        id: escortId,
        kind: 'escortBuddy',
        label,
        gridPos: { x: pos.x, y: pos.y },
        object3d: buddy,
        maxDistance: 2.6,
        prompt: () => (mission.state.started ? 'Escort in progress' : 'E: Start Escort'),
        interact: ({ entry }) => {
          void entry;
          if (mission.state.started) return { ok: true, message: 'Escort already started', state: { started: true } };
          return { ok: true, message: 'Escort started', state: { started: true } };
        },
        meta: { missionId: mission.id, template: mission.template, started: false }
      })
    );
    this.interactableMeta.set(escortId, { missionId: mission.id, template: mission.template });
  }

  onKeypadCodeSubmitted(payload) {
    const keypadId = String(payload?.keypadId || '').trim();
    if (!keypadId) return;

    const meta = this.interactableMeta.get(keypadId);
    if (!meta) return;

    const mission = this.missions.get(meta.missionId);
    if (!mission || (mission.template !== 'codeLock' && mission.template !== 'codeLockScan')) return;

    const actorKind = payload?.actorKind || 'player';
    const submitted = String(payload?.code || '').trim();
    const expected = String(mission.state.code || '').trim();

    if (mission.state.unlocked) {
      this.eventBus?.emit?.(EVENTS.KEYPAD_CODE_RESULT, { actorKind, keypadId, ok: true, code: submitted });
      return;
    }

    if (!mission.state.codeReady || !expected) {
      if (actorKind === 'player') {
        this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'Keypad is locked (missing clues).', seconds: 1.7 });
      }
      this.eventBus?.emit?.(EVENTS.KEYPAD_CODE_RESULT, { actorKind, keypadId, ok: false, code: submitted, message: 'Locked' });
      return;
    }

    if (submitted === expected) {
      mission.state.unlocked = true;
      const entry = this.interactables?.get?.(keypadId) || null;
      if (entry?.meta) {
        entry.meta.unlocked = true;
      }
      if (entry?.object3d) {
        setKeypadState(entry.object3d, true);
      }
      if (actorKind === 'player') {
        this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'Correct code. Keypad unlocked.', seconds: 2.0 });
      }

      if (mission.template === 'codeLockScan') {
        const targets = Array.isArray(mission.state.scanTargets) ? mission.state.scanTargets : [];
        for (const t of targets) {
          if (!t?.id) continue;
          const e = this.interactables?.get?.(t.id) || null;
          if (e) e.enabled = true;
          if (e?.object3d) e.object3d.visible = true;
        }
        if (actorKind === 'player' && targets.length > 0) {
          this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'Now collect the sample.', seconds: 1.8 });
        }
      }

      this.eventBus?.emit?.(EVENTS.KEYPAD_CODE_RESULT, { actorKind, keypadId, ok: true, code: submitted });
      this.syncStatus();
      return;
    }

    mission.state.failedAttempts = (mission.state.failedAttempts || 0) + 1;
    if (actorKind === 'player') {
      this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'Incorrect code.', seconds: 1.6 });
      const entry = this.interactables?.get?.(keypadId) || null;
      const pos = entry?.object3d?.position || null;
      if (pos) {
        this.eventBus?.emit?.(EVENTS.NOISE_REQUESTED, {
          source: 'player',
          kind: 'keypad',
          strength: 0.25,
          position: pos,
          radius: 6,
          ttl: 0.7
        });
      }
    }

    if (mission.template === 'codeLockScan') {
      const alarmOnWrong = mission.params?.alarmOnWrong !== false;
      const entry = this.interactables?.get?.(keypadId) || null;
      const pos = entry?.object3d?.position || null;
      if (alarmOnWrong && pos) {
        const now = Number.isFinite(this.elapsedSec) ? this.elapsedSec : 0;
        const last = Number(mission.state.lastAlarmAtSec) || -999;
        const cooldown = clamp(Math.round(mission.params?.alarmCooldownSec ?? 3), 0, 30);
        if (now - last >= cooldown) {
          mission.state.lastAlarmAtSec = now;
          this.eventBus?.emit?.(EVENTS.NOISE_REQUESTED, {
            source: 'alarm',
            kind: String(mission.params?.alarmKind || 'alarm'),
            strength: clamp(Number(mission.params?.alarmStrength ?? 0.9), 0.1, 2.0),
            position: pos,
            radius: clamp(Math.round(mission.params?.alarmRadius ?? 22), 4, 80),
            ttl: clamp(Number(mission.params?.alarmTtl ?? 1.2), 0.2, 6.0)
          });
          if (actorKind === 'player') {
            this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'Alarm triggered.', seconds: 1.4 });
          }
        }
      }
    }

    this.eventBus?.emit?.(EVENTS.KEYPAD_CODE_RESULT, { actorKind, keypadId, ok: false, code: submitted, message: 'Incorrect' });
  }

  syncBossFinaleMission(mission) {
    if (!mission || mission.template !== 'bossFinale') return;
    const boss = this.bossSystem?.getState ? this.bossSystem.getState() : null;
    if (!boss || boss.active !== true) {
      const cfg = this.levelConfig?.boss || null;
      const fallbackNodes = cfg?.enabled === true ? Math.max(1, Math.round(Number(cfg.shieldNodes) || 3)) : 0;
      const fallbackHp = Math.max(1, Math.round(Number(CONFIG.BOSS_CORE_HEALTH) || 120));
      mission.state = {
        ...(mission.state || {}),
        phase: fallbackNodes > 0 ? 1 : 0,
        nodesTotal: fallbackNodes,
        nodesRemaining: fallbackNodes,
        bossMaxHealth: fallbackHp,
        bossHealth: fallbackHp,
        shieldActive: false,
        escapeUntilSec: 0
      };
      return;
    }

    mission.state.phase = Math.max(0, Math.round(Number(boss.phase) || 0));
    mission.state.nodesTotal = Math.max(0, Math.round(Number(boss.nodesTotal) || 0));
    mission.state.nodesRemaining = Math.max(0, Math.round(Number(boss.nodesRemaining) || 0));
    mission.state.bossMaxHealth = Math.max(1, Math.round(Number(boss.bossMaxHealth) || 1));
    mission.state.bossHealth = Math.max(0, Math.round(Number(boss.bossHealth) || 0));
    mission.state.shieldActive = boss.shieldActive === true;
    mission.state.escapeUntilSec = Number.isFinite(Number(boss.escapeUntilSec)) ? Number(boss.escapeUntilSec) : 0;
    mission.state.escapeSeconds = Math.max(0, Math.round(Number(boss.escapeSeconds) || 0));
  }

  onBossUpdated(payload) {
    void payload;
    let changed = false;
    for (const mission of this.missions.values()) {
      if (!mission || mission.template !== 'bossFinale') continue;
      this.syncBossFinaleMission(mission);
      changed = true;
    }
    if (changed) this.syncStatus();
  }

  onItemPicked(payload) {
    const id = String(payload?.id || '').trim();
    if (!id) return;
    const meta = this.interactableMeta.get(id);
    if (!meta) return;

    const mission = this.missions.get(meta.missionId);
    if (!mission) return;

    if (mission.template === 'findKeycard') {
      mission.state.found = true;
    } else if (mission.template === 'collectEvidence') {
      mission.state.collected = Math.min(mission.state.required, (mission.state.collected || 0) + 1);
      if (Array.isArray(mission.state.items) && Number.isFinite(meta.index)) {
        const item = mission.state.items[meta.index];
        if (item) item.collected = true;
      }
    } else if (mission.template === 'restorePowerFuses') {
      const fuses = Array.isArray(mission.state.fuses) ? mission.state.fuses : [];
      const fuse = fuses.find((f) => f && f.id === id);
      if (fuse && !fuse.collected) {
        fuse.collected = true;

        const itemId = String(mission.params.itemId || 'fuse').trim() || 'fuse';
        this.eventBus?.emit?.(EVENTS.INVENTORY_GIVE_ITEM, { actorKind: payload?.actorKind || 'player', itemId, count: 1, sourceId: id });
      }

      const collected = fuses.filter((f) => f?.collected).length;
      mission.state.fusesCollected = Math.min(mission.state.fusesRequired || collected, collected);

      if (!mission.state.installed && collected >= (mission.state.fusesRequired || 0)) {
        this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'All fuses collected. Find the power panel.', seconds: 2.0 });
      }
    } else if (mission.template === 'powerGrid') {
      const fuses = Array.isArray(mission.state.fuses) ? mission.state.fuses : [];
      const fuse = fuses.find((f) => f && f.id === id);
      if (fuse && !fuse.collected) {
        fuse.collected = true;
        const itemId = String(mission.state.itemId || mission.params.itemId || 'fuse').trim() || 'fuse';
        mission.state.itemId = itemId;
        this.eventBus?.emit?.(EVENTS.INVENTORY_GIVE_ITEM, { actorKind: payload?.actorKind || 'player', itemId, count: 1, sourceId: id });
      }

      const collected = fuses.filter((f) => f?.collected).length;
      mission.state.fusesCollected = collected;

      const branches = Array.isArray(mission.state.branches) ? mission.state.branches : [];
      const required = Number(mission.state.requiredPowered) || branches.length || 0;
      if (payload?.actorKind === 'player' && required > 0 && collected >= required) {
        this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'Enough fuses collected. Restore the power nodes.', seconds: 2.0 });
      }
    } else if (mission.template === 'uploadEvidence') {
      mission.state.collected = Math.min(mission.state.total || 0, (mission.state.collected || 0) + 1);
      if (Array.isArray(mission.state.items) && Number.isFinite(meta.index)) {
        const item = mission.state.items[meta.index];
        if (item && !item.collected) {
          item.collected = true;
          const itemId = String(mission.params.itemId || 'evidence').trim() || 'evidence';
          this.eventBus?.emit?.(EVENTS.INVENTORY_GIVE_ITEM, { actorKind: payload?.actorKind || 'player', itemId, count: 1, sourceId: id });
        }
      }

      if (!mission.state.uploaded && (mission.state.collected || 0) >= (mission.state.required || 0)) {
        this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'Evidence collected. Find the upload terminal.', seconds: 2.0 });
      }
    } else if (mission.template === 'deliverItemToTerminal') {
      mission.state.collected = Math.min(mission.state.total || 0, (mission.state.collected || 0) + 1);
      if (Array.isArray(mission.state.items) && Number.isFinite(meta.index)) {
        const item = mission.state.items[meta.index];
        if (item && !item.collected) {
          item.collected = true;
          const itemId = String(mission.state.itemId || mission.params.itemId || 'package').trim() || 'package';
          mission.state.itemId = itemId;
          this.eventBus?.emit?.(EVENTS.INVENTORY_GIVE_ITEM, { actorKind: payload?.actorKind || 'player', itemId, count: 1, sourceId: id });
        }
      }

      if (!mission.state.delivered && (mission.state.collected || 0) >= (mission.state.required || 0)) {
        this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'Packages collected. Find the delivery terminal.', seconds: 2.0 });
      }
    } else if (mission.template === 'reroutePower') {
      if (id === String(mission.state.clueId || '').trim()) {
        mission.state.clueRead = true;
        const slots = Array.isArray(mission.state.solutionSlots) ? mission.state.solutionSlots : [];
        const list = slots.length > 0 ? slots.join(', ') : '';
        const text = list ? `Routing note: enable breakers ${list}.` : 'Routing note read.';
        if (payload?.actorKind === 'player') {
          this.eventBus?.emit?.(EVENTS.UI_TOAST, { text, seconds: 2.2 });
        }
      }
    } else if (mission.template === 'switchSequenceWithClues') {
      const clues = Array.isArray(mission.state.clues) ? mission.state.clues : [];
      const clue = clues.find((c) => c && c.id === id);
      if (clue && !clue.collected) {
        clue.collected = true;
      }
      const collected = clues.filter((c) => c?.collected).length;
      mission.state.cluesCollected = collected;
      const total = Number(mission.state.cluesTotal) || clues.length || 0;
      mission.state.cluesTotal = total;

      if (payload?.actorKind === 'player' && clue?.slot) {
        const step = Number.isFinite(clue.stepIndex) ? clue.stepIndex + 1 : null;
        const stepLabel = Number.isFinite(step) ? `#${step}` : 'Note';
        this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: `${stepLabel}: ${clue.slot}`, seconds: 1.5 });
      }

      if (total > 0 && collected >= total) {
        mission.state.sequenceKnown = true;
        if (payload?.actorKind === 'player') {
          this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'All sequence notes found. Activate switches in order.', seconds: 2.1 });
        }
      }
    } else if (mission.template === 'codeLock') {
      const clues = Array.isArray(mission.state.clues) ? mission.state.clues : [];
      const clue = clues.find((c) => c && c.id === id);
      if (clue && !clue.collected) {
        clue.collected = true;
      }
      const collected = clues.filter((c) => c?.collected).length;
      mission.state.cluesCollected = collected;
      const total = Number(mission.state.cluesTotal) || clues.length || 0;
      mission.state.cluesTotal = total;
      if (total > 0 && collected >= total) {
        const ordered = clues
          .slice()
          .sort((a, b) => String(a?.slot || '').localeCompare(String(b?.slot || '')));
        mission.state.code = ordered.map((c) => String(c?.digit ?? '?')).join('');
        mission.state.codeReady = true;
        this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'All clues found. Find the keypad.', seconds: 2.2 });
      }
    } else if (mission.template === 'lockedDoor') {
      if (payload?.kind === 'key') {
        mission.state.keyPicked = true;
        const itemId = String(mission.state.keyItemId || mission.params.keyItemId || mission.params.itemId || 'door_key').trim() || 'door_key';
        this.eventBus?.emit?.(EVENTS.INVENTORY_GIVE_ITEM, { actorKind: payload?.actorKind || 'player', itemId, count: 1, sourceId: id });
        this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'Key acquired. Find the locked door.', seconds: 1.8 });
      }
    } else if (mission.template === 'placeItemsAtAltars') {
      const items = Array.isArray(mission.state.items) ? mission.state.items : [];
      if (Number.isFinite(meta.index)) {
        const item = items[meta.index];
        if (item && !item.collected) {
          item.collected = true;
          const itemId = String(mission.state.itemId || mission.params.itemId || 'relic').trim() || 'relic';
          this.eventBus?.emit?.(EVENTS.INVENTORY_GIVE_ITEM, { actorKind: payload?.actorKind || 'player', itemId, count: 1, sourceId: id });
        }
      }
      const collected = items.filter((i) => i?.collected).length;
      mission.state.itemsCollected = Math.min(mission.state.itemsRequired || collected, collected);
      if ((mission.state.itemsRequired || 0) > 0 && collected >= (mission.state.itemsRequired || 0)) {
        this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'All relics collected. Find the altars.', seconds: 1.9 });
      }
    } else if (mission.template === 'placeKeysAtLocks') {
      const keys = Array.isArray(mission.state.keys) ? mission.state.keys : [];
      if (Number.isFinite(meta.index)) {
        const key = keys[meta.index];
        if (key && !key.collected) {
          key.collected = true;
          const itemId = String(key.itemId || meta.itemId || '').trim();
          if (itemId) {
            this.eventBus?.emit?.(EVENTS.INVENTORY_GIVE_ITEM, { actorKind: payload?.actorKind || 'player', itemId, count: 1, sourceId: id });
          }
          if (payload?.actorKind === 'player' && key.slot) {
            this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: `Key ${key.slot} acquired.`, seconds: 1.5 });
          }
        }
      }

      const collected = keys.filter((k) => k?.collected).length;
      const required = Number(mission.state.required) || keys.length || 0;
      mission.state.required = required;
      mission.state.keysCollected = Math.min(required || collected, collected);

      if (payload?.actorKind === 'player' && required > 0 && collected >= required) {
        this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'All keys collected. Find the locks.', seconds: 1.9 });
      }
    } else if (mission.template === 'searchAndTagRoom') {
      const targets = Array.isArray(mission.state.targets) ? mission.state.targets : [];
      if (Number.isFinite(meta.index)) {
        const t = targets[meta.index];
        if (t && !t.tagged) t.tagged = true;
      }
      const tagged = targets.filter((t) => t?.tagged).length;
      mission.state.tagged = Math.min(mission.state.required || tagged, tagged);
      if ((mission.state.required || 0) > 0 && tagged >= (mission.state.required || 0)) {
        this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'All targets tagged.', seconds: 1.6 });
      }
    } else if (mission.template === 'searchRoomTypeN') {
      const targets = Array.isArray(mission.state.targets) ? mission.state.targets : [];
      if (Number.isFinite(meta.index)) {
        const t = targets[meta.index];
        if (t && !t.searched) t.searched = true;
      }
      const searched = targets.filter((t) => t?.searched).length;
      mission.state.searched = Math.min(mission.state.required || searched, searched);
      if ((mission.state.required || 0) > 0 && searched >= (mission.state.required || 0)) {
        this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'Search complete.', seconds: 1.6 });
      }
    } else if (mission.template === 'photographEvidence') {
      const targets = Array.isArray(mission.state.targets) ? mission.state.targets : [];
      if (Number.isFinite(meta.index)) {
        const t = targets[meta.index];
        if (t && !t.completed && !t.photographed) t.completed = true;
      }
      const photos = targets.filter((t) => t?.completed || t?.photographed).length;
      mission.state.photos = Math.min(mission.state.required || photos, photos);
      if ((mission.state.required || 0) > 0 && photos >= (mission.state.required || 0)) {
        this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'All photos captured.', seconds: 1.6 });
      }
    }

    this.syncStatus();
  }

  onInteract(payload) {
    const id = String(payload?.id || '').trim();
    if (!id) return;

    if (id === 'exit') {
      const requires = this.missionsConfig?.exit?.requires || [];
      const requiredIds = Array.isArray(requires) ? requires : [];

      let changed = false;
      for (const mission of this.missions.values()) {
        if (!mission) continue;
        if (mission.template !== 'unlockExit') continue;
        if (this.isMissionComplete(mission)) continue;

        const prereqs = requiredIds.filter((rid) => rid !== mission.id);
        let ok = true;
        for (const rid of prereqs) {
          const reqMission = this.missions.get(rid);
          if (!reqMission) continue;
          if (!this.isMissionComplete(reqMission)) {
            ok = false;
            break;
          }
        }

        if (!ok) continue;
        mission.state.unlocked = true;
        changed = true;
      }

      if (changed) {
        this.syncStatus();
      }

      return;
    }

    if (payload?.kind === 'hidingSpot') {
      const hidden = payload?.result?.state?.hidden;
      if (typeof hidden === 'boolean') {
        this.playerHidden = hidden;
        this.playerHiddenSpotId = hidden ? id : null;
        if (!hidden) {
          for (const mission of this.missions.values()) {
            if (!mission) continue;
            if (mission.template !== 'hideForSeconds') continue;
            if (mission.state?.completed) continue;
            mission.state.hiddenForSec = 0;
          }
        }
        this.syncStatus();
      }
      return;
    }

    const meta = this.interactableMeta.get(id);
    if (!meta) return;

    const mission = this.missions.get(meta.missionId);
    if (!mission) return;

    if (mission.template === 'restorePower') {
      const on = !!payload?.result?.state?.on;
      if (on) {
        mission.state.activated.add(id);
        if (Array.isArray(mission.state.switches)) {
          const sw = mission.state.switches.find((s) => s.id === id);
          if (sw) sw.on = true;
        }
      }
    } else if (mission.template === 'syncActivate') {
      const on = !!payload?.result?.state?.on;
      if (on) {
        const windowSec = clamp(Math.round(mission.state.windowSec ?? mission.params?.windowSec ?? 15), 5, 90);
        mission.state.windowSec = windowSec;

        const expired = mission.state.started && Number.isFinite(mission.state.activeUntilSec) && this.elapsedSec > mission.state.activeUntilSec;
        if (expired) {
          this.resetSyncActivateSwitches(mission);
        }
        if (!mission.state.started) {
          mission.state.started = true;
          mission.state.activeUntilSec = this.elapsedSec + windowSec;
        }

        mission.state.activated.add(id);
        if (Array.isArray(mission.state.switches)) {
          const sw = mission.state.switches.find((s) => s.id === id);
          if (sw) {
            sw.on = true;
            const entry = this.interactables?.get?.(id) || null;
            if (entry?.meta) entry.meta.on = true;
            if (entry?.object3d) setPowerSwitchState(entry.object3d, true);
            if (sw.object3d) setPowerSwitchState(sw.object3d, true);
          }
        }

        const total = Number(mission.state.total) || (Array.isArray(mission.state.switches) ? mission.state.switches.length : 0);
        const activated = mission.state.activated?.size || 0;
        if (total > 0 && activated >= total) {
          this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'Sync complete.', seconds: 1.6 });
        } else if (payload?.actorKind === 'player') {
          const remaining = Math.max(0, (Number(mission.state.activeUntilSec) || 0) - this.elapsedSec);
          this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: `Sync ${activated}/${total} (${Math.ceil(remaining)}s)`, seconds: 1.1 });
        }
      }
    } else if (mission.template === 'reroutePower') {
      if (mission.state.powered) {
        // No-op.
      } else if (payload?.kind === 'rerouteBreaker') {
        const turnedOn = !!payload?.result?.state?.on;
        if (!turnedOn) {
          // Only one-way toggles are expected.
        } else {
          const slot = String(payload?.result?.state?.slot || meta.slot || '').trim().toUpperCase();
          const breakers = Array.isArray(mission.state.breakers) ? mission.state.breakers : [];
          const breaker = breakers.find((b) => b && b.id === id);
          if (breaker) breaker.on = true;

          if (!mission.state.clueRead) {
            mission.state.failures = (Number(mission.state.failures) || 0) + 1;
            this.resetRerouteBreakers(mission);
            if (payload?.actorKind === 'player') {
              this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'Find the routing note first.', seconds: 1.6 });
            }
          } else {
            const solutionSlots = Array.isArray(mission.state.solutionSlots) ? mission.state.solutionSlots : [];
            const requiredOn = solutionSlots.length;
            if (!solutionSlots.includes(slot)) {
              mission.state.failures = (Number(mission.state.failures) || 0) + 1;
              this.resetRerouteBreakers(mission);
              if (payload?.actorKind === 'player') {
                this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'Wrong breaker. Routing reset.', seconds: 1.6 });
              }
            } else {
              const onCount = breakers.filter((b) => b?.on).length;
              if (requiredOn > 0 && onCount >= requiredOn) {
                mission.state.powered = true;
                if (payload?.actorKind === 'player') {
                  this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'Power rerouted.', seconds: 1.8 });
                }
              } else if (payload?.actorKind === 'player') {
                this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: `Correct breaker (${onCount}/${requiredOn})`, seconds: 1.2 });
              }
            }
          }
        }
      }
    } else if (mission.template === 'activateShrines') {
      const on = !!payload?.result?.state?.on;
      if (on) {
        mission.state.activated.add(id);
        if (Array.isArray(mission.state.shrines)) {
          const shrine = mission.state.shrines.find((s) => s.id === id);
          if (shrine) shrine.on = true;
        }

        const total = mission.state.total || 0;
        const activated = mission.state.activated?.size || 0;
        if (total > 0 && activated >= total) {
          this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'All shrines activated.', seconds: 1.9 });
        }
      }
    } else if (mission.template === 'restorePowerFuses') {
      if (payload?.kind === 'fusePanel') {
        const installed = !!payload?.result?.state?.installed;
        const powered = !!payload?.result?.state?.powered;

        if (installed && !mission.state.installed) {
          mission.state.installed = true;
          this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'Fuses installed. Turn on the power panel.', seconds: 2.0 });
        }
        if (powered && !mission.state.powered) {
          mission.state.powered = true;
          this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'Power restored.', seconds: 1.8 });
        }
      }
    } else if (mission.template === 'powerGrid') {
      if (payload?.kind === 'powerGridPanel' && Array.isArray(mission.state.branches) && Number.isFinite(meta.index)) {
        const branch = mission.state.branches[meta.index] || null;
        if (branch) {
          const installed = !!payload?.result?.state?.installed;
          const powered = !!payload?.result?.state?.powered;

          if (installed) branch.installed = true;

          if (powered && !branch.powered) {
            branch.powered = true;
            mission.state.powered = mission.state.branches.filter((b) => b?.powered).length;

            const zoneId = String(branch.zoneId || '').trim();
            if (zoneId && this.worldState) {
              const cur = Array.isArray(this.worldState.darkZones) ? this.worldState.darkZones : [];
              this.worldState.darkZones = cur.filter((z) => String(z?.id || '') !== zoneId);
            }

            const doorPos = branch.doorGridPos || null;
            if (doorPos && this.worldState?.setObstacle) {
              this.worldState.setObstacle(doorPos.x, doorPos.y, false);
            }
            if (branch.doorObject3d) {
              setLockedDoorState(branch.doorObject3d, { unlocked: true });
            }

            const required = Number(mission.state.requiredPowered) || 0;
            const done = Number(mission.state.powered) || 0;
            if (payload?.actorKind === 'player') {
              this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: `Power node ${branch.slot} online (${done}/${required})`, seconds: 1.6 });
            }
          }
        }
      }
    } else if (mission.template === 'uploadEvidence') {
      if (payload?.kind === 'terminal') {
        const uploading = !!payload?.result?.state?.uploading;
        if (uploading && !mission.state.uploading) {
          mission.state.uploading = true;
          mission.state.uploadProgressSec = 0;
          if (payload?.actorKind === 'player') {
            this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'Upload started.', seconds: 1.4 });
          }
        }
      }
    } else if (mission.template === 'blackoutZone') {
      if (payload?.kind === 'blackoutSwitch') {
        const restored = !!payload?.result?.state?.restored;
        if (restored && Array.isArray(mission.state.zones) && Number.isFinite(meta.index)) {
          const zone = mission.state.zones[meta.index] || null;
          if (zone) zone.restored = true;

          const restoredCount = mission.state.zones.filter((z) => z?.restored).length;
          mission.state.restored = restoredCount;

          const zoneId = String(meta.zoneId || zone?.zoneId || '').trim();
          if (zoneId && this.worldState) {
            const cur = Array.isArray(this.worldState.darkZones) ? this.worldState.darkZones : [];
            this.worldState.darkZones = cur.filter((z) => String(z?.id || '') !== zoneId);
          }

          const required = Number(mission.state.required) || 0;
          if (payload?.actorKind === 'player') {
            const msg = required > 0 ? `Lights restored (${restoredCount}/${required})` : 'Lights restored';
            this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: msg, seconds: 1.6 });
          }
        }
      }
    } else if (mission.template === 'deliverItemToTerminal') {
      if (payload?.kind === 'terminal') {
        const delivered = !!payload?.result?.state?.delivered;
        if (delivered && !mission.state.delivered) {
          mission.state.delivered = true;
          this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'Delivery complete.', seconds: 1.8 });
        }
      }
    } else if (mission.template === 'switchSequence' || mission.template === 'switchSequenceWithClues') {
      if (payload?.kind === 'sequenceSwitch') {
        const turnedOn = !!payload?.result?.state?.on;
        if (turnedOn && Array.isArray(mission.state.switches)) {
          const sw = mission.state.switches.find((s) => s?.id === id);
          if (sw) sw.on = true;

          const seq = Array.isArray(mission.state.sequence) ? mission.state.sequence : [];
          const slots = Array.isArray(mission.state.sequenceSlots) ? mission.state.sequenceSlots : [];
          const idx = clamp(Math.round(mission.state.index ?? 0), 0, seq.length);
          const expectedId = idx >= 0 && idx < seq.length ? seq[idx] : null;
          const expectedSlot = idx >= 0 && idx < slots.length ? slots[idx] : null;
          const actualSlot = payload?.result?.state?.slot || sw?.slot || null;

          const requiresClues = mission.template === 'switchSequenceWithClues';
          const sequenceKnown = !requiresClues || !!mission.state.sequenceKnown;

          if (!sequenceKnown) {
            mission.state.index = 0;
            for (const s of mission.state.switches) {
              if (!s?.id) continue;
              s.on = false;
              const entry = this.interactables?.get?.(s.id) || null;
              if (entry?.meta) entry.meta.on = false;
              if (entry?.object3d) setPowerSwitchState(entry.object3d, false);
            }
            if (payload?.actorKind === 'player') {
              this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'Find the sequence notes first.', seconds: 1.7 });
            }
          } else if (expectedId && id === expectedId) {
            mission.state.index = Math.min(seq.length, idx + 1);
            const nextIdx = mission.state.index;
            if (nextIdx >= seq.length && seq.length >= 2) {
              this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'Switch sequence complete.', seconds: 1.8 });
            } else if (seq.length >= 2) {
              const nextSlot = slots[nextIdx] || '?';
              this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: `Correct: ${actualSlot || '?'} → Next: ${nextSlot}`, seconds: 1.4 });
            }
          } else if (seq.length >= 2) {
            if (mission.state.resetOnWrong !== false) {
              mission.state.index = 0;
              for (const s of mission.state.switches) {
                if (!s?.id) continue;
                s.on = false;
                const entry = this.interactables?.get?.(s.id) || null;
                if (entry?.meta) entry.meta.on = false;
                if (entry?.object3d) setPowerSwitchState(entry.object3d, false);
              }
              const hint = expectedSlot ? `Expected ${expectedSlot}` : 'Wrong switch';
              this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: `${hint}. Sequence reset.`, seconds: 1.6 });
            } else {
              const entry = this.interactables?.get?.(id) || null;
              if (entry?.meta) entry.meta.on = false;
              if (entry?.object3d) setPowerSwitchState(entry.object3d, false);
              if (sw) sw.on = false;
              const hint = expectedSlot ? `Expected ${expectedSlot}` : 'Wrong switch';
              this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: `${hint}.`, seconds: 1.3 });
            }
          }
        }
      }
    } else if (mission.template === 'escort' || mission.template === 'escortRescue') {
      if (payload?.kind === 'escortBuddy') {
        const started = !!payload?.result?.state?.started;
        if (started && !mission.state.started) {
          mission.state.started = true;
          const entry = this.interactables?.get?.(id) || null;
          if (entry) entry.enabled = false;
          const msg = mission.template === 'escortRescue'
            ? 'Rescue started. Lead them to the exit.'
            : 'Escort started. Lead them to the exit.';
          this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: msg, seconds: 2.0 });
        }
      }
    } else if (mission.template === 'escortToSafeRoom') {
      if (payload?.kind === 'escortBuddy') {
        const started = !!payload?.result?.state?.started;
        if (started && !mission.state.started) {
          mission.state.started = true;
          mission.state.stage = 1;
          mission.state.waitedSec = 0;

          const entry = this.interactables?.get?.(id) || null;
          if (entry) entry.enabled = false;

          const checkpoint = mission.state.checkpointGridPos || null;
          const safeGoal = mission.state.safeGoalGridPos || null;

          if (checkpoint && Number.isFinite(checkpoint.x) && Number.isFinite(checkpoint.y)) {
            mission.state.goalGridPos = { x: checkpoint.x, y: checkpoint.y };
          } else if (safeGoal && Number.isFinite(safeGoal.x) && Number.isFinite(safeGoal.y)) {
            mission.state.goalGridPos = { x: safeGoal.x, y: safeGoal.y };
            mission.state.stage = 3;
          }

          this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'Escort started. Lead them to the checkpoint.', seconds: 2.0 });
        }
      }
    } else if (mission.template === 'surviveInZone') {
      if (payload?.kind === 'survivalBeacon') {
        const started = !!payload?.result?.state?.started;
        if (started && !mission.state.started) {
          mission.state.started = true;
          mission.state.outOfZoneSec = 0;
          mission.state.heldForSec = 0;
          this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'Hold the zone.', seconds: 1.6 });
        }
      }
    } else if (mission.template === 'occupyPoint') {
      if (payload?.kind === 'survivalBeacon') {
        const started = !!payload?.result?.state?.started;
        if (started && !mission.state.started) {
          mission.state.started = true;
          mission.state.outOfZoneSec = 0;
          mission.state.heldForSec = 0;
          mission.state.hazardActiveUntilSec = 0;
          mission.state.nextHazardAtSec = 0;
          this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'Hold the control point.', seconds: 1.6 });
        }
      }
    } else if (mission.template === 'codeLock') {
      if (payload?.kind === 'keypad') {
        const unlocked = !!payload?.result?.state?.unlocked;
        if (unlocked) {
          mission.state.unlocked = true;
        }
      }
    } else if (mission.template === 'lockedDoor') {
      if (payload?.kind === 'lockedDoor') {
        const unlocked = !!payload?.result?.state?.unlocked;
        if (unlocked) {
          mission.state.unlocked = true;
        }
      }
    } else if (mission.template === 'doorLockNetwork') {
      if (payload?.kind === 'networkDoor') {
        if (Array.isArray(mission.state.doors) && Number.isFinite(meta.index)) {
          const door = mission.state.doors[meta.index] || null;
          const unlocked = !!payload?.result?.state?.unlocked;
          if (door && unlocked) {
            door.unlocked = true;
            mission.state.unlocked = mission.state.doors.filter((d) => d?.unlocked).length;
            mission.state.lastBlockedDoor = null;
          } else if (!unlocked && door && payload?.ok === false) {
            const reason = payload?.result?.reason || payload?.result?.state?.reason || 'unknown';
            const itemId = payload?.result?.itemId || null;
            const missionId = payload?.result?.state?.missionId || door.requiresMissionId || door.hintMissionId || null;
            mission.state.lastBlockedDoor = { doorId: id, slot: door.slot || meta.slot || null, reason, itemId, missionId };
          }
        }
      }
    } else if (mission.template === 'placeKeysAtLocks') {
      if (payload?.kind === 'lockSocket') {
        const filled = !!payload?.result?.state?.filled;
        if (filled && Array.isArray(mission.state.locks) && Number.isFinite(meta.index)) {
          const lock = mission.state.locks[meta.index];
          if (lock) lock.filled = true;
          const filledCount = mission.state.locks.filter((l) => l?.filled).length;
          const required = Number(mission.state.required) || mission.state.locks.length || 0;
          mission.state.required = required;
          mission.state.locksFilled = Math.min(required || filledCount, filledCount);
          if (payload?.actorKind === 'player' && required > 0 && filledCount >= required) {
            this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'All locks unlocked.', seconds: 1.8 });
          }
        }
      }
    } else if (mission.template === 'placeItemsAtAltars') {
      if (payload?.kind === 'altar') {
        const filled = !!payload?.result?.state?.filled;
        if (filled && Array.isArray(mission.state.altars) && Number.isFinite(meta.index)) {
          const altar = mission.state.altars[meta.index];
          if (altar) altar.filled = true;
          const filledCount = mission.state.altars.filter((a) => a?.filled).length;
          mission.state.altarsFilled = Math.min(mission.state.altarsTotal || filledCount, filledCount);
        }
      }
    }

    this.syncStatus();
  }

  onRoomEntered(payload) {
    const roomType = payload?.roomType;
    if (!Number.isFinite(roomType)) return;

    for (const mission of this.missions.values()) {
      if (!mission) continue;
      if (mission.template !== 'enterRoomType') continue;
      if (this.isMissionComplete(mission)) continue;

      const allowed = normalizeRoomTypes(mission.state.roomTypes);
      if (!allowed || allowed.length === 0) continue;
      if (!allowed.includes(roomType)) continue;

      mission.state.entered = Math.min(mission.state.required || 1, (mission.state.entered || 0) + 1);
    }

    for (const mission of this.missions.values()) {
      if (!mission) continue;
      if (mission.template !== 'enterRoomSequence') continue;
      if (this.isMissionComplete(mission)) continue;

      const ignoreCorridor = mission.state.ignoreCorridor !== false;
      if (ignoreCorridor && roomType === ROOM_TYPES.CORRIDOR) continue;

      const sequence = Array.isArray(mission.state.sequence) ? mission.state.sequence : [];
      if (sequence.length < 2) continue;

      const idx = clamp(Math.round(mission.state.index ?? 0), 0, sequence.length);
      const expected = sequence[idx];

      if (roomType === expected) {
        mission.state.index = Math.min(sequence.length, idx + 1);
        const nextIdx = mission.state.index;
        if (nextIdx >= sequence.length) {
          this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'Sequence complete.', seconds: 1.8 });
        } else {
          const name = ROOM_CONFIGS?.[expected]?.name || 'Room';
          this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: `Sequence: ${name} (${nextIdx}/${sequence.length})`, seconds: 1.4 });
        }
        continue;
      }

      const resetOnWrong = mission.state.resetOnWrong !== false;
      if (!resetOnWrong) continue;

      // Only reset when entering a "sequence room" out of order; corridors / other rooms are neutral.
      if (sequence.includes(roomType) && idx > 0) {
        mission.state.index = 0;
        this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'Wrong room. Sequence reset.', seconds: 1.6 });
      }
    }

    this.syncStatus();
  }

  onMonsterKilled(payload) {
    const killed = payload?.monster || null;
    const killedId = Number(killed?.id);
    const killedWorldPos = payload?.worldPosition || killed?.getWorldPosition?.() || null;
    const killedGridPos = payload?.gridPosition || killed?.getGridPosition?.() || killed?.gridPos || null;

    for (const mission of this.missions.values()) {
      if (!mission) continue;
      if (mission.template !== 'killCount') continue;
      if (this.isMissionComplete(mission)) continue;

      mission.state.killed = Math.min(mission.state.required || 1, (mission.state.killed || 0) + 1);
    }

    if (Number.isFinite(killedId)) {
      for (const mission of this.missions.values()) {
        if (!mission) continue;
        if (mission.template !== 'reclaimStolenItem') continue;
        if (mission.state?.recovered) continue;
        if (mission.state?.dropped) continue;

        const thiefId = Number(mission.state?.thiefMonsterId);
        if (!Number.isFinite(thiefId) || thiefId <= 0) continue;
        if (thiefId !== killedId) continue;

        this.spawnReclaimStolenDrop(mission, { worldPosition: killedWorldPos, gridPosition: killedGridPos });
      }
    }

    this.syncStatus();
  }

  onPlayerHitMonster(payload) {
    const monster = payload?.monster || null;
    const id = Number(monster?.id);
    if (!Number.isFinite(id)) return;

    for (const mission of this.missions.values()) {
      if (!mission) continue;
      if (mission.template !== 'reclaimStolenItem') continue;
      if (mission.state?.recovered) continue;
      if (mission.state?.dropped) continue;

      const thiefId = Number(mission.state?.thiefMonsterId);
      if (!Number.isFinite(thiefId) || thiefId <= 0) continue;
      if (thiefId !== id) continue;

      mission.state.thiefHits = (Number(mission.state.thiefHits) || 0) + 1;

      const maxHp = Number(monster?.maxHealth) || 0;
      const hp = Number(monster?.health);
      const hpPct = maxHp > 0 && Number.isFinite(hp) ? clamp((hp / maxHp) * 100, 0, 100) : null;
      const dropAtHealthPct = Number.isFinite(Number(mission.state.dropAtHealthPct))
        ? clamp(Number(mission.state.dropAtHealthPct), 1, 99)
        : null;

      const dropOnHit = mission.state.dropOnHit === true;
      const hitsToDrop = clamp(Math.round(mission.state.hitsToDrop ?? 3), 1, 20);
      mission.state.hitsToDrop = hitsToDrop;

      const shouldDropByHits = dropOnHit && (Number(mission.state.thiefHits) || 0) >= hitsToDrop;
      const shouldDropByHealth = dropAtHealthPct !== null && hpPct !== null && hpPct <= dropAtHealthPct;

      if (shouldDropByHits || shouldDropByHealth) {
        const worldPosition = monster?.getWorldPosition?.() || null;
        const gridPosition = monster?.getGridPosition?.() || monster?.gridPos || null;
        this.spawnReclaimStolenDrop(mission, { worldPosition, gridPosition });
      }
    }
  }

  spawnReclaimStolenDrop(mission, { worldPosition = null, gridPosition = null } = {}) {
    if (!mission || mission.template !== 'reclaimStolenItem') return;
    if (mission.state?.recovered) return;
    if (mission.state?.dropped) return;

    if (!mission.state) mission.state = {};

    const itemId = String(mission.state.itemId || mission.params?.itemId || 'stolen_item').trim() || 'stolen_item';
    const itemCount = clamp(Math.round(mission.state.itemCount ?? mission.params?.itemCount ?? 1), 1, 99);
    mission.state.itemId = itemId;
    mission.state.itemCount = itemCount;

    const itemLabel = String(mission.state.itemLabel || mission.params?.itemLabel || mission.params?.label || itemId).trim() || itemId;
    mission.state.itemLabel = itemLabel;

    if (!this.canSpawnMissionObject(1)) {
      this.eventBus?.emit?.(EVENTS.INVENTORY_GIVE_ITEM, { actorKind: 'player', itemId, count: itemCount });
      mission.state.recovered = true;
      mission.state.dropped = false;
      mission.state.dropId = null;
      mission.state.dropGridPos = null;
      mission.state.thiefMonsterId = null;
      this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: `${itemLabel} secured (fallback).`, seconds: 1.7 });
      return;
    }

    const objKind = String(mission.state.objectKind || mission.params?.objectKind || 'package').trim().toLowerCase();
    const object3d = objKind === 'keycard'
      ? createKeycardObject()
      : (objKind === 'evidence' ? createEvidenceObject() : createDeliveryItemObject());

    let pos = null;
    if (worldPosition?.clone) {
      pos = worldPosition.clone();
    } else if (worldPosition) {
      pos = new THREE.Vector3(Number(worldPosition.x) || 0, Number(worldPosition.y) || 0, Number(worldPosition.z) || 0);
    } else if (gridPosition && Number.isFinite(gridPosition.x) && Number.isFinite(gridPosition.y)) {
      const w = gridToWorldCenter({ x: gridPosition.x, y: gridPosition.y });
      pos = new THREE.Vector3(w.x, 0, w.z);
    } else {
      pos = new THREE.Vector3(0, 0, 0);
    }
    pos.y = 0;
    object3d.position.copy(pos);
    object3d.rotation.y = Math.random() * Math.PI * 2;

    this.scene?.add?.(object3d);
    this.spawnedObjects.push(object3d);
    this.consumeMissionObjectBudget(1);

    const gp = (gridPosition && Number.isFinite(gridPosition.x) && Number.isFinite(gridPosition.y))
      ? { x: Math.round(gridPosition.x), y: Math.round(gridPosition.y) }
      : (this.interactables?.worldToGrid ? this.interactables.worldToGrid(pos) : null);

    const dropId = `stolen:${mission.id}`;
    mission.state.dropped = true;
    mission.state.dropId = dropId;
    mission.state.dropGridPos = gp;
    mission.state.thiefMonsterId = null;

    const maxDistance = clamp(toFinite(mission.params?.maxDistance, 2.8) ?? 2.8, 1.5, 8);

    this.registeredIds.push(
      this.interactables.register({
        id: dropId,
        kind: 'stolenItem',
        label: itemLabel,
        gridPos: gp,
        object3d,
        maxDistance,
        prompt: () => `E: Recover ${itemLabel}`,
        interact: ({ actorKind = 'player' } = {}) => {
          if (mission.state.recovered) return { ok: true, message: 'Already recovered', picked: true, remove: true };
          this.eventBus?.emit?.(EVENTS.INVENTORY_GIVE_ITEM, { actorKind, itemId, count: itemCount, sourceId: dropId });
          mission.state.recovered = true;
          mission.state.dropped = false;
          this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: `${itemLabel} recovered.`, seconds: 1.7 });
          this.syncStatus();
          return { ok: true, message: 'Recovered', picked: true, remove: true };
        },
        meta: { missionId: mission.id, template: mission.template }
      })
    );
    this.interactableMeta.set(dropId, { missionId: mission.id, template: mission.template });

    this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: `${itemLabel} dropped! Retrieve it.`, seconds: 1.8 });
  }

  onPlayerDamaged(payload) {
    const nowSec = this.gameState?.getElapsedTime
      ? this.gameState.getElapsedTime()
      : this.elapsedSec;

    for (const mission of this.missions.values()) {
      if (!mission) continue;
      if (mission.template !== 'surviveNoDamage') continue;
      if (this.isMissionComplete(mission)) continue;

      mission.state.lastDamagedAtSec = Number.isFinite(nowSec) ? nowSec : this.elapsedSec;
      mission.state.hits = (mission.state.hits || 0) + 1;
    }

    for (const mission of this.missions.values()) {
      if (!mission) continue;
      if (mission.template !== 'noHitRun') continue;
      if (mission.state.completed) continue;
      if (mission.state.failed) continue;

      mission.state.failed = true;
      mission.state.hits = (mission.state.hits || 0) + 1;

      const loseOnHit = mission.state.loseOnHit !== false;
      if (loseOnHit && !this.gameState?.gameOver) {
        this.gameState?.lose?.('No-hit objective failed (took damage).');
      } else {
        this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'No-hit objective failed.', seconds: 1.7 });
      }
    }

    for (const mission of this.missions.values()) {
      if (!mission) continue;
      if (mission.template !== 'deliverFragile') continue;
      if (this.isMissionComplete(mission)) continue;
      if (!mission.state.carrying) continue;
      if (mission.state.breakOnDamage === false) continue;
      this.dropFragilePackage(mission, { reason: 'damage', actorKind: 'player' });
    }

    this.syncStatus();
  }

  dropFragilePackage(mission, { reason = 'damage', actorKind = 'player' } = {}) {
    if (!mission || mission.template !== 'deliverFragile') return;
    if (!mission.state || !mission.state.carrying || mission.state.delivered) return;

    const itemId = String(mission.state.itemId || mission.params?.itemId || 'fragile_package').trim() || 'fragile_package';
    mission.state.carrying = false;

    const bus = this.eventBus;
    if (bus?.emit) {
      bus.emit(EVENTS.INVENTORY_CONSUME_ITEM, { actorKind, itemId, count: 1, result: null });
    }

    const pkgId = String(mission.state.packageId || '').trim();
    const entry = pkgId ? (this.interactables?.get?.(pkgId) || null) : null;
    if (entry) {
      entry.enabled = true;
      entry.collected = false;
      if (entry.object3d) entry.object3d.visible = true;
    }

    if (actorKind === 'player') {
      const msg = reason === 'gunfire'
        ? 'Fragile package dropped (weapon fired).'
        : 'Fragile package dropped (took damage).';
      bus?.emit?.(EVENTS.UI_TOAST, { text: msg, seconds: 1.7 });
    }
  }

  onWeaponFired(payload) {
    void payload;

    for (const mission of this.missions.values()) {
      if (!mission) continue;
      if (mission.template !== 'deliverFragile') continue;
      if (this.isMissionComplete(mission)) continue;
      if (!mission.state.carrying) continue;
      if (mission.state.breakOnGunfire === false) continue;
      this.dropFragilePackage(mission, { reason: 'gunfire', actorKind: 'player' });
    }

    this.syncStatus();
  }

  onNoiseEmitted(payload) {
    const source = payload?.source;
    if (source !== 'player') return;

    const kind = String(payload?.kind || '').toLowerCase();
    const strengthRaw = Number(payload?.strength);
    const strength = Number.isFinite(strengthRaw) ? clamp(strengthRaw, 0, 1) : null;

    const nowSec = this.gameState?.getElapsedTime
      ? this.gameState.getElapsedTime()
      : this.elapsedSec;

    for (const mission of this.missions.values()) {
      if (!mission) continue;
      if (mission.template !== 'stealthNoise') continue;
      if (this.isMissionComplete(mission)) continue;

      const isGunshot = kind.includes('gun') || kind.includes('shot');
      const maxNoiseStrength = mission.state.maxNoiseStrength;
      const thresholdEnabled = Number.isFinite(maxNoiseStrength);
      const effectiveStrength = strength === null ? (isGunshot ? 1 : 0.5) : strength;
      const overLimit = thresholdEnabled ? (effectiveStrength > maxNoiseStrength || isGunshot) : true;

      // In threshold mode, only "loud enough" noises reset the timer / apply penalties.
      if (!overLimit) continue;

      if (isGunshot) {
        mission.state.gunshots = (mission.state.gunshots || 0) + 1;
        if (mission.state.resetOnGunshot) {
          mission.state.lastNoiseAtSec = Number.isFinite(nowSec) ? nowSec : this.elapsedSec;
        }
      } else {
        mission.state.lastNoiseAtSec = Number.isFinite(nowSec) ? nowSec : this.elapsedSec;
      }

      const max = mission.state.maxGunshotsTotal;
      if (Number.isFinite(max) && max >= 0 && mission.state.gunshots > max) {
        // Too many gunshots: treat as a reset, not a permanent lockout.
        // Keep the objective retryable until the player stays quiet for the full timer.
        mission.state.failed = false;
        mission.state.gunshots = 0;
        mission.state.lastNoiseAtSec = Number.isFinite(nowSec) ? nowSec : this.elapsedSec;
      }

      if (thresholdEnabled) {
        const maxStrikes = Number(mission.state.maxStrikes) || 0; // 0 => unlimited
        const strikesRaw = Math.max(0, Math.round(Number(mission.state.strikes) || 0));
        const nextStrikes = maxStrikes > 0 ? Math.min(maxStrikes, strikesRaw + 1) : strikesRaw + 1;
        mission.state.strikes = nextStrikes;
        mission.state.lastStrikeAtSec = Number.isFinite(nowSec) ? nowSec : this.elapsedSec;

        const lastToast = Number(mission.state.lastStrikeToastAtSec);
        const toastReady = !Number.isFinite(lastToast) || ((Number.isFinite(nowSec) ? nowSec : this.elapsedSec) - lastToast >= 1.4);
        if (toastReady) {
          mission.state.lastStrikeToastAtSec = Number.isFinite(nowSec) ? nowSec : this.elapsedSec;
          const limitPct = Math.round((Number(maxNoiseStrength) || 0) * 100);
          const label = maxStrikes > 0 ? `${nextStrikes}/${maxStrikes}` : String(nextStrikes);
          this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: `Noise limit exceeded (${limitPct}%) — strikes ${label}.`, seconds: 1.4 });
        }
      }
    }

    for (const mission of this.missions.values()) {
      if (!mission) continue;
      if (mission.template !== 'hideUntilClear') continue;
      if (this.isMissionComplete(mission)) continue;

      mission.state.lastNoiseAtSec = Number.isFinite(nowSec) ? nowSec : this.elapsedSec;
    }

    this.syncStatus();
  }

  onHintRequested(payload) {
    const actorKind = payload?.actorKind || 'player';
    if (actorKind !== 'player') return;

    const objectiveMission = this.getCurrentRequiredMission();
    const objectiveKey = objectiveMission
      ? `${String(objectiveMission.id || '')}:${String(objectiveMission.template || '')}`
      : 'exit';

    if (objectiveKey !== this.hintObjectiveKey) {
      this.hintObjectiveKey = objectiveKey;
      this.hintTier = 0;
    }

    this.hintTier = Math.min(3, (this.hintTier || 0) + 1);
    const tier = this.hintTier;

    const paramHints = objectiveMission?.params?.hints;
    const hints = Array.isArray(paramHints) ? paramHints.map((h) => String(h || '').trim()).filter(Boolean) : [];
    let hintText = hints[tier - 1] || '';

    if (!hintText) {
      const m = objectiveMission;
      if (!m) {
        hintText = tier === 1
          ? 'Follow the objective and reach the exit.'
          : tier === 2
            ? 'Use the minimap to find unexplored rooms and corridors.'
            : 'If the exit is locked, complete the listed objectives first.';
      } else if (m.template === 'findKeycard') {
        hintText = tier === 1
          ? 'Search the target room types for a keycard pickup.'
          : tier === 2
            ? 'Sweep offices/classrooms and interact with the glowing keycard.'
            : 'Keep moving: the keycard spawns away from the spawn/exit.';
      } else if (m.template === 'collectEvidence') {
        hintText = tier === 1
          ? 'Collect evidence pickups in the listed room types.'
          : tier === 2
            ? 'Evidence spawns as small glowing items—interact to collect.'
            : 'Use the minimap: enter rooms, scan corners, and clear multiple rooms.';
      } else if (m.template === 'restorePower') {
        hintText = tier === 1
          ? 'Find and activate the power switches.'
          : tier === 2
            ? 'Switches spawn in labs/storage—interact to turn them on.'
            : 'If you are stuck, explore new rooms; switches never spawn in walls/corridors.';
      } else if (m.template === 'restorePowerFuses') {
        hintText = tier === 1
          ? 'Find and collect the fuses.'
          : tier === 2
            ? 'After collecting all fuses, find the power panel and install them.'
            : 'Press E again on the panel to restore power.';
      } else if (m.template === 'uploadEvidence') {
        hintText = tier === 1
          ? 'Collect the evidence pickups.'
          : tier === 2
            ? 'After collecting enough evidence, find the upload terminal.'
            : 'Upload consumes your evidence items—if the terminal rejects you, you missed a pickup.';
      } else if (m.template === 'codeLock') {
        hintText = tier === 1
          ? 'Find and read the code note clues (A/B/C).'
          : tier === 2
            ? 'After collecting all clues, find the keypad and enter the digits (A→B→C), then press Enter.'
            : 'If you forgot a digit, re-check the notes; the keypad spawns in themed rooms away from spawn/exit.';
      } else if (m.template === 'enterRoomType') {
        const roomLabel = formatRoomTypeList(m.params?.roomTypes);
        hintText = tier === 1
          ? `Find and enter the ${roomLabel}.`
          : tier === 2
            ? 'Explore: move through corridors until you discover new themed rooms.'
            : 'Check large room clusters (Classrooms Block / Lab / Cafeteria) on the minimap.';
      } else if (m.template === 'killCount') {
        hintText = tier === 1
          ? 'Defeat monsters to reach the required count.'
          : tier === 2
            ? 'Keep distance and use bursts; reloading at safe moments helps.'
            : 'If overwhelmed, retreat down corridors to separate targets.';
      } else if (m.template === 'stealthNoise') {
        const maxNoiseStrength = m?.state?.maxNoiseStrength;
        const thresholdEnabled = Number.isFinite(maxNoiseStrength);
        const limitPct = thresholdEnabled ? Math.round((Number(maxNoiseStrength) || 0) * 100) : null;
        hintText = tier === 1
          ? (thresholdEnabled ? `Stay under the noise limit (${limitPct}%) until the timer completes.` : 'Stay quiet until the timer completes.')
          : tier === 2
            ? (thresholdEnabled ? 'Sprinting and gunshots exceed the limit; slowing down can avoid penalties.' : 'Do not shoot; footsteps also reset the timer.')
            : (thresholdEnabled ? 'Create distance, then stop moving and wait—strikes add time penalties.' : 'Stop moving and wait—any noise will restart the countdown.');
      } else if (m.template === 'unlockExit') {
        hintText = tier === 1
          ? 'Go to the exit and press E to unlock it.'
          : tier === 2
            ? 'After unlocking, press E again to finish the level.'
            : 'If it stays locked, you missed a required objective.';
      } else if (m.template === 'lockedDoor') {
        hintText = tier === 1
          ? 'Find the key.'
          : tier === 2
            ? 'After picking up the key, return to the locked door and press E.'
            : 'The door icon is a glowing frame; you only need to get close enough to interact.';
      } else if (m.template === 'placeItemsAtAltars') {
        hintText = tier === 1
          ? 'Collect the relics.'
          : tier === 2
            ? 'After collecting relics, place them at the altars (press E).'
            : 'If an altar says you need a relic, you missed a pickup.';
      } else if (m.template === 'searchRoomTypeN') {
        hintText = tier === 1
          ? 'Inspect the marked clues (press E).'
          : tier === 2
            ? 'Each clue spawns in a different room; explore new rooms to find them.'
            : 'Use the minimap: focus on large themed rooms to cover ground faster.';
      } else if (m.template === 'photographEvidence') {
        hintText = tier === 1
          ? 'Hold C to use the camera and keep the target centered.'
          : tier === 2
            ? 'Stay within range and keep line of sight while holding C until the capture completes.'
            : 'If progress resets, re-center the target and keep holding C for the full duration.';
      } else if (m.template === 'deliverItemToTerminal') {
        hintText = tier === 1
          ? 'Collect all packages first.'
          : tier === 2
            ? 'After collecting enough packages, find the delivery terminal and press E.'
            : 'If the terminal says you are missing packages, keep exploring new rooms.';
      } else if (m.template === 'switchSequence') {
        hintText = tier === 1
          ? 'Activate the switches in the correct order.'
          : tier === 2
            ? 'Follow the next switch shown in the objective text.'
            : 'If you trigger the wrong switch, the sequence will reset—try again.';
      } else if (m.template === 'hideForSeconds') {
        hintText = tier === 1
          ? 'Find a hiding spot (locker) and press E.'
          : tier === 2
            ? 'Stay hidden until the timer completes (do not move).'
            : 'If progress resets, you left the hiding spot—hide again and wait.';
      } else if (m.template === 'escort') {
        hintText = tier === 1
          ? 'Find the survivor and press E to start the escort.'
          : tier === 2
            ? 'Lead the survivor to the exit and wait for them to catch up.'
            : 'If they get stuck, move slowly and stay near corridors to keep a clear path.';
      } else if (m.template === 'hiddenTerminal') {
        hintText = tier === 1
          ? 'Listen for a periodic beep and search new rooms.'
          : tier === 2
            ? 'Prioritize the hinted room type; sweep room centers and corners.'
            : 'Use the hint button again to reveal a marker (if the mission allows it).';
      } else {
        hintText = tier === 1
          ? 'Follow the current objective.'
          : tier === 2
            ? 'Use the minimap and interact prompts to find objectives.'
            : 'Try exploring new rooms; objectives never require guessing.';
      }
    }

    this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: `Hint ${tier}/3: ${hintText}`, seconds: 2.4 });
  }

  onTimerTick(payload) {
    const elapsedSec = Number(payload?.elapsedSec);
    if (Number.isFinite(elapsedSec)) {
      this.elapsedSec = Math.max(this.elapsedSec, elapsedSec);
    } else {
      this.elapsedSec += 1;
    }

    const timeLimitSec = this.missionsConfig?.timeLimitSec || 0;
    if (Number.isFinite(timeLimitSec) && timeLimitSec > 0) {
      if (this.elapsedSec >= timeLimitSec && !this.isExitUnlocked()) {
        this.gameState?.lose?.('Time is up.');
        this.eventBus?.emit?.(EVENTS.MISSION_FAILED, { reason: 'timeLimit' });
        return;
      }
    }

    for (const mission of this.missions.values()) {
      if (!mission) continue;
      if (mission.template !== 'surviveTimer') continue;
      if (mission.state.completed) continue;
      if (this.elapsedSec >= mission.state.seconds) {
        mission.state.completed = true;
      }
    }

    // Timed evacuation: starts after other objectives, opens exit, and increases monster pressure.
    for (const mission of this.missions.values()) {
      if (!mission) continue;
      if (mission.template !== 'timedEvac') continue;

      const seconds = clamp(Math.round(mission.state.seconds ?? mission.params?.seconds ?? 45), 5, 600);
      mission.state.seconds = seconds;

      if (!mission.state.started) {
        const requires = this.missionsConfig?.exit?.requires || [];
        const requiredIds = Array.isArray(requires) ? requires : [];
        const unlockExitId = String(mission.state.unlockExitMissionId || 'unlockExit').trim() || 'unlockExit';

        let triggerReady = true;
        for (const rid of requiredIds) {
          const id = String(rid || '').trim();
          if (!id) continue;
          if (id === mission.id) continue;
          if (id === unlockExitId) continue;
          const m = this.missions.get(id);
          if (!m) continue;
          if (m.template === 'unlockExit') continue;
          if (!this.isMissionComplete(m)) {
            triggerReady = false;
            break;
          }
        }

        if (triggerReady) {
          mission.state.started = true;
          mission.state.startedAtSec = this.elapsedSec;
          mission.state.untilSec = this.elapsedSec + seconds;
          mission.state.lastSpawnPulseAtSec = this.elapsedSec;

          if (mission.state.autoUnlockExit !== false) {
            const unlockMission = this.missions.get(unlockExitId)
              || Array.from(this.missions.values()).find((m) => m?.template === 'unlockExit')
              || null;
            if (unlockMission?.state && !unlockMission.state.unlocked) {
              unlockMission.state.unlocked = true;
            }
          }

          if (mission.state.escalateMonsters !== false) {
            const mm = this.monsterManager;
            if (mm) {
              const bonus = clamp(Math.round(mission.state.maxCountBonus ?? 2), 0, 12);
              const nextDelay = clamp(toFinite(mission.state.respawnDelaySec, 0.35) ?? 0.35, 0, 10);
              const burst = clamp(Math.round(mission.state.spawnBurstCount ?? 2), 0, 10);

              if (mm.levelConfig?.monsters) {
                const cur = mm.levelConfig.monsters.maxCount;
                if (!mission.state._boostApplied) {
                  mission.state._origMaxCount = Number.isFinite(cur) ? cur : null;
                }
                const base = Number.isFinite(cur) ? cur : (Number.isFinite(mission.state._origMaxCount) ? mission.state._origMaxCount : null);
                if (Number.isFinite(base)) {
                  mm.levelConfig.monsters.maxCount = Math.max(0, Math.round(base + bonus));
                }
              }

              if (mm.spawner?.setRespawnDelay) {
                if (!mission.state._boostApplied) {
                  mission.state._origRespawnDelay = Number.isFinite(mm.spawner.respawnDelay) ? Number(mm.spawner.respawnDelay) : null;
                }
                mm.spawner.setRespawnDelay(nextDelay);
              }

              mission.state._boostApplied = true;

              for (let i = 0; i < burst; i++) {
                try {
                  void mm.spawnReplacement?.(null);
                } catch {
                  // ignore
                }
              }
            }
          }

          this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: `Evacuation started (${seconds}s). Run to the exit!`, seconds: 2.3 });
        }

        continue;
      }

      const until = Number(mission.state.untilSec) || 0;
      const remaining = until > 0 ? (until - this.elapsedSec) : 0;

      if (until > 0 && remaining <= 0 && !this.gameState?.gameOver) {
        this.gameState?.lose?.('Evacuation window expired.');
        this.eventBus?.emit?.(EVENTS.MISSION_FAILED, { missionId: mission.id, template: mission.template, reason: 'timedEvac', nowSec: this.elapsedSec });
        return;
      }

      const pulseSec = clamp(toFinite(mission.state.spawnPulseSec, 6) ?? 6, 0, 60);
      const pulseCount = clamp(Math.round(mission.state.spawnPulseCount ?? 1), 0, 6);
      if (pulseSec > 0 && pulseCount > 0 && mission.state.escalateMonsters !== false) {
        const last = Number(mission.state.lastSpawnPulseAtSec) || -999;
        if (this.elapsedSec - last >= pulseSec) {
          mission.state.lastSpawnPulseAtSec = this.elapsedSec;
          const mm = this.monsterManager;
          if (mm) {
            for (let i = 0; i < pulseCount; i++) {
              try {
                void mm.spawnReplacement?.(null);
              } catch {
                // ignore
              }
            }
          }
        }
      }
    }

    for (const mission of this.missions.values()) {
      if (!mission) continue;
      if (mission.template !== 'syncActivate') continue;
      if (this.isMissionComplete(mission)) continue;
      if (!mission.state.started) continue;
      const until = Number(mission.state.activeUntilSec) || 0;
      if (until > 0 && this.elapsedSec > until) {
        this.resetSyncActivateSwitches(mission);
        this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'Sync failed. Try again.', seconds: 1.4 });
      }
    }

    for (const mission of this.missions.values()) {
      if (!mission) continue;
      if (mission.template !== 'stealthNoise') continue;
      if (mission.state.completed) continue;

      const start = Number.isFinite(mission.state.lastNoiseAtSec) ? mission.state.lastNoiseAtSec : 0;
      const baseSeconds = Number(mission.state.seconds) || 0;
      if (baseSeconds <= 0) continue;

      const strikes = Math.max(0, Math.round(Number(mission.state.strikes) || 0));
      const perStrike = Math.max(0, Math.round(Number(mission.state.penaltySecondsPerStrike) || 0));
      const cap = Math.max(0, Math.round(Number(mission.state.maxPenaltySeconds) || 0));
      const penalty = perStrike > 0 ? Math.min(cap, strikes * perStrike) : 0;
      const seconds = baseSeconds + penalty;

      const quietFor = this.elapsedSec - start;
      if (quietFor >= seconds) {
        mission.state.completed = true;
      }
    }

    for (const mission of this.missions.values()) {
      if (!mission) continue;
      if (mission.template !== 'surviveNoDamage') continue;
      if (mission.state.completed) continue;

      const start = Number.isFinite(mission.state.lastDamagedAtSec) ? mission.state.lastDamagedAtSec : 0;
      const seconds = mission.state.seconds || 0;
      if (seconds <= 0) continue;

      const safeFor = this.elapsedSec - start;
      if (safeFor >= seconds) {
        mission.state.completed = true;
      }
    }

    for (const mission of this.missions.values()) {
      if (!mission) continue;
      if (mission.template !== 'lowHealthForSeconds') continue;
      if (mission.state.completed) continue;

      const seconds = clamp(Math.round(mission.state.seconds ?? mission.params?.seconds ?? 12), 1, 3600);
      const threshold = clamp(Math.round(mission.state.healthPct ?? mission.params?.healthPct ?? 35), 1, 99);
      mission.state.seconds = seconds;
      mission.state.healthPct = threshold;

      const curPct = this.gameState?.getHealthPercentage
        ? Number(this.gameState.getHealthPercentage())
        : (() => {
          const ch = Number(this.gameState?.currentHealth);
          const mh = Number(this.gameState?.maxHealth);
          if (!Number.isFinite(ch) || !Number.isFinite(mh) || mh <= 0) return NaN;
          return (ch / mh) * 100;
        })();

      mission.state.currentHealthPct = Number.isFinite(curPct) ? clamp(curPct, 0, 100) : null;

      if (Number.isFinite(curPct) && curPct <= threshold) {
        mission.state.underForSec = Math.min(seconds, (Number(mission.state.underForSec) || 0) + 1);
      } else {
        mission.state.underForSec = 0;
      }

      if ((Number(mission.state.underForSec) || 0) >= seconds) {
        mission.state.completed = true;
        mission.state.underForSec = seconds;
        this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'Low health objective complete.', seconds: 1.7 });
      }
    }

    for (const mission of this.missions.values()) {
      if (!mission) continue;
      if (mission.template !== 'noHitRun') continue;
      if (mission.state.completed) continue;
      if (mission.state.failed) continue;

      const requires = this.missionsConfig?.exit?.requires || [];
      const requiredIds = Array.isArray(requires) ? requires : [];

      let ready = true;
      for (const idRaw of requiredIds) {
        const id = String(idRaw || '').trim();
        if (!id) continue;
        if (id === mission.id) continue;

        const m = this.missions.get(id);
        if (!m) continue;
        if (m.template === 'unlockExit') continue;
        if (m.template === 'timedEvac') {
          if (m.state?.started !== true) {
            ready = false;
            break;
          }
          continue;
        }
        if (!this.isMissionComplete(m)) {
          ready = false;
          break;
        }
      }

      if (ready) {
        mission.state.completed = true;
        this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'No-hit objective complete.', seconds: 1.7 });
      }
    }

    for (const mission of this.missions.values()) {
      if (!mission) continue;
      if (mission.template !== 'reclaimStolenItem') continue;
      if (mission.state?.recovered) continue;
      if (mission.state?.dropped) continue;

      const mm = this.monsterManager;
      const monsters = mm?.getMonsters ? mm.getMonsters() : [];
      if (!Array.isArray(monsters) || monsters.length === 0) continue;

      const thiefId = Number(mission.state?.thiefMonsterId);
      if (Number.isFinite(thiefId) && thiefId > 0) {
        const stillAlive = monsters.some((m) => Number(m?.id) === thiefId);
        if (!stillAlive) {
          mission.state.thiefMonsterId = null;
          mission.state.thiefHits = 0;
        } else {
          continue;
        }
      }

      const candidates = monsters.filter((m) => m && !m.isDead && !m.isDying && Number.isFinite(Number(m.id)));
      if (candidates.length === 0) continue;
      const chosen = candidates[Math.floor(Math.random() * candidates.length)];
      mission.state.thiefMonsterId = chosen.id;
      mission.state.thiefHits = 0;

      const label = String(mission.state.itemLabel || mission.params?.itemLabel || mission.params?.label || 'stolen item').trim() || 'stolen item';
      this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: `A monster stole ${label}. Track it down.`, seconds: 2.2 });
    }

    for (const mission of this.missions.values()) {
      if (!mission) continue;
      if (mission.template !== 'hiddenTerminal') continue;
      if (mission.state?.completed) continue;
      const gp = mission.state.terminalGridPos;
      const id = String(mission.state.terminalId || '').trim();
      if (!gp || !id) continue;

      const intervalSec = clamp(Math.round(mission.state.pingIntervalSec ?? mission.params?.pingIntervalSec ?? 8), 0, 120);
      mission.state.pingIntervalSec = intervalSec;
      if (!(intervalSec > 0)) continue;

      const last = Number(mission.state.lastPingAtSec) || -999;
      if (this.elapsedSec - last < intervalSec) continue;
      mission.state.lastPingAtSec = this.elapsedSec;

      const entry = this.interactables?.get?.(id) || null;
      const pos = entry?.object3d?.position || null;
      if (!pos) continue;

      this.eventBus?.emit?.(EVENTS.NOISE_REQUESTED, {
        source: 'mission',
        kind: String(mission.params?.pingKind || 'beep'),
        strength: clamp(Number(mission.params?.pingStrength ?? 0.18), 0.05, 2.0),
        position: pos.clone(),
        radius: clamp(Math.round(mission.params?.pingRadius ?? 7), 2, 40),
        ttl: clamp(Number(mission.params?.pingTtl ?? 0.35), 0.1, 6.0)
      });
    }

    for (const mission of this.missions.values()) {
      if (!mission) continue;
      if (mission.template !== 'hideForSeconds') continue;
      if (mission.state.completed) continue;

      const seconds = Number(mission.state.seconds) || 0;
      if (seconds <= 0) {
        mission.state.completed = true;
        continue;
      }

      if (this.playerHidden) {
        mission.state.hiddenForSec = Math.min(seconds, (mission.state.hiddenForSec || 0) + 1);
      } else {
        mission.state.hiddenForSec = 0;
      }

      if (mission.state.hiddenForSec >= seconds) {
        mission.state.completed = true;
        this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'You stayed hidden.', seconds: 1.6 });
      }
    }

    const playerGridPos = payload?.playerGridPos || payload?.playerGrid || null;
    if (playerGridPos && Number.isFinite(playerGridPos.x) && Number.isFinite(playerGridPos.y)) {
      const ws = this.worldState;
      const cam = this.interactables?.getCameraObject?.() || null;
      const cameraToolActive = payload?.cameraToolActive === true;
      const tileSize = CONFIG.TILE_SIZE || 1;
      const camDir = new THREE.Vector3();
      const targetWorld = new THREE.Vector3();
      const toTarget = new THREE.Vector3();

      for (const mission of this.missions.values()) {
        if (!mission) continue;
        if (mission.template !== 'uploadEvidence') continue;
        if (mission.state.uploaded) continue;
        if (!mission.state.uploading) continue;

        const uploadSeconds = clamp(Math.round(mission.state.uploadSeconds ?? mission.params?.uploadSeconds ?? mission.params?.seconds ?? 0), 0, 600);
        mission.state.uploadSeconds = uploadSeconds;
        if (!(uploadSeconds > 0)) continue;

        const terminalGridPos = mission.state.terminalGridPos || null;
        if (!terminalGridPos || !Number.isFinite(terminalGridPos.x) || !Number.isFinite(terminalGridPos.y)) continue;

        const uploadRadius = clamp(Math.round(mission.state.uploadRadius ?? mission.params?.uploadRadius ?? mission.params?.radius ?? 2), 1, 8);
        mission.state.uploadRadius = uploadRadius;

        const dist = manhattan(playerGridPos, terminalGridPos);
        const inRange = dist <= uploadRadius;

        const terminalId = String(mission.state.terminalId || '').trim();
        const terminalEntry = terminalId ? (this.interactables?.get?.(terminalId) || null) : null;

        if (!inRange) {
          if (mission.state.uploadResetOnLeave !== false) {
            mission.state.uploading = false;
            mission.state.uploadProgressSec = 0;
            if (terminalEntry?.meta) terminalEntry.meta.uploading = false;
            this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'Upload interrupted.', seconds: 1.2 });
          }
          continue;
        }

        mission.state.uploadProgressSec = Math.min(uploadSeconds, (Number(mission.state.uploadProgressSec) || 0) + 1);

        const scentRadius = clamp(Math.round(mission.params?.uploadScentRadius ?? 14), 2, 40);
        const scentTtl = clamp(Number(mission.params?.uploadScentTtl ?? 3.0), 0.5, 10.0);
        const scentStrength = clamp(Number(mission.params?.uploadScentStrength ?? 1.15), 0.1, 3.0);

        const terminalWorld = terminalEntry?.object3d?.position
          ? terminalEntry.object3d.position
          : (() => {
            const w = gridToWorldCenter(terminalGridPos);
            return new THREE.Vector3(w.x, 0, w.z);
          })();

        this.monsterManager?.registerScent?.(terminalWorld, {
          kind: 'upload',
          radius: scentRadius,
          ttl: scentTtl,
          strength: scentStrength,
          source: 'mission'
        });

        if ((Number(mission.state.uploadProgressSec) || 0) >= uploadSeconds) {
          const itemId = String(mission.params?.itemId || 'evidence').trim() || 'evidence';
          const required = Number(mission.state.required) || 0;
          if (this.eventBus?.emit && required > 0) {
            const consume = { actorKind: 'player', itemId, count: required, result: null };
            this.eventBus.emit(EVENTS.INVENTORY_CONSUME_ITEM, consume);
            if (!consume.result?.ok) {
              mission.state.uploading = false;
              mission.state.uploadProgressSec = 0;
              if (terminalEntry?.meta) terminalEntry.meta.uploading = false;
              this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'Upload failed (missing evidence).', seconds: 1.6 });
              continue;
            }
          }

          mission.state.uploading = false;
          mission.state.uploaded = true;
          mission.state.uploadProgressSec = uploadSeconds;

          if (terminalEntry) {
            terminalEntry.requiresItem = [];
            terminalEntry.consumeItem = [];
            if (terminalEntry.meta) {
              terminalEntry.meta.uploading = false;
              terminalEntry.meta.uploaded = true;
            }
            if (terminalEntry.object3d) setTerminalState(terminalEntry.object3d, { uploaded: true });
          }

          this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'Upload complete.', seconds: 1.8 });
        }
      }

      for (const mission of this.missions.values()) {
        if (!mission) continue;
        if (mission.template !== 'surviveInZone') continue;
        if (mission.state.completed) continue;
        if (!mission.state.started) continue;
        const gp = mission.state.beaconGridPos;
        if (!gp || !Number.isFinite(gp.x) || !Number.isFinite(gp.y)) continue;

        const seconds = clamp(Math.round(mission.state.seconds ?? mission.params?.seconds ?? 25), 5, 3600);
        const radius = clamp(Math.round(mission.state.radius ?? mission.params?.radius ?? 2), 1, 8);
        const grace = clamp(Math.round(mission.state.exitGraceSec ?? mission.params?.exitGraceSec ?? 2), 0, 20);
        mission.state.seconds = seconds;
        mission.state.radius = radius;
        mission.state.exitGraceSec = grace;

        const dist = manhattan(playerGridPos, gp);
        const inside = dist <= radius;

        if (inside) {
          mission.state.outOfZoneSec = 0;
          mission.state.heldForSec = Math.min(seconds, (Number(mission.state.heldForSec) || 0) + 1);
        } else {
          mission.state.outOfZoneSec = Math.min(9999, (Number(mission.state.outOfZoneSec) || 0) + 1);
          if (grace >= 0 && (Number(mission.state.outOfZoneSec) || 0) > grace) {
            mission.state.heldForSec = 0;
          }
        }

        if ((Number(mission.state.heldForSec) || 0) >= seconds) {
          mission.state.completed = true;
          mission.state.heldForSec = seconds;
          const entry = mission.state.beaconId ? (this.interactables?.get?.(mission.state.beaconId) || null) : null;
          if (entry?.object3d) {
            setSensorState(entry.object3d, { armed: true, active: false, success: true });
          }
          this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'Zone held.', seconds: 1.8 });
        }
      }

      for (const mission of this.missions.values()) {
        if (!mission) continue;
        if (mission.template !== 'occupyPoint') continue;
        if (mission.state.completed) continue;
        if (!mission.state.started) continue;
        const gp = mission.state.beaconGridPos;
        if (!gp || !Number.isFinite(gp.x) || !Number.isFinite(gp.y)) continue;

        const seconds = clamp(Math.round(mission.state.seconds ?? mission.params?.seconds ?? 30), 5, 3600);
        const radius = clamp(Math.round(mission.state.radius ?? mission.params?.radius ?? 2), 1, 8);
        const grace = clamp(Math.round(mission.state.exitGraceSec ?? mission.params?.exitGraceSec ?? 2), 0, 20);
        mission.state.seconds = seconds;
        mission.state.radius = radius;
        mission.state.exitGraceSec = grace;

        const intervalSec = clamp(Math.round(mission.state.hazardIntervalSec ?? mission.params?.hazardIntervalSec ?? mission.params?.pulseSec ?? 8), 2, 120);
        const durationSec = clamp(Math.round(mission.state.hazardDurationSec ?? mission.params?.hazardDurationSec ?? mission.params?.pulseDurationSec ?? 2), 1, 30);
        const damage = clamp(Math.round(mission.state.hazardDamage ?? mission.params?.hazardDamage ?? 3), 0, 50);
        mission.state.hazardIntervalSec = intervalSec;
        mission.state.hazardDurationSec = durationSec;
        mission.state.hazardDamage = damage;

        if (!(Number(mission.state.nextHazardAtSec) > 0)) {
          mission.state.nextHazardAtSec = this.elapsedSec + intervalSec;
        }

        const dist = manhattan(playerGridPos, gp);
        const inside = dist <= radius;

        const activeUntil = Number(mission.state.hazardActiveUntilSec) || 0;
        const hazardActive = activeUntil > 0 && this.elapsedSec < activeUntil;
        const nextHazardAt = Number(mission.state.nextHazardAtSec) || 0;
        const readyForPulse = !hazardActive && nextHazardAt > 0 && this.elapsedSec >= nextHazardAt;

        if (readyForPulse) {
          mission.state.hazardActiveUntilSec = this.elapsedSec + durationSec;
          mission.state.nextHazardAtSec = this.elapsedSec + intervalSec;

          const entry = mission.state.beaconId ? (this.interactables?.get?.(mission.state.beaconId) || null) : null;
          const pos = entry?.object3d?.position || null;
          if (pos) {
            this.eventBus?.emit?.(EVENTS.NOISE_REQUESTED, {
              source: 'alarm',
              kind: String(mission.params?.hazardNoiseKind || 'alarm'),
              strength: clamp(Number(mission.params?.hazardNoiseStrength ?? 0.85), 0.1, 2.0),
              position: pos.clone(),
              radius: clamp(Math.round(mission.params?.hazardNoiseRadius ?? 20), 4, 80),
              ttl: clamp(Number(mission.params?.hazardNoiseTtl ?? 1.2), 0.2, 6.0)
            });
          }
          this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'Control point hazard activated!', seconds: 1.4 });
        }

        if (inside) {
          mission.state.outOfZoneSec = 0;
          mission.state.heldForSec = Math.min(seconds, (Number(mission.state.heldForSec) || 0) + 1);
          if (hazardActive && damage > 0) {
            this.gameState?.takeDamage?.(damage);
          }
        } else {
          mission.state.outOfZoneSec = Math.min(9999, (Number(mission.state.outOfZoneSec) || 0) + 1);
          if (grace >= 0 && (Number(mission.state.outOfZoneSec) || 0) > grace) {
            mission.state.heldForSec = 0;
          }
        }

        if ((Number(mission.state.heldForSec) || 0) >= seconds) {
          mission.state.completed = true;
          mission.state.heldForSec = seconds;
          const entry = mission.state.beaconId ? (this.interactables?.get?.(mission.state.beaconId) || null) : null;
          if (entry?.object3d) {
            setSensorState(entry.object3d, { armed: true, active: false, success: true });
          }
          this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'Control point secured.', seconds: 1.8 });
        }
      }

      for (const mission of this.missions.values()) {
        if (!mission) continue;
        if (mission.template !== 'photographEvidence') continue;
        if (this.isMissionComplete(mission)) continue;

        const seconds = clamp(Math.round(mission.state.seconds ?? mission.params?.seconds ?? mission.params?.holdSeconds ?? 2), 1, 30);
        mission.state.seconds = seconds;

        const targets = Array.isArray(mission.state.targets) ? mission.state.targets : [];
        const required = Number(mission.state.required) || targets.length || 0;
        mission.state.required = required;

        const done = targets.filter((t) => t?.completed || t?.photographed).length;
        mission.state.photos = Math.min(required, done);
        if (required > 0 && done >= required) continue;

        if (!cameraToolActive || !cam || typeof cam.getWorldDirection !== 'function' || !cam.position) {
          for (const t of targets) {
            if (!t || t.completed || t.photographed) continue;
            t.heldForSec = 0;
          }
          continue;
        }

        cam.getWorldDirection(camDir);
        if (camDir.lengthSq() > 1e-8) camDir.normalize();

        let best = null;
        let bestEntry = null;
        let bestDot = -1;
        let bestAimMinDot = 0;
        let bestAimOffsetY = 0.7;
        let bestMaxDistance = 3.2;

        for (const t of targets) {
          if (!t || t.completed || t.photographed) continue;
          const gp = t.gridPos;
          if (!gp || !Number.isFinite(gp.x) || !Number.isFinite(gp.y)) continue;

          const entry = t.id ? (this.interactables?.get?.(t.id) || null) : null;
          const aimMinDotRaw = Number(entry?.meta?.aimMinDot ?? mission.params?.aimMinDot);
          const aimAngleDeg = clamp(toFinite(mission.params?.aimAngleDeg, 18) ?? 18, 5, 60);
          const aimMinDot = Number.isFinite(aimMinDotRaw)
            ? clamp(aimMinDotRaw, 0.2, 0.9999)
            : Math.cos((aimAngleDeg * Math.PI) / 180);
          const aimOffsetY = clamp(toFinite(entry?.meta?.aimOffsetY ?? mission.params?.aimOffsetY, 0.7) ?? 0.7, 0, 2.5);
          const maxDistance = clamp(toFinite(entry?.meta?.maxDistance ?? mission.params?.maxDistance, 3.2) ?? 3.2, 1.5, 10);

          const losOk = ws?.hasLineOfSight ? !!ws.hasLineOfSight(playerGridPos, gp) : true;
          if (!losOk) continue;

          const distTiles = manhattan(playerGridPos, gp);
          if (distTiles > Math.ceil(maxDistance)) continue;

          const targetWorldX = gp.x * tileSize + tileSize / 2;
          const targetWorldZ = gp.y * tileSize + tileSize / 2;
          targetWorld.set(targetWorldX, aimOffsetY, targetWorldZ);
          toTarget.subVectors(targetWorld, cam.position);
          if (toTarget.lengthSq() <= 1e-8) continue;
          toTarget.normalize();

          const dot = camDir.dot(toTarget);
          if (dot < aimMinDot) continue;

          if (dot > bestDot) {
            bestDot = dot;
            best = t;
            bestEntry = entry;
            bestAimMinDot = aimMinDot;
            bestAimOffsetY = aimOffsetY;
            bestMaxDistance = maxDistance;
          }
        }

        for (const t of targets) {
          if (!t || t.completed || t.photographed) continue;

          if (t !== best) {
            t.heldForSec = 0;
            continue;
          }

          const gp = t.gridPos;
          const losOk = ws?.hasLineOfSight ? !!ws.hasLineOfSight(playerGridPos, gp) : true;
          const distTiles = manhattan(playerGridPos, gp);
          const distOk = distTiles <= Math.ceil(bestMaxDistance);

          let aimedOk = false;
          if (losOk && distOk) {
            cam.getWorldDirection(camDir);
            if (camDir.lengthSq() > 1e-8) camDir.normalize();

            const targetWorldX = gp.x * tileSize + tileSize / 2;
            const targetWorldZ = gp.y * tileSize + tileSize / 2;
            targetWorld.set(targetWorldX, bestAimOffsetY, targetWorldZ);
            toTarget.subVectors(targetWorld, cam.position);
            if (toTarget.lengthSq() > 1e-8) {
              toTarget.normalize();
              const dot = camDir.dot(toTarget);
              aimedOk = dot >= bestAimMinDot;
            }
          }

          if (aimedOk) {
            t.heldForSec = Math.min(seconds, (Number(t.heldForSec) || 0) + 1);
          } else {
            t.heldForSec = 0;
          }

          if ((Number(t.heldForSec) || 0) >= seconds) {
            t.completed = true;
            t.heldForSec = seconds;

            if (bestEntry) {
              bestEntry.enabled = false;
              if (bestEntry.object3d) bestEntry.object3d.visible = false;
            }

            const nextDone = targets.filter((x) => x?.completed || x?.photographed).length;
            mission.state.photos = Math.min(required, nextDone);

            if (required > 0 && nextDone >= required) {
              this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'All photos captured.', seconds: 1.8 });
            } else {
              this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: `Photo captured (${nextDone}/${required})`, seconds: 1.4 });
            }
          }
        }
      }

      for (const mission of this.missions.values()) {
        if (!mission) continue;
        if (mission.template !== 'holdToScan') continue;
        if (mission.state.completed) continue;

        const seconds = Number(mission.state.seconds) || 0;
        if (seconds <= 0) {
          mission.state.completed = true;
          continue;
        }

        const targets = Array.isArray(mission.state.targets) ? mission.state.targets : [];
        const required = Number(mission.state.required) || targets.length || 0;
        mission.state.required = required;

        const scanned = targets.filter((t) => t?.completed).length;
        mission.state.scanned = Math.min(required, scanned);
        if (required > 0 && scanned >= required) {
          mission.state.completed = true;
          continue;
        }

        const next = targets.find((t) => t && !t.completed && t.gridPos) || null;
        if (!next || !next.gridPos) continue;

        const entry = next.id ? (this.interactables?.get?.(next.id) || null) : null;
        const aimMinDotRaw = Number(entry?.meta?.aimMinDot ?? mission.params?.aimMinDot);
        const aimAngleDeg = clamp(toFinite(mission.params?.aimAngleDeg, 14) ?? 14, 5, 60);
        const aimMinDot = Number.isFinite(aimMinDotRaw)
          ? clamp(aimMinDotRaw, 0.2, 0.9999)
          : Math.cos((aimAngleDeg * Math.PI) / 180);
        const aimOffsetY = clamp(toFinite(entry?.meta?.aimOffsetY ?? mission.params?.aimOffsetY, 0.9) ?? 0.9, 0, 2.5);
        const maxDistance = clamp(toFinite(entry?.meta?.maxDistance ?? mission.params?.maxDistance, 3.6) ?? 3.6, 1.5, 10);

        const losOk = ws?.hasLineOfSight ? !!ws.hasLineOfSight(playerGridPos, next.gridPos) : true;
        const distTiles = manhattan(playerGridPos, next.gridPos);
        const distTilesOk = distTiles <= Math.ceil(maxDistance);

        let aimedOk = false;
        if (cam && typeof cam.getWorldDirection === 'function' && cam.position && losOk && distTilesOk) {
          cam.getWorldDirection(camDir);
          if (camDir.lengthSq() > 1e-8) camDir.normalize();

          const targetWorldX = next.gridPos.x * tileSize + tileSize / 2;
          const targetWorldZ = next.gridPos.y * tileSize + tileSize / 2;
          targetWorld.set(targetWorldX, aimOffsetY, targetWorldZ);
          toTarget.subVectors(targetWorld, cam.position);
          if (toTarget.lengthSq() > 1e-8) toTarget.normalize();

          const dot = camDir.dot(toTarget);
          aimedOk = dot >= aimMinDot;
        }

        if (aimedOk) {
          next.heldForSec = Math.min(seconds, (Number(next.heldForSec) || 0) + 1);
        } else {
          next.heldForSec = 0;
        }

        if ((Number(next.heldForSec) || 0) >= seconds) {
          next.completed = true;
          next.heldForSec = seconds;

          if (entry) {
            entry.enabled = false;
            if (entry.object3d) entry.object3d.visible = false;
          }

          const done = targets.filter((t) => t?.completed).length;
          mission.state.scanned = Math.min(required, done);
          if (required > 0 && done >= required) {
            mission.state.completed = true;
            this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'All scans complete.', seconds: 1.8 });
          } else {
            this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: `Scan complete (${done}/${required})`, seconds: 1.4 });
          }
        }
      }

      for (const mission of this.missions.values()) {
        if (!mission) continue;
        if (mission.template !== 'codeLockScan') continue;
        if (this.isMissionComplete(mission)) continue;
        if (!mission.state.unlocked) continue;

        const seconds = Number(mission.state.scanSeconds) || 0;
        if (seconds <= 0) {
          mission.state.scanRequired = 0;
          mission.state.scanned = 0;
          continue;
        }

        const targets = Array.isArray(mission.state.scanTargets) ? mission.state.scanTargets : [];
        const required = Number(mission.state.scanRequired) || targets.length || 0;
        mission.state.scanRequired = required;

        const done = targets.filter((t) => t?.completed).length;
        mission.state.scanned = Math.min(required, done);
        if (required > 0 && done >= required) {
          continue;
        }

        const next = targets.find((t) => t && !t.completed && t.gridPos) || null;
        if (!next || !next.gridPos) continue;

        const entry = next.id ? (this.interactables?.get?.(next.id) || null) : null;
        const aimMinDotRaw = Number(entry?.meta?.aimMinDot ?? mission.params?.sampleAimMinDot ?? mission.params?.aimMinDot);
        const aimAngleDeg = clamp(toFinite(mission.params?.sampleAimAngleDeg ?? mission.params?.aimAngleDeg, 14) ?? 14, 5, 60);
        const aimMinDot = Number.isFinite(aimMinDotRaw)
          ? clamp(aimMinDotRaw, 0.2, 0.9999)
          : Math.cos((aimAngleDeg * Math.PI) / 180);
        const aimOffsetY = clamp(toFinite(entry?.meta?.aimOffsetY ?? mission.params?.sampleAimOffsetY ?? mission.params?.aimOffsetY, 0.9) ?? 0.9, 0, 2.5);
        const maxDistance = clamp(toFinite(entry?.meta?.maxDistance ?? mission.params?.sampleMaxDistance ?? mission.params?.maxDistance, 3.6) ?? 3.6, 1.5, 10);

        const losOk = ws?.hasLineOfSight ? !!ws.hasLineOfSight(playerGridPos, next.gridPos) : true;
        const distTiles = manhattan(playerGridPos, next.gridPos);
        const distTilesOk = distTiles <= Math.ceil(maxDistance);

        let aimedOk = false;
        if (cam && typeof cam.getWorldDirection === 'function' && cam.position && losOk && distTilesOk) {
          cam.getWorldDirection(camDir);
          if (camDir.lengthSq() > 1e-8) camDir.normalize();

          const targetWorldX = next.gridPos.x * tileSize + tileSize / 2;
          const targetWorldZ = next.gridPos.y * tileSize + tileSize / 2;
          targetWorld.set(targetWorldX, aimOffsetY, targetWorldZ);
          toTarget.subVectors(targetWorld, cam.position);
          if (toTarget.lengthSq() > 1e-8) toTarget.normalize();

          const dot = camDir.dot(toTarget);
          aimedOk = dot >= aimMinDot;
        }

        if (aimedOk) {
          next.heldForSec = Math.min(seconds, (Number(next.heldForSec) || 0) + 1);
        } else {
          next.heldForSec = 0;
        }

        if ((Number(next.heldForSec) || 0) >= seconds) {
          next.completed = true;
          next.heldForSec = seconds;

          if (entry) {
            entry.enabled = false;
            if (entry.object3d) entry.object3d.visible = false;
          }

          const nextDone = targets.filter((t) => t?.completed).length;
          mission.state.scanned = Math.min(required, nextDone);
          if (required > 0 && nextDone >= required) {
            this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'Sample collected.', seconds: 1.8 });
          } else {
            this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: `Sample progress (${nextDone}/${required})`, seconds: 1.4 });
          }
        }
      }

      const monsterPositions = (() => {
        const mm = this.monsterManager;
        if (!mm) return [];
        if (typeof mm.getMonsterPositions === 'function') {
          const raw = mm.getMonsterPositions();
          return Array.isArray(raw) ? raw.filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y)) : [];
        }
        if (typeof mm.getMonsters === 'function') {
          const monsters = mm.getMonsters();
          if (!Array.isArray(monsters)) return [];
          const out = [];
          for (const m of monsters) {
            if (!m || m.isDead || m.isDying) continue;
            const gp = m.getGridPosition ? m.getGridPosition() : null;
            if (gp && Number.isFinite(gp.x) && Number.isFinite(gp.y)) out.push({ x: gp.x, y: gp.y });
          }
          return out;
        }
        return [];
      })();

      for (const mission of this.missions.values()) {
        if (!mission) continue;
        if (mission.template !== 'hideUntilClear') continue;
        if (mission.state.completed) continue;

        if (!this.playerHidden) continue;

        const minDistance = Number(mission.state.minDistance) || 0;
        const requireNoLOS = mission.state.requireNoLOS !== false;
        const quietSeconds = Number(mission.state.quietSeconds) || 0;
        const lastNoiseAt = Number.isFinite(mission.state.lastNoiseAtSec) ? mission.state.lastNoiseAtSec : 0;
        const quietFor = this.elapsedSec - lastNoiseAt;
        const quietOk = quietSeconds <= 0 || quietFor >= quietSeconds;

        let nearestDist = Infinity;
        let nearest = null;
        for (const m of monsterPositions) {
          const dist = Math.abs(m.x - playerGridPos.x) + Math.abs(m.y - playerGridPos.y);
          if (dist < nearestDist) {
            nearestDist = dist;
            nearest = m;
          }
        }

        const distOk = minDistance <= 0 || nearestDist >= minDistance;
        let hasLOS = false;
        if (requireNoLOS && nearest && ws?.hasLineOfSight) {
          hasLOS = !!ws.hasLineOfSight(playerGridPos, nearest);
        }
        const losOk = !requireNoLOS || !hasLOS;

        mission.state.nearestMonsterDist = Number.isFinite(nearestDist) && nearestDist < 1e9 ? nearestDist : null;
        mission.state.nearestMonsterHasLOS = requireNoLOS ? hasLOS : null;

        if (quietOk && distOk && losOk) {
          mission.state.completed = true;
          this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'Threat cleared. You can leave hiding.', seconds: 1.9 });
        }
      }

      for (const mission of this.missions.values()) {
        if (!mission) continue;
        if (mission.template !== 'lureToSensor') continue;
        if (mission.state.completed) continue;

        const sensorGridPos = mission.state.sensorGridPos || null;
        if (!sensorGridPos || !Number.isFinite(sensorGridPos.x) || !Number.isFinite(sensorGridPos.y)) continue;

        const lureSeconds = clamp(Math.round(mission.state.lureSeconds ?? mission.params.lureSeconds ?? 10), 3, 120);
        const requireLure = mission.state.requireLure !== false;
        const until = Number(mission.state.lureUntilSec) || 0;
        const lureActive = !requireLure || (until > 0 && this.elapsedSec <= until);

        const requiredTriggers = clamp(Math.round(mission.state.requiredTriggers ?? mission.params.requiredTriggers ?? 1), 1, 12);
        mission.state.requiredTriggers = requiredTriggers;
        mission.state.triggered = clamp(Math.round(mission.state.triggered ?? 0), 0, requiredTriggers);

        const cooldownSec = clamp(Math.round(mission.state.cooldownSec ?? mission.params.cooldownSec ?? 3), 0, 60);
        mission.state.cooldownSec = cooldownSec;
        const cooldownUntil = Number(mission.state.cooldownUntilSec) || 0;
        const cooldownRemaining = Math.max(0, cooldownUntil - this.elapsedSec);
        const inCooldown = cooldownRemaining > 0;

        const requireClear = mission.state.requireClear === undefined
          ? (requiredTriggers > 1)
          : (mission.state.requireClear !== false);
        mission.state.requireClear = requireClear;

        const successFlashSec = clamp(toFinite(mission.state.successFlashSec ?? mission.params.successFlashSec, 2) ?? 2, 0, 10);
        mission.state.successFlashSec = successFlashSec;
        const lastTriggerAt = Number.isFinite(mission.state.lastTriggerAtSec) ? Number(mission.state.lastTriggerAtSec) : -999;
        const flashSuccess = this.elapsedSec - lastTriggerAt <= successFlashSec;

        if (requireLure && until > 0 && this.elapsedSec > until) {
          mission.state.lureUntilSec = 0;
          const lureEntry = mission.state.lureId ? (this.interactables?.get?.(mission.state.lureId) || null) : null;
          if (lureEntry?.meta) lureEntry.meta.active = false;
          if (lureEntry?.object3d) setPowerSwitchState(lureEntry.object3d, false);
        }

        if (requireClear && mission.state.awaitingClear) {
          const triggerRadius = Number(mission.state.triggerRadius) || 1;
          let anyNear = false;
          for (const m of monsterPositions) {
            const dist = Math.abs(m.x - sensorGridPos.x) + Math.abs(m.y - sensorGridPos.y);
            if (dist <= triggerRadius) {
              anyNear = true;
              break;
            }
          }
          if (!anyNear) {
            mission.state.awaitingClear = false;
          }
        }

        const sensorEntry = mission.state.sensorId ? (this.interactables?.get?.(mission.state.sensorId) || null) : null;
        const stage = !mission.state.armed
          ? 'arm'
          : (inCooldown
            ? 'cooldown'
            : (requireClear && mission.state.awaitingClear
              ? 'clear'
              : (requireLure && !lureActive ? 'trigger' : 'wait')));

        if (sensorEntry?.object3d) {
          setSensorState(sensorEntry.object3d, {
            armed: !!mission.state.armed,
            active: stage === 'wait' && lureActive,
            success: flashSuccess
          });
        }

        if (stage === 'wait') {
          const playerRadius = Number(mission.state.playerRadius) || 3;
          const triggerRadius = Number(mission.state.triggerRadius) || 1;
          const playerNear = manhattan(playerGridPos, sensorGridPos) <= playerRadius;

          let monsterNear = false;
          for (const m of monsterPositions) {
            const dist = Math.abs(m.x - sensorGridPos.x) + Math.abs(m.y - sensorGridPos.y);
            if (dist <= triggerRadius) {
              monsterNear = true;
              break;
            }
          }

          if (playerNear && monsterNear) {
            const next = Math.min(requiredTriggers, (Number(mission.state.triggered) || 0) + 1);
            mission.state.triggered = next;
            mission.state.lastTriggerAtSec = this.elapsedSec;

            const completed = requiredTriggers > 0 && next >= requiredTriggers;
            if (completed) {
              mission.state.completed = true;
            } else {
              mission.state.cooldownUntilSec = cooldownSec > 0 ? (this.elapsedSec + cooldownSec) : 0;
              mission.state.awaitingClear = requireClear;
            }

            if (sensorEntry?.object3d) {
              setSensorState(sensorEntry.object3d, { armed: true, active: false, success: true });
            }

            if (completed) {
              this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: `Sensor triggered (${next}/${requiredTriggers}).`, seconds: 1.9 });
            } else {
              this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: `Lure success (${next}/${requiredTriggers}).`, seconds: 1.6 });
            }

            const rearmEachTrigger = mission.state.rearmEachTrigger === true;
            if (rearmEachTrigger && !mission.state.completed) {
              mission.state.armed = false;
            }

            const lureEntry = mission.state.lureId ? (this.interactables?.get?.(mission.state.lureId) || null) : null;
            if (lureEntry?.object3d) setPowerSwitchState(lureEntry.object3d, false);
            if (lureEntry?.meta) lureEntry.meta.active = false;
            mission.state.lureUntilSec = 0;
          }
        } else if (stage === 'trigger' && requireLure && until <= 0 && mission.state.armed) {
          const lureEntry = mission.state.lureId ? (this.interactables?.get?.(mission.state.lureId) || null) : null;
          if (lureEntry?.object3d) setPowerSwitchState(lureEntry.object3d, false);
          if (lureEntry?.meta) lureEntry.meta.active = false;
          mission.state.lureSeconds = lureSeconds;
        }
      }

      for (const mission of this.missions.values()) {
        if (!mission) continue;
        if (mission.template !== 'escort' && mission.template !== 'escortRescue') continue;
        if (mission.state.completed) continue;
        if (!mission.state.started) continue;

        const goal = mission.state.goalGridPos || null;
        const escortGridPos = mission.state.escortGridPos || null;
        if (!goal || !escortGridPos) continue;

        if (mission.template === 'escortRescue') {
          const obj = mission.state.object3d || null;
          const pos = obj?.position || null;
          if (pos) {
            const now = Number.isFinite(this.elapsedSec) ? this.elapsedSec : 0;

            const scentInterval = Number(mission.state.aggroScentIntervalSec) || 0;
            if (scentInterval > 0) {
              const last = Number(mission.state.lastAggroScentAtSec) || -999;
              if (now - last >= scentInterval) {
                mission.state.lastAggroScentAtSec = now;
                this.monsterManager?.registerScent?.(pos, {
                  kind: 'escort',
                  radius: Number(mission.state.aggroScentRadius) || 14,
                  ttl: Number(mission.state.aggroScentTtl) || 4,
                  strength: Number(mission.state.aggroScentStrength) || 1.15,
                  source: 'escort'
                });
              }
            }

            const noiseInterval = Number(mission.state.aggroNoiseIntervalSec) || 0;
            if (noiseInterval > 0) {
              const last = Number(mission.state.lastAggroNoiseAtSec) || -999;
              if (now - last >= noiseInterval) {
                mission.state.lastAggroNoiseAtSec = now;
                this.eventBus?.emit?.(EVENTS.NOISE_REQUESTED, {
                  source: 'escort',
                  kind: String(mission.state.aggroNoiseKind || 'lure'),
                  strength: Number(mission.state.aggroNoiseStrength) || 0.85,
                  position: pos,
                  radius: Number(mission.state.aggroNoiseRadius) || 16,
                  ttl: Number(mission.state.aggroNoiseTtl) || 0.9
                });
              }
            }
          }
        }

        const distToPlayer = manhattan(escortGridPos, playerGridPos);
        const followDistance = Number(mission.state.followDistance) || 1;
        if (distToPlayer > followDistance) {
          const path = this.pathfinder?.findPath?.(escortGridPos, playerGridPos, true, null) || [];
          const next = Array.isArray(path) && path.length >= 2 ? path[1] : null;
          if (next && Number.isFinite(next.x) && Number.isFinite(next.y)) {
            mission.state.escortGridPos = { x: next.x, y: next.y };
            const obj = mission.state.object3d || null;
            if (obj) {
              const world = gridToWorldCenter(next);
              obj.position.set(world.x, 0, world.z);
            }
            const entry = this.interactables?.get?.(mission.state.escortId) || null;
            if (entry) entry.gridPos = { x: next.x, y: next.y };
          }
        }

        const eg = mission.state.escortGridPos || null;
        if (eg && eg.x === goal.x && eg.y === goal.y) {
          mission.state.completed = true;
          const msg = mission.template === 'escortRescue' ? 'Rescue complete.' : 'Escort complete.';
          this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: msg, seconds: 1.8 });
        }
      }

      for (const mission of this.missions.values()) {
        if (!mission) continue;
        if (mission.template !== 'escortToSafeRoom') continue;
        if (mission.state.completed) continue;
        if (!mission.state.started) continue;

        const checkpoint = mission.state.checkpointGridPos || null;
        const safeGoal = mission.state.safeGoalGridPos || null;
        const waitSeconds = clamp(Math.round(mission.state.checkpointWaitSeconds ?? mission.params?.checkpointWaitSeconds ?? 3), 0, 120);
        const playerRadius = clamp(Math.round(mission.state.checkpointPlayerRadius ?? mission.params?.checkpointPlayerRadius ?? 2), 0, 10);

        const stage = clamp(Math.round(mission.state.stage ?? 1), 0, 10);
        if (stage <= 2 && checkpoint) {
          mission.state.goalGridPos = { x: checkpoint.x, y: checkpoint.y };
        } else if (safeGoal) {
          mission.state.goalGridPos = { x: safeGoal.x, y: safeGoal.y };
        }

        const escortGridPos = mission.state.escortGridPos || null;
        if (!escortGridPos) continue;

        if (mission.state.checkpointMarker) {
          const markerStage = clamp(Math.round(mission.state.stage ?? stage), 0, 10);
          const active = markerStage <= 2;
          const success = markerStage >= 3;
          setSensorState(mission.state.checkpointMarker, { armed: true, active, success });
        }

        const followDistance = Number(mission.state.followDistance) || 1;
        const distToPlayer = manhattan(escortGridPos, playerGridPos);

        if (stage === 2 && checkpoint) {
          const distToCheckpoint = manhattan(escortGridPos, checkpoint);
          if (distToCheckpoint > 0) {
            const path = this.pathfinder?.findPath?.(escortGridPos, checkpoint, true, null) || [];
            const next = Array.isArray(path) && path.length >= 2 ? path[1] : null;
            if (next && Number.isFinite(next.x) && Number.isFinite(next.y)) {
              mission.state.escortGridPos = { x: next.x, y: next.y };
              const obj = mission.state.object3d || null;
              if (obj) {
                const world = gridToWorldCenter(next);
                obj.position.set(world.x, 0, world.z);
              }
              const entry = this.interactables?.get?.(mission.state.escortId) || null;
              if (entry) entry.gridPos = { x: next.x, y: next.y };
            }
          }
        } else if (distToPlayer > followDistance) {
          const path = this.pathfinder?.findPath?.(escortGridPos, playerGridPos, true, null) || [];
          const next = Array.isArray(path) && path.length >= 2 ? path[1] : null;
          if (next && Number.isFinite(next.x) && Number.isFinite(next.y)) {
            mission.state.escortGridPos = { x: next.x, y: next.y };
            const obj = mission.state.object3d || null;
            if (obj) {
              const world = gridToWorldCenter(next);
              obj.position.set(world.x, 0, world.z);
            }
            const entry = this.interactables?.get?.(mission.state.escortId) || null;
            if (entry) entry.gridPos = { x: next.x, y: next.y };
          }
        }

        const eg = mission.state.escortGridPos || null;
        if (!eg) continue;

        if (stage <= 1 && checkpoint && eg.x === checkpoint.x && eg.y === checkpoint.y) {
          mission.state.stage = 2;
          mission.state.waitedSec = 0;
          if (waitSeconds > 0) {
            this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'Checkpoint reached. Hold position.', seconds: 1.8 });
          } else {
            mission.state.stage = 3;
            mission.state.goalGridPos = safeGoal ? { x: safeGoal.x, y: safeGoal.y } : mission.state.goalGridPos;
          }
        }

        if (mission.state.stage === 2 && checkpoint) {
          const near = playerRadius <= 0
            ? (playerGridPos.x === checkpoint.x && playerGridPos.y === checkpoint.y)
            : (manhattan(playerGridPos, checkpoint) <= playerRadius);
          if (near) {
            mission.state.waitedSec = Math.min(waitSeconds, (Number(mission.state.waitedSec) || 0) + 1);
          } else {
            mission.state.waitedSec = 0;
          }
          if (waitSeconds <= 0 || (mission.state.waitedSec || 0) >= waitSeconds) {
            mission.state.stage = 3;
            if (safeGoal) {
              mission.state.goalGridPos = { x: safeGoal.x, y: safeGoal.y };
            }
            this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'Checkpoint cleared. Continue to the safe room.', seconds: 2.0 });
          }
        }

        if (mission.state.stage >= 3) {
          const goal = mission.state.goalGridPos || safeGoal || null;
          if (goal && eg.x === goal.x && eg.y === goal.y) {
            mission.state.completed = true;
            mission.state.stage = 4;
            if (mission.state.checkpointMarker) {
              setSensorState(mission.state.checkpointMarker, { armed: true, active: false, success: true });
            }
            this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'Escort complete.', seconds: 1.8 });
          }
        }
      }

      for (const mission of this.missions.values()) {
        if (!mission) continue;
        if (mission.template !== 'scanWaypoints') continue;
        if (mission.state.completed) continue;

        const seconds = clamp(Math.round(mission.state.seconds ?? mission.params?.seconds ?? 4), 1, 120);
        const radius = clamp(Math.round(mission.state.radius ?? mission.params?.radius ?? 2), 0, 10);
        const requireLOS = mission.state.requireLOS === true;
        mission.state.seconds = seconds;
        mission.state.radius = radius;
        mission.state.requireLOS = requireLOS;

        const targets = Array.isArray(mission.state.targets) ? mission.state.targets : [];
        const required = Number(mission.state.required) || targets.length || 0;
        mission.state.required = required;

        let scanned = 0;
        for (let i = 0; i < targets.length; i++) {
          const t = targets[i];
          if (!t) continue;
          if (t.completed) {
            scanned += 1;
            continue;
          }
          const gp = t.gridPos;
          if (!gp || !Number.isFinite(gp.x) || !Number.isFinite(gp.y)) continue;

          const dist = manhattan(playerGridPos, gp);
          const inside = radius <= 0 ? (dist === 0) : (dist <= radius);
          const losOk = !requireLOS || (ws?.hasLineOfSight ? !!ws.hasLineOfSight(playerGridPos, gp) : true);
          const scanning = cameraToolActive && inside && losOk;

          if (scanning) {
            t.heldForSec = Math.min(seconds, (Number(t.heldForSec) || 0) + 1);
          } else {
            t.heldForSec = 0;
          }

          if ((Number(t.heldForSec) || 0) >= seconds) {
            t.completed = true;
            t.heldForSec = seconds;
            scanned += 1;
            const entry = t.id ? (this.interactables?.get?.(t.id) || null) : null;
            if (entry?.object3d) {
              setSensorState(entry.object3d, { armed: true, active: false, success: true });
            }
            this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: `Site scanned (${scanned}/${required}).`, seconds: 1.4 });
          }
        }

        mission.state.scanned = Math.min(required, scanned);
        if (required > 0 && scanned >= required) {
          mission.state.completed = true;
          this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'All sites scanned.', seconds: 1.8 });
        }
      }
    }

    this.syncStatus();
  }

  isMissionComplete(mission) {
    if (!mission) return false;
    if (mission.template === 'findKeycard') {
      return !!mission.state.found;
    }
    if (mission.template === 'collectEvidence') {
      return (mission.state.collected || 0) >= (mission.state.required || 0);
    }
    if (mission.template === 'restorePower') {
      return (mission.state.activated?.size || 0) >= (mission.state.total || 0);
    }
    if (mission.template === 'syncActivate') {
      const total = Number(mission.state.total) || (Array.isArray(mission.state.switches) ? mission.state.switches.length : 0);
      if (total <= 0) return true;
      return (mission.state.activated?.size || 0) >= total;
    }
    if (mission.template === 'reroutePower') {
      return !!mission.state.powered;
    }
    if (mission.template === 'activateShrines') {
      return (mission.state.activated?.size || 0) >= (mission.state.total || 0);
    }
    if (mission.template === 'restorePowerFuses') {
      return !!mission.state.powered;
    }
    if (mission.template === 'powerGrid') {
      const required = Number(mission.state.requiredPowered) || 0;
      const branches = Array.isArray(mission.state.branches) ? mission.state.branches : [];
      const powered = Number(mission.state.powered) || branches.filter((b) => b?.powered).length;
      mission.state.powered = powered;
      mission.state.requiredPowered = required > 0 ? required : branches.length;
      return mission.state.requiredPowered <= 0 || powered >= mission.state.requiredPowered;
    }
    if (mission.template === 'uploadEvidence') {
      return !!mission.state.uploaded;
    }
    if (mission.template === 'blackoutZone') {
      const required = Number(mission.state.required) || 0;
      const restored = Number(mission.state.restored) || 0;
      return required <= 0 || restored >= required;
    }
    if (mission.template === 'surviveTimer') {
      return !!mission.state.completed;
    }
    if (mission.template === 'surviveInZone') {
      return !!mission.state.completed;
    }
    if (mission.template === 'occupyPoint') {
      return !!mission.state.completed;
    }
    if (mission.template === 'surviveNoDamage') {
      return !!mission.state.completed;
    }
    if (mission.template === 'lowHealthForSeconds') {
      return !!mission.state.completed;
    }
    if (mission.template === 'noHitRun') {
      return !!mission.state.completed;
    }
    if (mission.template === 'reclaimStolenItem') {
      return !!mission.state.recovered;
    }
    if (mission.template === 'hiddenTerminal') {
      return !!mission.state.completed;
    }
    if (mission.template === 'scanWaypoints') {
      return !!mission.state.completed;
    }
    if (mission.template === 'enterRoomType') {
      return (mission.state.entered || 0) >= (mission.state.required || 0);
    }
    if (mission.template === 'enterRoomSequence') {
      const seq = Array.isArray(mission.state.sequence) ? mission.state.sequence : [];
      const idx = Number(mission.state.index) || 0;
      return seq.length >= 2 && idx >= seq.length;
    }
    if (mission.template === 'killCount') {
      return (mission.state.killed || 0) >= (mission.state.required || 0);
    }
    if (mission.template === 'codeLock') {
      return !!mission.state.unlocked;
    }
    if (mission.template === 'codeLockScan') {
      if (!mission.state.unlocked) return false;
      const targets = Array.isArray(mission.state.scanTargets) ? mission.state.scanTargets : [];
      const required = Number(mission.state.scanRequired) || targets.length || 0;
      const done = targets.filter((t) => t?.completed).length;
      mission.state.scanRequired = required;
      mission.state.scanned = Math.min(required, done);
      return required <= 0 || done >= required;
    }
    if (mission.template === 'unlockExit') {
      return !!mission.state.unlocked;
    }
    if (mission.template === 'bossFinale') {
      return (Number(mission.state.phase) || 0) >= 3;
    }
    if (mission.template === 'lockedDoor') {
      return !!mission.state.unlocked;
    }
    if (mission.template === 'doorLockNetwork') {
      const total = Number(mission.state.total) || (Array.isArray(mission.state.doors) ? mission.state.doors.length : 0);
      if (total <= 0) return true;
      const unlocked = Number(mission.state.unlocked) || (Array.isArray(mission.state.doors) ? mission.state.doors.filter((d) => d?.unlocked).length : 0);
      return unlocked >= total;
    }
    if (mission.template === 'placeItemsAtAltars') {
      return (mission.state.altarsFilled || 0) >= (mission.state.altarsTotal || 0);
    }
    if (mission.template === 'placeKeysAtLocks') {
      return (mission.state.locksFilled || 0) >= (mission.state.required || 0);
    }
    if (mission.template === 'searchRoomTypeN') {
      return (mission.state.searched || 0) >= (mission.state.required || 0);
    }
    if (mission.template === 'searchAndTagRoom') {
      return (mission.state.tagged || 0) >= (mission.state.required || 0);
    }
    if (mission.template === 'photographEvidence') {
      const targets = Array.isArray(mission.state.targets) ? mission.state.targets : [];
      const required = Number(mission.state.required) || targets.length || 0;
      if (required <= 0) return true;
      const photos = targets.filter((t) => t?.completed || t?.photographed).length;
      mission.state.photos = Math.min(required, photos);
      mission.state.required = required;
      return photos >= required;
    }
    if (mission.template === 'holdToScan') {
      if (mission.state.completed) return true;
      const required = Number(mission.state.required) || 0;
      if (required <= 0) return true;
      return (mission.state.scanned || 0) >= required;
    }
    if (mission.template === 'deliverItemToTerminal') {
      return !!mission.state.delivered;
    }
    if (mission.template === 'deliverFragile') {
      return !!mission.state.delivered;
    }
    if (mission.template === 'switchSequence' || mission.template === 'switchSequenceWithClues') {
      const seq = Array.isArray(mission.state.sequence) ? mission.state.sequence : [];
      const idx = Number(mission.state.index) || 0;
      if (seq.length < 2) return true;
      return idx >= seq.length;
    }
    if (mission.template === 'hideForSeconds') {
      return !!mission.state.completed;
    }
    if (mission.template === 'hideUntilClear') {
      return !!mission.state.completed;
    }
    if (mission.template === 'escort') {
      return !!mission.state.completed;
    }
    if (mission.template === 'escortRescue') {
      return !!mission.state.completed;
    }
    if (mission.template === 'escortToSafeRoom') {
      return !!mission.state.completed;
    }
    if (mission.template === 'stealthNoise') {
      return !!mission.state.completed;
    }
    if (mission.template === 'lureToSensor') {
      const required = clamp(Math.round(mission.state.requiredTriggers ?? mission.params?.requiredTriggers ?? 1), 1, 12);
      const triggered = clamp(Math.round(mission.state.triggered ?? 0), 0, required);
      mission.state.requiredTriggers = required;
      mission.state.triggered = triggered;
      if (required > 0 && triggered >= required) {
        mission.state.completed = true;
      }
      return !!mission.state.completed;
    }
    return false;
  }

  isExitUnlocked() {
    const requires = this.missionsConfig?.exit?.requires || [];
    if (!Array.isArray(requires) || requires.length === 0) return true;

    for (const id of requires) {
      const mission = this.missions.get(id);
      if (!mission) continue;
      if (mission.template === 'timedEvac') {
        if (mission.state?.started !== true) return false;
        continue;
      }
      if (!this.isMissionComplete(mission)) return false;
    }
    return true;
  }

  getCurrentRequiredMission() {
    const requires = this.missionsConfig?.exit?.requires || [];
    const requiredIds = Array.isArray(requires) ? requires : [];
    let unlockExitMission = null;
    for (const id of requiredIds) {
      const mission = this.missions.get(id);
      if (!mission) continue;
      if (mission.template === 'unlockExit') {
        if (!this.isMissionComplete(mission)) unlockExitMission = mission;
        continue;
      }
      if (!this.isMissionComplete(mission)) return mission;
    }
    return unlockExitMission;
  }

  getObjectiveText() {
    const requires = this.missionsConfig?.exit?.requires || [];
    const requiredIds = Array.isArray(requires) ? requires : [];

    for (const mission of this.missions.values()) {
      if (!mission || mission.template !== 'timedEvac') continue;
      if (!mission.state.started) continue;
      if (this.gameState?.gameOver) continue;
      const until = Number(mission.state.untilSec) || 0;
      if (!(until > 0)) continue;
      const remaining = Math.max(0, until - this.elapsedSec);
      return remaining > 0 ? `Evacuate! (${Math.ceil(remaining)}s)` : 'Evacuate!';
    }

    const formatMission = (mission) => {
      if (!mission) return '';
      if (mission.template === 'findKeycard') {
        return mission.state.found ? 'Keycard acquired' : 'Find the keycard';
      }
      if (mission.template === 'collectEvidence') {
        return `Collect evidence (${mission.state.collected || 0}/${mission.state.required || 0})`;
      }
      if (mission.template === 'restorePower') {
        return `Restore power (${mission.state.activated?.size || 0}/${mission.state.total || 0})`;
      }
      if (mission.template === 'syncActivate') {
        const total = Number(mission.state.total) || (Array.isArray(mission.state.switches) ? mission.state.switches.length : 0);
        const activated = mission.state.activated?.size || 0;
        const until = Number(mission.state.activeUntilSec) || 0;
        const remaining = mission.state.started ? Math.max(0, until - this.elapsedSec) : 0;
        const suffix = mission.state.started ? ` (${Math.ceil(remaining)}s)` : '';
        return `Sync switches (${activated}/${total})${suffix}`;
      }
      if (mission.template === 'reroutePower') {
        if (mission.state.powered) return 'Power rerouted. Reach the exit.';
        if (!mission.state.clueRead) return 'Find the routing note';
        const breakers = Array.isArray(mission.state.breakers) ? mission.state.breakers : [];
        const onCount = breakers.filter((b) => b?.on).length;
        const requiredOn = Number(mission.state.requiredOn) || 0;
        return `Reroute power (${onCount}/${requiredOn})`;
      }
      if (mission.template === 'activateShrines') {
        return `Activate shrines (${mission.state.activated?.size || 0}/${mission.state.total || 0})`;
      }
      if (mission.template === 'restorePowerFuses') {
        const required = Number(mission.state.fusesRequired) || 0;
        const collected = Number(mission.state.fusesCollected) || 0;
        if (!mission.state.installed) {
          if (required > 0 && collected < required) {
            return `Collect fuses (${collected}/${required})`;
          }
          return 'Install fuses at the power panel (E)';
        }
        if (!mission.state.powered) {
          return 'Restore power at the panel (press E)';
        }
        return 'Power restored. Reach the exit.';
      }
      if (mission.template === 'powerGrid') {
        const branches = Array.isArray(mission.state.branches) ? mission.state.branches : [];
        const required = Number(mission.state.requiredPowered) || branches.length || 0;
        const powered = Number(mission.state.powered) || branches.filter((b) => b?.powered).length;
        mission.state.requiredPowered = required;
        mission.state.powered = powered;

        const fuses = Array.isArray(mission.state.fuses) ? mission.state.fuses : [];
        const collected = Number(mission.state.fusesCollected) || fuses.filter((f) => f?.collected).length;
        mission.state.fusesCollected = collected;

        if (required <= 0 || powered >= required) return 'Power grid online. Reach the exit.';
        if (collected < required) return `Collect fuses (${collected}/${required})`;
        return `Restore power nodes (${powered}/${required})`;
      }
      if (mission.template === 'uploadEvidence') {
        const required = Number(mission.state.required) || 0;
        const collected = Number(mission.state.collected) || 0;
        if (!mission.state.uploaded) {
          if (required > 0 && collected < required) {
            return `Collect evidence (${collected}/${required})`;
          }
          const uploadSeconds = clamp(Math.round(mission.state.uploadSeconds ?? mission.params?.uploadSeconds ?? mission.params?.seconds ?? 0), 0, 600);
          if (uploadSeconds > 0) {
            if (mission.state.uploading) {
              const progress = Math.max(0, Math.min(1, (Number(mission.state.uploadProgressSec) || 0) / uploadSeconds));
              const pct = Math.round(progress * 100);
              return `Upload evidence at the terminal (${pct}%)`;
            }
            return `Start upload at the terminal (${uploadSeconds}s)`;
          }
          return 'Upload evidence at the terminal (E)';
        }
        return 'Evidence uploaded. Reach the exit.';
      }
      if (mission.template === 'blackoutZone') {
        const required = Number(mission.state.required) || 0;
        const restored = Number(mission.state.restored) || 0;
        return `Restore lights in blackout zones (${restored}/${required})`;
      }
      if (mission.template === 'surviveTimer') {
        const remaining = Math.max(0, (mission.state.seconds || 0) - this.elapsedSec);
        const remainingSec = Math.ceil(remaining);
        return remaining > 0 ? `Survive (${remainingSec}s)` : 'Survive (done)';
      }
      if (mission.template === 'surviveInZone') {
        if (!mission.state.started) return 'Start the hold zone (E)';
        const seconds = Number(mission.state.seconds) || 0;
        const held = Number(mission.state.heldForSec) || 0;
        const remaining = Math.max(0, seconds - held);
        return remaining > 0 ? `Hold the zone (${Math.ceil(remaining)}s)` : 'Hold the zone (done)';
      }
      if (mission.template === 'occupyPoint') {
        if (!mission.state.started) return 'Start the control point (E)';
        if (mission.state.completed) return 'Control point secured. Reach the exit.';
        const seconds = Number(mission.state.seconds) || 0;
        const held = Number(mission.state.heldForSec) || 0;
        const remaining = Math.max(0, seconds - held);
        const activeUntil = Number(mission.state.hazardActiveUntilSec) || 0;
        const hazardRemaining = activeUntil > 0 ? Math.max(0, activeUntil - this.elapsedSec) : 0;
        const hazardLabel = hazardRemaining > 0 ? ` — hazard ${Math.ceil(hazardRemaining)}s` : '';
        return remaining > 0 ? `Hold the point (${Math.ceil(remaining)}s)${hazardLabel}` : `Hold the point (done)${hazardLabel}`;
      }
      if (mission.template === 'surviveNoDamage') {
        const start = Number.isFinite(mission.state.lastDamagedAtSec) ? mission.state.lastDamagedAtSec : 0;
        const remaining = Math.max(0, (mission.state.seconds || 0) - (this.elapsedSec - start));
        const remainingSec = Math.ceil(remaining);
        return remaining > 0 ? `Avoid damage (${remainingSec}s)` : 'Avoid damage (done)';
      }
      if (mission.template === 'lowHealthForSeconds') {
        if (mission.state.completed) return 'Low health objective complete. Reach the exit.';
        const seconds = Number(mission.state.seconds) || 0;
        const underFor = Number(mission.state.underForSec) || 0;
        const remaining = Math.max(0, seconds - underFor);
        const threshold = clamp(Math.round(mission.state.healthPct ?? mission.params?.healthPct ?? 35), 1, 99);
        const cur = Number(mission.state.currentHealthPct);
        const hpLabel = Number.isFinite(cur) ? ` (HP ${Math.round(cur)}%)` : '';
        return remaining > 0
          ? `Stay under ${threshold}% HP (${Math.ceil(remaining)}s)${hpLabel}`
          : `Stay under ${threshold}% HP (done)${hpLabel}`;
      }
      if (mission.template === 'noHitRun') {
        if (mission.state.failed) return 'No-hit objective failed.';
        if (mission.state.completed) return 'No-hit objective complete. Reach the exit.';
        return 'Complete objectives without taking damage.';
      }
      if (mission.template === 'reclaimStolenItem') {
        const label = String(mission.state.itemLabel || mission.params?.itemLabel || mission.params?.label || 'stolen item').trim() || 'stolen item';
        if (mission.state.recovered) return `${label} recovered. Reach the exit.`;
        if (mission.state.dropped) return `Recover ${label} (E)`;
        const thiefId = Number(mission.state.thiefMonsterId);
        if (Number.isFinite(thiefId) && thiefId > 0) return `Hunt the thief carrying ${label}`;
        return `Locate the thief carrying ${label}`;
      }
      if (mission.template === 'hiddenTerminal') {
        const label = String(mission.params?.label || 'Terminal').trim() || 'Terminal';
        if (mission.state.completed) return `${label} accessed. Reach the exit.`;
        const roomType = Number(mission.state.roomType);
        const roomName = Number.isFinite(roomType) ? (ROOM_CONFIGS?.[roomType]?.name || 'target room') : 'target room';
        return `Find the hidden ${label} (listen for the beep) — ${roomName}`;
      }
      if (mission.template === 'scanWaypoints') {
        if (mission.state.completed) return 'Scans complete. Reach the exit.';
        const required = Number(mission.state.required) || 0;
        const targets = Array.isArray(mission.state.targets) ? mission.state.targets : [];
        const done = targets.filter((t) => t?.completed).length;
        mission.state.scanned = Math.min(required, done);
        const seconds = Number(mission.state.seconds) || 0;
        const radius = Number(mission.state.radius) || 0;
        const suffix = seconds > 0 ? ` — hold ${seconds}s` : '';
        const radiusLabel = radius > 0 ? ` within ${radius}` : '';
        return `Scan sites (${done}/${required})${radiusLabel}${suffix}`;
      }
      if (mission.template === 'enterRoomType') {
        const roomLabel = formatRoomTypeList(mission.state.roomTypes);
        return `Enter ${roomLabel} (${mission.state.entered || 0}/${mission.state.required || 0})`;
      }
      if (mission.template === 'enterRoomSequence') {
        const seq = Array.isArray(mission.state.sequence) ? mission.state.sequence : [];
        const idx = clamp(Math.round(mission.state.index ?? 0), 0, seq.length);
        if (seq.length < 2) return 'Follow the sequence';
        if (idx >= seq.length) return 'Sequence complete. Reach the exit.';
        const nextType = seq[idx];
        const nextName = ROOM_CONFIGS?.[nextType]?.name || 'Room';
        return `Sequence (${idx}/${seq.length}) → Next: ${nextName}`;
      }
      if (mission.template === 'killCount') {
        return `Defeat monsters (${mission.state.killed || 0}/${mission.state.required || 0})`;
      }
      if (mission.template === 'codeLock') {
        const clues = Array.isArray(mission.state.clues) ? mission.state.clues : [];
        const total = Number(mission.state.cluesTotal) || clues.length || 0;
        const collected = Number(mission.state.cluesCollected) || clues.filter((c) => c?.collected).length;
        const ordered = clues
          .slice()
          .sort((a, b) => String(a?.slot || '').localeCompare(String(b?.slot || '')))
          .map((c) => `${String(c?.slot || '?')}=${c?.collected ? String(c?.digit ?? '?') : '?'}`)
          .join(' ');
        if (!mission.state.codeReady) {
          return total > 0 ? `Find code notes (${collected}/${total}) — ${ordered}` : 'Find code notes';
        }
        if (!mission.state.unlocked) {
          return `Use the keypad (E), enter code + Enter — ${ordered}`;
        }
        return 'Keypad unlocked. Reach the exit.';
      }
      if (mission.template === 'codeLockScan') {
        const clues = Array.isArray(mission.state.clues) ? mission.state.clues : [];
        const total = Number(mission.state.cluesTotal) || clues.length || 0;
        const collected = Number(mission.state.cluesCollected) || clues.filter((c) => c?.collected).length;
        const ordered = clues
          .slice()
          .sort((a, b) => String(a?.slot || '').localeCompare(String(b?.slot || '')))
          .map((c) => `${String(c?.slot || '?')}=${c?.collected ? String(c?.digit ?? '?') : '?'}`)
          .join(' ');

        if (!mission.state.codeReady) {
          return total > 0 ? `Find code notes (${collected}/${total}) — ${ordered}` : 'Find code notes';
        }
        if (!mission.state.unlocked) {
          return `Use the keypad (E), enter code + Enter — ${ordered}`;
        }

        const required = Number(mission.state.scanRequired) || 0;
        const scanned = Number(mission.state.scanned) || 0;
        const seconds = Number(mission.state.scanSeconds) || 0;
        const suffix = seconds > 0 ? ` — hold ${seconds}s` : '';
        return required > 0 ? `Collect sample (${scanned}/${required})${suffix}` : 'Sample complete. Reach the exit.';
      }
      if (mission.template === 'unlockExit') {
        return mission.state.unlocked ? 'Exit unlocked. Reach the exit.' : 'Unlock the exit (press E at the exit)';
      }
      if (mission.template === 'timedEvac') {
        if (!mission.state.started) return 'Complete objectives to start evacuation.';
        const until = Number(mission.state.untilSec) || 0;
        const remaining = until > 0 ? Math.max(0, until - this.elapsedSec) : 0;
        return remaining > 0 ? `Evacuate! (${Math.ceil(remaining)}s)` : 'Evacuate!';
      }
      if (mission.template === 'lockedDoor') {
        return mission.state.unlocked ? 'Door unlocked.' : 'Find a key and unlock the door';
      }
      if (mission.template === 'doorLockNetwork') {
        const doors = Array.isArray(mission.state.doors) ? mission.state.doors : [];
        const total = Number(mission.state.total) || doors.length || 0;
        const unlocked = Number(mission.state.unlocked) || doors.filter((d) => d?.unlocked).length;
        const nextDoor = doors.find((d) => d && !d.unlocked) || null;
        const slot = String(nextDoor?.slot || '').trim() || '?';

        const blocked = mission.state.lastBlockedDoor || null;
        if (blocked && blocked.doorId && nextDoor?.id && blocked.doorId === nextDoor.id) {
          if (blocked.reason === 'requires_item' || blocked.reason === 'consume_failed') {
            const itemLabel = blocked.itemId ? String(blocked.itemId).replaceAll('_', ' ') : 'item';
            return `Unlock doors (${unlocked}/${total}) — Door ${slot}: Need ${itemLabel}`;
          }
          if (blocked.reason === 'mission') {
            return `Unlock doors (${unlocked}/${total}) — Door ${slot}: Complete objective`;
          }
        }

        return nextDoor ? `Unlock doors (${unlocked}/${total}) — Next: Door ${slot}` : `Unlock doors (${unlocked}/${total})`;
      }
      if (mission.template === 'placeItemsAtAltars') {
        const itemsRequired = Number(mission.state.itemsRequired) || 0;
        const itemsCollected = Number(mission.state.itemsCollected) || 0;
        const altarsTotal = Number(mission.state.altarsTotal) || 0;
        const altarsFilled = Number(mission.state.altarsFilled) || 0;
        if (itemsRequired > 0 && itemsCollected < itemsRequired) {
          return `Collect relics (${itemsCollected}/${itemsRequired})`;
        }
        return `Place relics (${altarsFilled}/${altarsTotal})`;
      }
      if (mission.template === 'placeKeysAtLocks') {
        const required = Number(mission.state.required) || 0;
        const keysCollected = Number(mission.state.keysCollected) || 0;
        const locksFilled = Number(mission.state.locksFilled) || 0;
        if (required > 0 && keysCollected < required) {
          return `Collect keys (${keysCollected}/${required})`;
        }
        return `Unlock locks (${locksFilled}/${required})`;
      }
      if (mission.template === 'searchRoomTypeN') {
        return `Search rooms (${mission.state.searched || 0}/${mission.state.required || 0})`;
      }
      if (mission.template === 'searchAndTagRoom') {
        return `Tag targets (${mission.state.tagged || 0}/${mission.state.required || 0})`;
      }
      if (mission.template === 'photographEvidence') {
        const seconds = clamp(Math.round(mission.state.seconds ?? mission.params?.seconds ?? mission.params?.holdSeconds ?? 2), 1, 30);
        const suffix = seconds > 0 ? ` — hold C (${seconds}s)` : '';
        return `Photograph evidence (${mission.state.photos || 0}/${mission.state.required || 0})${suffix}`;
      }
      if (mission.template === 'holdToScan') {
        if (mission.state.completed) return 'Scanning complete. Reach the exit.';
        const required = Number(mission.state.required) || 0;
        const scanned = Number(mission.state.scanned) || 0;
        const seconds = Number(mission.state.seconds) || 0;
        const targets = Array.isArray(mission.state.targets) ? mission.state.targets : [];
        const next = targets.find((t) => t && !t.completed) || null;
        const held = Number(next?.heldForSec) || 0;
        const remaining = Math.max(0, seconds - held);
        const suffix = seconds > 0 ? ` — hold ${Math.ceil(remaining)}s` : '';
        return `Scan targets (${scanned}/${required})${suffix}`;
      }
      if (mission.template === 'deliverItemToTerminal') {
        const required = Number(mission.state.required) || 0;
        const collected = Number(mission.state.collected) || 0;
        if (!mission.state.delivered) {
          if (required > 0 && collected < required) {
            return `Collect packages (${collected}/${required})`;
          }
          return 'Deliver packages at the terminal (E)';
        }
        return 'Delivery complete. Reach the exit.';
      }
      if (mission.template === 'deliverFragile') {
        const pkgLabel = String(mission.params?.packageLabel || mission.params?.label || 'fragile package').trim() || 'fragile package';
        if (mission.state.delivered) return `${pkgLabel} delivered. Reach the exit.`;
        return mission.state.carrying
          ? `Deliver the ${pkgLabel} at the terminal (E)`
          : `Pick up the ${pkgLabel} (E)`;
      }
      if (mission.template === 'switchSequenceWithClues') {
        const clues = Array.isArray(mission.state.clues) ? mission.state.clues : [];
        const total = Number(mission.state.cluesTotal) || clues.length || 0;
        const collected = Number(mission.state.cluesCollected) || clues.filter((c) => c?.collected).length;
        const ordered = clues
          .slice()
          .sort((a, b) => (Number(a?.stepIndex) || 0) - (Number(b?.stepIndex) || 0))
          .map((c) => `${Number.isFinite(c?.stepIndex) ? c.stepIndex + 1 : '?'}=${c?.collected ? String(c?.slot || '?') : '?'}`)
          .join(' ');

        if (!mission.state.sequenceKnown) {
          return total > 0 ? `Find sequence notes (${collected}/${total}) — ${ordered}` : 'Find sequence notes';
        }
      }
      if (mission.template === 'switchSequence' || mission.template === 'switchSequenceWithClues') {
        const seqSlots = Array.isArray(mission.state.sequenceSlots) ? mission.state.sequenceSlots : [];
        const seq = Array.isArray(mission.state.sequence) ? mission.state.sequence : [];
        const idx = clamp(Math.round(mission.state.index ?? 0), 0, seq.length);
        if (seq.length < 2 || seqSlots.length < 2) return 'Activate the switch sequence';
        if (idx >= seq.length) return 'Switch sequence complete. Reach the exit.';
        const nextSlot = seqSlots[idx] || '?';
        return `Switch sequence (${idx}/${seq.length}) → Next: ${nextSlot}`;
      }
      if (mission.template === 'hideForSeconds') {
        if (mission.state.completed) return 'Hiding complete. Reach the exit.';
        const seconds = Number(mission.state.seconds) || 0;
        const hiddenFor = Number(mission.state.hiddenForSec) || 0;
        const remaining = Math.max(0, seconds - hiddenFor);
        return remaining > 0 ? `Hide (${remaining}s)` : 'Hide (done)';
      }
      if (mission.template === 'hideUntilClear') {
        if (mission.state.completed) return 'Threat cleared. Reach the exit.';
        const minDistance = Number(mission.state.minDistance) || 0;
        const nearest = Number(mission.state.nearestMonsterDist);
        const requireNoLOS = mission.state.requireNoLOS !== false;
        const hasLOS = mission.state.nearestMonsterHasLOS === true;
        const quietSeconds = Number(mission.state.quietSeconds) || 0;
        const lastNoiseAt = Number.isFinite(mission.state.lastNoiseAtSec) ? mission.state.lastNoiseAtSec : 0;
        const quietRemaining = quietSeconds > 0 ? Math.max(0, quietSeconds - (this.elapsedSec - lastNoiseAt)) : 0;

        const parts = [];
        if (minDistance > 0 && Number.isFinite(nearest)) parts.push(`distance ${nearest}/${minDistance}`);
        if (requireNoLOS) parts.push(hasLOS ? 'LOS' : 'no LOS');
        if (quietSeconds > 0) parts.push(`quiet ${Math.ceil(quietRemaining)}s`);
        const suffix = parts.length > 0 ? ` (${parts.join(', ')})` : '';
        return `Stay hidden until clear${suffix}`;
      }
      if (mission.template === 'escort') {
        if (mission.state.completed) return 'Escort complete. Reach the exit.';
        return mission.state.started ? 'Escort the survivor to the exit.' : 'Find the survivor and start the escort (E)';
      }
      if (mission.template === 'escortRescue') {
        if (mission.state.completed) return 'Rescue complete. Reach the exit.';
        if (!mission.state.started) return 'Find the survivor and start the rescue (E)';
        return 'Escort the survivor to the exit (monsters will track them).';
      }
      if (mission.template === 'escortToSafeRoom') {
        if (mission.state.completed) return 'Escort complete. Reach the exit.';
        if (!mission.state.started) return 'Find the survivor and start the escort (E)';
        const stage = clamp(Math.round(mission.state.stage ?? 1), 0, 10);
        if (stage === 2) {
          const waitSeconds = clamp(Math.round(mission.state.checkpointWaitSeconds ?? mission.params?.checkpointWaitSeconds ?? 3), 0, 120);
          const waited = clamp(Math.round(mission.state.waitedSec ?? 0), 0, waitSeconds);
          const remaining = Math.max(0, waitSeconds - waited);
          return waitSeconds > 0 ? `Hold position at the checkpoint (${remaining}s)` : 'Checkpoint cleared. Continue.';
        }
        if (stage >= 3) return 'Escort the survivor to the safe room.';
        return 'Escort the survivor to the checkpoint.';
      }
      if (mission.template === 'stealthNoise') {
        const start = Number.isFinite(mission.state.lastNoiseAtSec) ? mission.state.lastNoiseAtSec : 0;
        const baseSeconds = Number(mission.state.seconds) || 0;
        const strikes = Math.max(0, Math.round(Number(mission.state.strikes) || 0));
        const perStrike = Math.max(0, Math.round(Number(mission.state.penaltySecondsPerStrike) || 0));
        const cap = Math.max(0, Math.round(Number(mission.state.maxPenaltySeconds) || 0));
        const penalty = perStrike > 0 ? Math.min(cap, strikes * perStrike) : 0;
        const seconds = baseSeconds + penalty;
        const remaining = Math.max(0, seconds - (this.elapsedSec - start));
        const remainingSec = Math.ceil(remaining);
        const maxNoiseStrength = mission.state.maxNoiseStrength;
        const thresholdEnabled = Number.isFinite(maxNoiseStrength);
        const limitPct = thresholdEnabled ? Math.round((Number(maxNoiseStrength) || 0) * 100) : null;
        const maxStrikes = Number(mission.state.maxStrikes) || 0;
        const strikesLabel = thresholdEnabled
          ? (maxStrikes > 0 ? `, strikes ${strikes}/${maxStrikes}` : `, strikes ${strikes}`)
          : '';
        const limitLabel = thresholdEnabled ? `limit ${limitPct}%` : '';
        const suffix = thresholdEnabled ? ` (${limitLabel}${strikesLabel})` : '';
        return remaining > 0 ? `Stay quiet (${remainingSec}s)${suffix}` : `Stay quiet (done)${suffix}`;
      }
      if (mission.template === 'lureToSensor') {
        const required = clamp(Math.round(mission.state.requiredTriggers ?? mission.params?.requiredTriggers ?? 1), 1, 12);
        const triggered = clamp(Math.round(mission.state.triggered ?? 0), 0, required);
        mission.state.requiredTriggers = required;
        mission.state.triggered = triggered;

        if (mission.state.completed) return `Sensor triggered (${triggered}/${required}). Reach the exit.`;

        const requireLure = mission.state.requireLure !== false;
        const until = Number(mission.state.lureUntilSec) || 0;
        const remaining = Math.max(0, until - this.elapsedSec);
        const lureActive = !requireLure || (until > 0 && remaining > 0);

        const cooldownUntil = Number(mission.state.cooldownUntilSec) || 0;
        const cooldownRemaining = Math.max(0, cooldownUntil - this.elapsedSec);
        if (cooldownRemaining > 0) {
          return `Sensor cooling down (${Math.ceil(cooldownRemaining)}s) — lures (${triggered}/${required})`;
        }

        const requireClear = mission.state.requireClear !== false;
        if (requireClear && mission.state.awaitingClear) {
          return `Wait for the area to clear — lures (${triggered}/${required})`;
        }

        if (!mission.state.armed) return `Arm the sensor (E) — lures (${triggered}/${required})`;
        if (requireLure && !lureActive) return `Trigger the lure device (E) — lures (${triggered}/${required})`;
        return remaining > 0
          ? `Lure a monster to the sensor (${Math.ceil(remaining)}s) — lures (${triggered}/${required})`
          : `Lure a monster to the sensor — lures (${triggered}/${required})`;
      }
      if (mission.template === 'bossFinale') {
        const phase = Math.max(0, Math.round(Number(mission.state.phase) || 0));
        const nodesRemaining = Math.max(0, Math.round(Number(mission.state.nodesRemaining) || 0));
        const nodesTotal = Math.max(0, Math.round(Number(mission.state.nodesTotal) || 0));
        const hp = Math.max(0, Math.round(Number(mission.state.bossHealth) || 0));
        const maxHp = Math.max(1, Math.round(Number(mission.state.bossMaxHealth) || 1));
        const hpPct = clamp(Math.round((hp / maxHp) * 100), 0, 100);

        if (phase <= 1) {
          return `Destroy Shield Nodes (${nodesRemaining}/${nodesTotal})`;
        }
        if (phase === 2) {
          return `Defeat the Core (HP ${hpPct}%)`;
        }
        const until = Number(mission.state.escapeUntilSec) || 0;
        const remaining = until > 0 ? Math.max(0, until - (performance.now() / 1000)) : 0;
        const remSec = Math.ceil(remaining);
        return remaining > 0 ? `Escape! (${remSec}s)` : 'Escape!';
      }
      return mission.id;
    };

    const current = this.getCurrentRequiredMission();
    if (current && !this.isMissionComplete(current)) return formatMission(current);

    if (requiredIds.length > 0) {
      return this.isExitUnlocked() ? 'Exit unlocked. Reach the exit.' : 'Complete objectives to unlock the exit.';
    }

    return 'Reach the exit.';
  }

  getObjectiveProgress(mission) {
    if (!mission) return null;
    if (mission.template === 'findKeycard') {
      return { found: !!mission.state.found };
    }
    if (mission.template === 'collectEvidence') {
      return {
        collected: mission.state.collected || 0,
        required: mission.state.required || 0,
        total: mission.state.total || 0
      };
    }
    if (mission.template === 'restorePower') {
      return {
        activated: mission.state.activated?.size || 0,
        total: mission.state.total || 0
      };
    }
    if (mission.template === 'syncActivate') {
      const total = Number(mission.state.total) || (Array.isArray(mission.state.switches) ? mission.state.switches.length : 0);
      const activated = mission.state.activated?.size || 0;
      const until = Number(mission.state.activeUntilSec) || 0;
      const remaining = mission.state.started ? Math.max(0, until - this.elapsedSec) : 0;
      return {
        started: !!mission.state.started,
        activated,
        total,
        windowSec: Number(mission.state.windowSec) || 0,
        remaining
      };
    }
    if (mission.template === 'reroutePower') {
      const breakers = Array.isArray(mission.state.breakers) ? mission.state.breakers : [];
      const onCount = breakers.filter((b) => b?.on).length;
      const requiredOn = Number(mission.state.requiredOn) || 0;
      return {
        clueRead: !!mission.state.clueRead,
        powered: !!mission.state.powered,
        onCount,
        requiredOn,
        failures: Number(mission.state.failures) || 0
      };
    }
    if (mission.template === 'activateShrines') {
      return {
        activated: mission.state.activated?.size || 0,
        total: mission.state.total || 0
      };
    }
    if (mission.template === 'restorePowerFuses') {
      return {
        fusesCollected: mission.state.fusesCollected || 0,
        fusesRequired: mission.state.fusesRequired || 0,
        installed: !!mission.state.installed,
        powered: !!mission.state.powered,
        panelId: mission.state.panelId || null,
        panelGridPos: mission.state.panelGridPos || null
      };
    }
    if (mission.template === 'powerGrid') {
      const branches = Array.isArray(mission.state.branches) ? mission.state.branches : [];
      const requiredPowered = Number(mission.state.requiredPowered) || branches.length || 0;
      const powered = Number(mission.state.powered) || branches.filter((b) => b?.powered).length;
      mission.state.requiredPowered = requiredPowered;
      mission.state.powered = powered;

      const fuses = Array.isArray(mission.state.fuses) ? mission.state.fuses : [];
      const fusesCollected = Number(mission.state.fusesCollected) || fuses.filter((f) => f?.collected).length;
      mission.state.fusesCollected = fusesCollected;

      return {
        total: branches.length,
        requiredPowered,
        powered,
        fusesCollected,
        fusesTotal: fuses.length,
        itemId: mission.state.itemId || null
      };
    }
    if (mission.template === 'uploadEvidence') {
      const uploadSeconds = clamp(Math.round(mission.state.uploadSeconds ?? mission.params?.uploadSeconds ?? mission.params?.seconds ?? 0), 0, 600);
      return {
        collected: mission.state.collected || 0,
        required: mission.state.required || 0,
        total: mission.state.total || 0,
        uploaded: !!mission.state.uploaded,
        uploading: !!mission.state.uploading,
        uploadSeconds,
        uploadProgressSec: Number(mission.state.uploadProgressSec) || 0,
        uploadRadius: Number(mission.state.uploadRadius) || 0,
        terminalId: mission.state.terminalId || null,
        terminalGridPos: mission.state.terminalGridPos || null
      };
    }
    if (mission.template === 'blackoutZone') {
      const zones = Array.isArray(mission.state.zones) ? mission.state.zones : [];
      const required = Number(mission.state.required) || zones.length || 0;
      const restored = Number(mission.state.restored) || zones.filter((z) => z?.restored).length;
      mission.state.required = required;
      mission.state.restored = restored;
      return {
        total: zones.length,
        required,
        restored,
        radius: Number(mission.state.radius) || 0
      };
    }
    if (mission.template === 'surviveTimer') {
      const remaining = Math.max(0, (mission.state.seconds || 0) - this.elapsedSec);
      return { seconds: mission.state.seconds || 0, remaining, completed: !!mission.state.completed };
    }
    if (mission.template === 'surviveInZone') {
      const seconds = Number(mission.state.seconds) || 0;
      const heldForSec = Number(mission.state.heldForSec) || 0;
      const remaining = Math.max(0, seconds - heldForSec);
      return {
        started: !!mission.state.started,
        seconds,
        heldForSec,
        remaining,
        radius: Number(mission.state.radius) || 0,
        exitGraceSec: Number(mission.state.exitGraceSec) || 0,
        goalGridPos: mission.state.beaconGridPos || null,
        beaconId: mission.state.beaconId || null,
        beaconGridPos: mission.state.beaconGridPos || null,
        completed: !!mission.state.completed
      };
    }
    if (mission.template === 'occupyPoint') {
      const seconds = Number(mission.state.seconds) || 0;
      const heldForSec = Number(mission.state.heldForSec) || 0;
      const remaining = Math.max(0, seconds - heldForSec);
      const activeUntil = Number(mission.state.hazardActiveUntilSec) || 0;
      const hazardRemaining = activeUntil > 0 ? Math.max(0, activeUntil - this.elapsedSec) : 0;
      const nextAt = Number(mission.state.nextHazardAtSec) || 0;
      const nextIn = nextAt > 0 ? Math.max(0, nextAt - this.elapsedSec) : null;
      return {
        started: !!mission.state.started,
        seconds,
        heldForSec,
        remaining,
        radius: Number(mission.state.radius) || 0,
        exitGraceSec: Number(mission.state.exitGraceSec) || 0,
        hazardIntervalSec: Number(mission.state.hazardIntervalSec) || 0,
        hazardDurationSec: Number(mission.state.hazardDurationSec) || 0,
        hazardDamage: Number(mission.state.hazardDamage) || 0,
        hazardRemaining,
        nextHazardIn: Number.isFinite(nextIn) ? nextIn : null,
        beaconId: mission.state.beaconId || null,
        beaconGridPos: mission.state.beaconGridPos || null,
        completed: !!mission.state.completed
      };
    }
    if (mission.template === 'surviveNoDamage') {
      const start = Number.isFinite(mission.state.lastDamagedAtSec) ? mission.state.lastDamagedAtSec : 0;
      const remaining = Math.max(0, (mission.state.seconds || 0) - (this.elapsedSec - start));
      return { seconds: mission.state.seconds || 0, remaining, hits: mission.state.hits || 0, completed: !!mission.state.completed };
    }
    if (mission.template === 'lowHealthForSeconds') {
      const seconds = Number(mission.state.seconds) || 0;
      const underForSec = Number(mission.state.underForSec) || 0;
      const remaining = Math.max(0, seconds - underForSec);
      return {
        seconds,
        healthPct: Number(mission.state.healthPct) || 0,
        currentHealthPct: Number.isFinite(Number(mission.state.currentHealthPct)) ? Number(mission.state.currentHealthPct) : null,
        underForSec,
        remaining,
        completed: !!mission.state.completed
      };
    }
    if (mission.template === 'noHitRun') {
      return {
        hits: Number(mission.state.hits) || 0,
        failed: !!mission.state.failed,
        loseOnHit: mission.state.loseOnHit !== false,
        completed: !!mission.state.completed
      };
    }
    if (mission.template === 'reclaimStolenItem') {
      return {
        itemId: String(mission.state.itemId || mission.params?.itemId || ''),
        itemCount: Number(mission.state.itemCount) || 0,
        itemLabel: String(mission.state.itemLabel || mission.params?.itemLabel || mission.params?.label || ''),
        objectKind: String(mission.state.objectKind || mission.params?.objectKind || ''),
        thiefMonsterId: Number(mission.state.thiefMonsterId) || null,
        thiefHits: Number(mission.state.thiefHits) || 0,
        dropOnHit: mission.state.dropOnHit === true,
        hitsToDrop: Number(mission.state.hitsToDrop) || 0,
        dropAtHealthPct: Number.isFinite(Number(mission.state.dropAtHealthPct)) ? Number(mission.state.dropAtHealthPct) : null,
        dropped: !!mission.state.dropped,
        recovered: !!mission.state.recovered,
        dropId: mission.state.dropId || null,
        dropGridPos: mission.state.dropGridPos || null
      };
    }
    if (mission.template === 'hiddenTerminal') {
      return {
        completed: !!mission.state.completed,
        terminalId: mission.state.terminalId || null,
        terminalGridPos: mission.state.terminalGridPos || null,
        roomType: Number.isFinite(Number(mission.state.roomType)) ? Number(mission.state.roomType) : null,
        pingIntervalSec: Number(mission.state.pingIntervalSec) || 0,
        revealMarkerAtHintTier: Number(mission.state.revealMarkerAtHintTier) || 0
      };
    }
    if (mission.template === 'scanWaypoints') {
      const targets = Array.isArray(mission.state.targets) ? mission.state.targets : [];
      const required = Number(mission.state.required) || targets.length || 0;
      const scanned = targets.filter((t) => t?.completed).length;
      mission.state.required = required;
      mission.state.scanned = Math.min(required, scanned);
      return {
        required,
        scanned,
        seconds: Number(mission.state.seconds) || 0,
        radius: Number(mission.state.radius) || 0,
        requireLOS: mission.state.requireLOS === true,
        completed: !!mission.state.completed
      };
    }
    if (mission.template === 'enterRoomType') {
      return {
        entered: mission.state.entered || 0,
        required: mission.state.required || 0,
        roomTypes: normalizeRoomTypes(mission.state.roomTypes) || []
      };
    }
    if (mission.template === 'enterRoomSequence') {
      const seq = Array.isArray(mission.state.sequence) ? mission.state.sequence : [];
      const idx = clamp(Math.round(mission.state.index ?? 0), 0, seq.length);
      const nextRoomType = idx >= 0 && idx < seq.length ? seq[idx] : null;
      return {
        sequence: seq.slice(),
        index: idx,
        total: seq.length,
        nextRoomType
      };
    }
    if (mission.template === 'killCount') {
      return {
        killed: mission.state.killed || 0,
        required: mission.state.required || 0
      };
    }
    if (mission.template === 'codeLock') {
      const clues = Array.isArray(mission.state.clues) ? mission.state.clues : [];
      return {
        cluesCollected: Number(mission.state.cluesCollected) || clues.filter((c) => c?.collected).length,
        cluesTotal: Number(mission.state.cluesTotal) || clues.length || 0,
        codeReady: !!mission.state.codeReady,
        unlocked: !!mission.state.unlocked,
        keypadId: mission.state.keypadId || null,
        keypadGridPos: mission.state.keypadGridPos || null
      };
    }
    if (mission.template === 'codeLockScan') {
      const clues = Array.isArray(mission.state.clues) ? mission.state.clues : [];
      const targets = Array.isArray(mission.state.scanTargets) ? mission.state.scanTargets : [];
      const required = Number(mission.state.scanRequired) || targets.length || 0;
      const scanned = Number(mission.state.scanned) || targets.filter((t) => t?.completed).length;
      mission.state.scanRequired = required;
      mission.state.scanned = Math.min(required, scanned);
      return {
        cluesCollected: Number(mission.state.cluesCollected) || clues.filter((c) => c?.collected).length,
        cluesTotal: Number(mission.state.cluesTotal) || clues.length || 0,
        codeReady: !!mission.state.codeReady,
        unlocked: !!mission.state.unlocked,
        keypadId: mission.state.keypadId || null,
        keypadGridPos: mission.state.keypadGridPos || null,
        scanSeconds: Number(mission.state.scanSeconds) || 0,
        scanRequired: required,
        scanned
      };
    }
    if (mission.template === 'unlockExit') {
      return { unlocked: !!mission.state.unlocked };
    }
    if (mission.template === 'timedEvac') {
      const until = Number(mission.state.untilSec) || 0;
      const remaining = until > 0 ? Math.max(0, until - this.elapsedSec) : null;
      return {
        started: !!mission.state.started,
        seconds: Number(mission.state.seconds) || 0,
        remaining: Number.isFinite(remaining) ? remaining : null,
        untilSec: until > 0 ? until : null,
        escalateMonsters: mission.state.escalateMonsters !== false
      };
    }
    if (mission.template === 'lockedDoor') {
      return {
        unlocked: !!mission.state.unlocked,
        keyItemId: mission.state.keyItemId || null,
        keyPicked: !!mission.state.keyPicked,
        keyGridPos: mission.state.keyGridPos || null,
        doorId: mission.state.doorId || null,
        doorGridPos: mission.state.doorGridPos || null,
        doorApproachGridPos: mission.state.doorApproachGridPos || null
      };
    }
    if (mission.template === 'doorLockNetwork') {
      const doors = Array.isArray(mission.state.doors) ? mission.state.doors : [];
      const total = Number(mission.state.total) || doors.length || 0;
      const unlocked = Number(mission.state.unlocked) || doors.filter((d) => d?.unlocked).length;
      const nextDoor = doors.find((d) => d && !d.unlocked) || null;
      return {
        total,
        unlocked,
        lastBlockedDoor: mission.state.lastBlockedDoor || null,
        nextDoorId: nextDoor?.id || null,
        nextDoorSlot: nextDoor?.slot || null,
        nextDoorApproachGridPos: nextDoor?.doorApproachGridPos || null
      };
    }
    if (mission.template === 'placeItemsAtAltars') {
      return {
        itemId: mission.state.itemId || null,
        itemsCollected: mission.state.itemsCollected || 0,
        itemsRequired: mission.state.itemsRequired || 0,
        altarsFilled: mission.state.altarsFilled || 0,
        altarsTotal: mission.state.altarsTotal || 0
      };
    }
    if (mission.template === 'placeKeysAtLocks') {
      return {
        required: mission.state.required || 0,
        keysCollected: mission.state.keysCollected || 0,
        locksFilled: mission.state.locksFilled || 0,
        itemIds: Array.isArray(mission.state.itemIds) ? mission.state.itemIds.slice() : [],
        keysTotal: Array.isArray(mission.state.keys) ? mission.state.keys.length : 0,
        locksTotal: Array.isArray(mission.state.locks) ? mission.state.locks.length : 0
      };
    }
    if (mission.template === 'searchRoomTypeN') {
      return {
        searched: mission.state.searched || 0,
        required: mission.state.required || 0,
        targetsTotal: Array.isArray(mission.state.targets) ? mission.state.targets.length : 0
      };
    }
    if (mission.template === 'searchAndTagRoom') {
      return {
        tagged: mission.state.tagged || 0,
        required: mission.state.required || 0,
        targetsTotal: Array.isArray(mission.state.targets) ? mission.state.targets.length : 0
      };
    }
    if (mission.template === 'photographEvidence') {
      const seconds = clamp(Math.round(mission.state.seconds ?? mission.params?.seconds ?? mission.params?.holdSeconds ?? 2), 1, 30);
      mission.state.seconds = seconds;
      const targets = Array.isArray(mission.state.targets) ? mission.state.targets : [];
      const required = Number(mission.state.required) || targets.length || 0;
      const photos = targets.filter((t) => t?.completed || t?.photographed).length;
      const next = targets.find((t) => t && !(t.completed || t.photographed)) || null;
      const heldForSec = Number(next?.heldForSec) || 0;
      const remaining = Math.max(0, seconds - heldForSec);
      return {
        photos: Math.min(required, photos),
        required,
        seconds,
        heldForSec,
        remaining,
        nextTargetId: next?.id || null,
        nextTargetGridPos: next?.gridPos || null,
        targetsTotal: targets.length
      };
    }
    if (mission.template === 'holdToScan') {
      const seconds = Number(mission.state.seconds) || 0;
      const targets = Array.isArray(mission.state.targets) ? mission.state.targets : [];
      const required = Number(mission.state.required) || targets.length || 0;
      const scanned = targets.filter((t) => t?.completed).length;
      const next = targets.find((t) => t && !t.completed) || null;
      const heldForSec = Number(next?.heldForSec) || 0;
      const remaining = Math.max(0, seconds - heldForSec);
      return {
        seconds,
        required,
        scanned,
        heldForSec,
        remaining,
        nextTargetId: next?.id || null,
        nextTargetGridPos: next?.gridPos || null,
        completed: !!mission.state.completed
      };
    }
    if (mission.template === 'deliverItemToTerminal') {
      return {
        itemId: mission.state.itemId || null,
        collected: mission.state.collected || 0,
        required: mission.state.required || 0,
        total: mission.state.total || 0,
        delivered: !!mission.state.delivered,
        terminalId: mission.state.terminalId || null,
        terminalGridPos: mission.state.terminalGridPos || null
      };
    }
    if (mission.template === 'deliverFragile') {
      return {
        itemId: mission.state.itemId || null,
        carrying: !!mission.state.carrying,
        delivered: !!mission.state.delivered,
        packageId: mission.state.packageId || null,
        packageGridPos: mission.state.packageGridPos || null,
        terminalId: mission.state.terminalId || null,
        terminalGridPos: mission.state.terminalGridPos || null,
        breakOnGunfire: mission.state.breakOnGunfire !== false,
        breakOnDamage: mission.state.breakOnDamage !== false
      };
    }
    if (mission.template === 'bossFinale') {
      const phase = Math.max(0, Math.round(Number(mission.state.phase) || 0));
      const nodesTotal = Math.max(0, Math.round(Number(mission.state.nodesTotal) || 0));
      const nodesRemaining = Math.max(0, Math.round(Number(mission.state.nodesRemaining) || 0));
      const bossMaxHealth = Math.max(1, Math.round(Number(mission.state.bossMaxHealth) || 1));
      const bossHealth = Math.max(0, Math.round(Number(mission.state.bossHealth) || 0));
      const shieldActive = mission.state.shieldActive === true;
      const escapeUntilSec = Number(mission.state.escapeUntilSec) || 0;
      const now = performance.now() / 1000;
      const escapeRemaining = escapeUntilSec > 0 ? Math.max(0, escapeUntilSec - now) : 0;
      return {
        phase,
        nodesTotal,
        nodesRemaining,
        bossHealth,
        bossMaxHealth,
        shieldActive,
        escapeRemaining
      };
    }
    if (mission.template === 'switchSequence' || mission.template === 'switchSequenceWithClues') {
      const seq = Array.isArray(mission.state.sequence) ? mission.state.sequence : [];
      const idx = clamp(Math.round(mission.state.index ?? 0), 0, seq.length);
      const slots = Array.isArray(mission.state.sequenceSlots) ? mission.state.sequenceSlots : [];
      const nextSlot = idx >= 0 && idx < slots.length ? slots[idx] : null;
      const out = {
        index: idx,
        total: seq.length,
        nextSlot,
        sequenceSlots: slots.slice()
      };
      if (mission.template === 'switchSequenceWithClues') {
        const clues = Array.isArray(mission.state.clues) ? mission.state.clues : [];
        out.sequenceKnown = !!mission.state.sequenceKnown;
        out.cluesCollected = Number(mission.state.cluesCollected) || clues.filter((c) => c?.collected).length;
        out.cluesTotal = Number(mission.state.cluesTotal) || clues.length || 0;
      }
      return out;
    }
    if (mission.template === 'hideForSeconds') {
      const seconds = Number(mission.state.seconds) || 0;
      const hiddenForSec = Number(mission.state.hiddenForSec) || 0;
      const remaining = Math.max(0, seconds - hiddenForSec);
      return {
        seconds,
        hiddenForSec,
        remaining,
        hidden: !!this.playerHidden,
        completed: !!mission.state.completed
      };
    }
    if (mission.template === 'hideUntilClear') {
      const minDistance = Number(mission.state.minDistance) || 0;
      const requireNoLOS = mission.state.requireNoLOS !== false;
      const hasLOS = mission.state.nearestMonsterHasLOS === true;
      const quietSeconds = Number(mission.state.quietSeconds) || 0;
      const lastNoiseAt = Number.isFinite(mission.state.lastNoiseAtSec) ? mission.state.lastNoiseAtSec : 0;
      const quietRemaining = quietSeconds > 0 ? Math.max(0, quietSeconds - (this.elapsedSec - lastNoiseAt)) : 0;
      return {
        minDistance,
        nearestMonsterDist: mission.state.nearestMonsterDist ?? null,
        requireNoLOS,
        hasLOS,
        quietSeconds,
        quietRemaining,
        hidden: !!this.playerHidden,
        completed: !!mission.state.completed
      };
    }
    if (mission.template === 'escort') {
      return {
        started: !!mission.state.started,
        completed: !!mission.state.completed,
        escortGridPos: mission.state.escortGridPos || null,
        goalGridPos: mission.state.goalGridPos || null,
        followDistance: mission.state.followDistance || 1
      };
    }
    if (mission.template === 'escortRescue') {
      return {
        started: !!mission.state.started,
        completed: !!mission.state.completed,
        escortGridPos: mission.state.escortGridPos || null,
        goalGridPos: mission.state.goalGridPos || null,
        followDistance: mission.state.followDistance || 1,
        aggroNoiseIntervalSec: Number(mission.state.aggroNoiseIntervalSec) || 0,
        aggroScentIntervalSec: Number(mission.state.aggroScentIntervalSec) || 0
      };
    }
    if (mission.template === 'escortToSafeRoom') {
      const waitSeconds = clamp(Math.round(mission.state.checkpointWaitSeconds ?? mission.params?.checkpointWaitSeconds ?? 3), 0, 120);
      const waitedSec = clamp(Math.round(mission.state.waitedSec ?? 0), 0, waitSeconds);
      return {
        started: !!mission.state.started,
        completed: !!mission.state.completed,
        stage: clamp(Math.round(mission.state.stage ?? 0), 0, 10),
        waitedSec,
        checkpointWaitSeconds: waitSeconds,
        checkpointPlayerRadius: clamp(Math.round(mission.state.checkpointPlayerRadius ?? mission.params?.checkpointPlayerRadius ?? 2), 0, 10),
        escortGridPos: mission.state.escortGridPos || null,
        goalGridPos: mission.state.goalGridPos || null,
        checkpointGridPos: mission.state.checkpointGridPos || null,
        safeGoalGridPos: mission.state.safeGoalGridPos || null,
        followDistance: mission.state.followDistance || 1
      };
    }
    if (mission.template === 'stealthNoise') {
      const start = Number.isFinite(mission.state.lastNoiseAtSec) ? mission.state.lastNoiseAtSec : 0;
      const baseSeconds = Number(mission.state.seconds) || 0;
      const strikes = Math.max(0, Math.round(Number(mission.state.strikes) || 0));
      const perStrike = Math.max(0, Math.round(Number(mission.state.penaltySecondsPerStrike) || 0));
      const cap = Math.max(0, Math.round(Number(mission.state.maxPenaltySeconds) || 0));
      const penalty = perStrike > 0 ? Math.min(cap, strikes * perStrike) : 0;
      const seconds = baseSeconds + penalty;
      const remaining = Math.max(0, seconds - (this.elapsedSec - start));
      return {
        seconds: baseSeconds,
        effectiveSeconds: seconds,
        remaining,
        gunshots: mission.state.gunshots || 0,
        maxNoiseStrength: Number.isFinite(mission.state.maxNoiseStrength) ? Number(mission.state.maxNoiseStrength) : null,
        strikes,
        maxStrikes: Number(mission.state.maxStrikes) || 0,
        penaltySecondsPerStrike: Number(mission.state.penaltySecondsPerStrike) || 0,
        penaltySeconds: penalty,
        failed: !!mission.state.failed,
        completed: !!mission.state.completed
      };
    }
    if (mission.template === 'lureToSensor') {
      const requireLure = mission.state.requireLure !== false;
      const until = Number(mission.state.lureUntilSec) || 0;
      const lureRemaining = Math.max(0, until - this.elapsedSec);
      const lureActive = !requireLure || (until > 0 && lureRemaining > 0);
      const requiredTriggers = clamp(Math.round(mission.state.requiredTriggers ?? mission.params?.requiredTriggers ?? 1), 1, 12);
      const triggered = clamp(Math.round(mission.state.triggered ?? 0), 0, requiredTriggers);
      mission.state.requiredTriggers = requiredTriggers;
      mission.state.triggered = triggered;

      const cooldownUntil = Number(mission.state.cooldownUntilSec) || 0;
      const cooldownRemaining = Math.max(0, cooldownUntil - this.elapsedSec);
      const inCooldown = cooldownRemaining > 0;

      const requireClear = mission.state.requireClear === undefined
        ? (requiredTriggers > 1)
        : (mission.state.requireClear !== false);
      mission.state.requireClear = requireClear;

      const stage = mission.state.completed
        ? 'completed'
        : (!mission.state.armed
          ? 'arm'
          : (inCooldown
            ? 'cooldown'
            : (requireClear && mission.state.awaitingClear
              ? 'clear'
              : (requireLure && !lureActive ? 'trigger' : 'wait'))));
      return {
        stage,
        armed: !!mission.state.armed,
        requireLure,
        lureRemaining,
        lureActive,
        requiredTriggers,
        triggered,
        cooldownRemaining,
        requireClear,
        awaitingClear: !!mission.state.awaitingClear,
        sensorId: mission.state.sensorId || null,
        sensorGridPos: mission.state.sensorGridPos || null,
        lureId: mission.state.lureId || null,
        lureGridPos: mission.state.lureGridPos || null,
        goalGridPos: mission.state.sensorGridPos || null,
        completed: !!mission.state.completed
      };
    }
    return null;
  }

  syncStatus(force = false) {
    const unlocked = this.isExitUnlocked();
    const objectiveText = this.getObjectiveText();

    const requires = this.missionsConfig?.exit?.requires || [];
    const requiredIds = Array.isArray(requires) ? requires : [];
    const total = requiredIds.length;
    let completed = 0;
    for (const id of requiredIds) {
      const m = this.missions.get(id);
      if (!m) continue;
      if (this.isMissionComplete(m)) completed += 1;
    }

    const key = `${unlocked}:${completed}/${total}:${objectiveText}`;
    if (!force && key === this.lastStatusKey) return;
    this.lastStatusKey = key;

    if (this.gameState) {
      this.gameState.setMissionTotal?.(total);
      this.gameState.missionsCollected = completed;
      this.gameState.setExitUnlocked?.(unlocked, objectiveText);
    }

    const prevUnlocked = this.exitUnlocked;
    this.exitUnlocked = unlocked;

    if (!unlocked) {
      this.exitLockMessage = objectiveText || 'Exit locked';
    } else {
      this.exitLockMessage = '';
    }

    this.eventBus?.emit?.(EVENTS.MISSION_UPDATED, {
      objectivesCompleted: completed,
      objectivesTotal: total,
      exitUnlocked: unlocked,
      objectiveText
    });

    if (prevUnlocked !== unlocked) {
      this.eventBus?.emit?.(unlocked ? EVENTS.EXIT_UNLOCKED : EVENTS.EXIT_LOCKED, {
        message: unlocked ? 'Exit unlocked' : (this.exitLockMessage || 'Exit locked')
      });
      if (typeof this.exitPoint?.setUnlocked === 'function') {
        this.exitPoint.setUnlocked(unlocked);
      }
    }

    // Emit mission completion events once per mission.
    for (const mission of this.missions.values()) {
      if (!mission?.id) continue;
      const id = String(mission.id || '').trim();
      if (!id) continue;

      if (this.isMissionComplete(mission)) {
        if (!this.completedMissionIds.has(id)) {
          this.completedMissionIds.add(id);
          this.eventBus?.emit?.(EVENTS.MISSION_COMPLETED, {
            missionId: id,
            template: mission.template,
            required: mission.required !== false,
            nowSec: this.elapsedSec
          });
        }
      } else if (mission.template === 'stealthNoise' && mission.state?.failed) {
        if (!this.failedMissionIds.has(id)) {
          this.failedMissionIds.add(id);
          this.eventBus?.emit?.(EVENTS.MISSION_FAILED, {
            missionId: id,
            template: mission.template,
            required: mission.required !== false,
            reason: 'stealthNoise',
            nowSec: this.elapsedSec
          });
        }
      } else if (mission.template === 'noHitRun' && mission.state?.failed) {
        if (!this.failedMissionIds.has(id)) {
          this.failedMissionIds.add(id);
          this.eventBus?.emit?.(EVENTS.MISSION_FAILED, {
            missionId: id,
            template: mission.template,
            required: mission.required !== false,
            reason: 'noHitRun',
            nowSec: this.elapsedSec
          });
        }
      }
    }
  }

  getExitLockedMessage() {
    return this.exitLockMessage || 'Exit locked';
  }

  /**
   * For AutoPilot: return a list of uncompleted interactable objectives.
   * Compatible shape: [{ collected, gridPos:{x,y} }]
   */
  getNextInteractableForMission(mission) {
    if (!mission) return null;
    if (this.isMissionComplete(mission)) return null;

    if (mission.template === 'findKeycard') {
      const gp = mission.state.gridPos;
      return gp ? { id: `keycard:${mission.id}`, gridPos: gp } : null;
    }

    if (mission.template === 'collectEvidence') {
      const need = (mission.state.required || 0) - (mission.state.collected || 0);
      if (need <= 0) return null;
      const items = Array.isArray(mission.state.items) ? mission.state.items : [];
      const next = items.find((i) => i && !i.collected && i.gridPos);
      return next ? { id: next.id || null, gridPos: next.gridPos } : null;
    }

    if (mission.template === 'restorePower') {
      const switches = Array.isArray(mission.state.switches) ? mission.state.switches : [];
      const next = switches.find((s) => s && !s.on && s.gridPos);
      return next ? { id: next.id || null, gridPos: next.gridPos } : null;
    }

    if (mission.template === 'syncActivate') {
      const switches = Array.isArray(mission.state.switches) ? mission.state.switches : [];
      const next = switches.find((s) => s && !s.on && s.gridPos);
      return next ? { id: next.id || null, gridPos: next.gridPos } : null;
    }

    if (mission.template === 'reroutePower') {
      if (mission.state.powered) return null;
      if (!mission.state.clueRead && mission.state.clueId && mission.state.clueGridPos) {
        return { id: mission.state.clueId, gridPos: mission.state.clueGridPos };
      }

      const breakers = Array.isArray(mission.state.breakers) ? mission.state.breakers : [];
      const solutionSlots = Array.isArray(mission.state.solutionSlots) ? mission.state.solutionSlots : [];
      for (const slot of solutionSlots) {
        const br = breakers.find((b) => b && b.slot === slot && !b.on && b.gridPos);
        if (br) return { id: br.id || null, gridPos: br.gridPos };
      }
      const next = breakers.find((b) => b && !b.on && b.gridPos);
      return next ? { id: next.id || null, gridPos: next.gridPos } : null;
    }

    if (mission.template === 'activateShrines') {
      const shrines = Array.isArray(mission.state.shrines) ? mission.state.shrines : [];
      const next = shrines.find((s) => s && !s.on && s.gridPos);
      return next ? { id: next.id || null, gridPos: next.gridPos } : null;
    }

    if (mission.template === 'restorePowerFuses') {
      if (mission.state.powered) return null;
      if (!mission.state.installed) {
        const required = Number(mission.state.fusesRequired) || 0;
        const collected = Number(mission.state.fusesCollected) || 0;
        if (collected < required) {
          const fuses = Array.isArray(mission.state.fuses) ? mission.state.fuses : [];
          const pending = fuses.filter((f) => f && !f.collected && f.gridPos);
          pending.sort((a, b) => String(a.id || '').localeCompare(String(b.id || '')));
          const next = pending[0] || null;
          return next ? { id: next.id || null, gridPos: next.gridPos } : null;
        }
        if (mission.state.panelId && mission.state.panelGridPos) {
          return { id: mission.state.panelId, gridPos: mission.state.panelGridPos };
        }
        return null;
      }

      if (mission.state.panelId && mission.state.panelGridPos) {
        return { id: mission.state.panelId, gridPos: mission.state.panelGridPos };
      }
      return null;
    }

    if (mission.template === 'powerGrid') {
      const branches = Array.isArray(mission.state.branches) ? mission.state.branches : [];
      const required = Number(mission.state.requiredPowered) || branches.length || 0;
      const powered = Number(mission.state.powered) || branches.filter((b) => b?.powered).length;
      mission.state.requiredPowered = required;
      mission.state.powered = powered;
      if (required <= 0 || powered >= required) return null;

      const fuses = Array.isArray(mission.state.fuses) ? mission.state.fuses : [];
      const collected = Number(mission.state.fusesCollected) || fuses.filter((f) => f?.collected).length;
      mission.state.fusesCollected = collected;
      if (collected < required) {
        const pending = fuses.filter((f) => f && !f.collected && f.gridPos);
        pending.sort((a, b) => String(a.id || '').localeCompare(String(b.id || '')));
        const next = pending[0] || null;
        return next ? { id: next.id || null, gridPos: next.gridPos } : null;
      }

      const nextBranch = branches.find((b) => b && !b.powered && b.panelId && b.panelGridPos) || null;
      return nextBranch ? { id: nextBranch.panelId, gridPos: nextBranch.panelGridPos } : null;
    }

    if (mission.template === 'uploadEvidence') {
      if (mission.state.uploaded) return null;
      const required = Number(mission.state.required) || 0;
      const collected = Number(mission.state.collected) || 0;

      if (collected < required) {
        const items = Array.isArray(mission.state.items) ? mission.state.items : [];
        const pending = items.filter((i) => i && !i.collected && i.gridPos);
        pending.sort((a, b) => String(a.id || '').localeCompare(String(b.id || '')));
        const next = pending[0] || null;
        return next ? { id: next.id || null, gridPos: next.gridPos } : null;
      }

      if (mission.state.terminalId && mission.state.terminalGridPos) {
        return { id: mission.state.terminalId, gridPos: mission.state.terminalGridPos };
      }
      return null;
    }

    if (mission.template === 'blackoutZone') {
      const required = Number(mission.state.required) || 0;
      const restored = Number(mission.state.restored) || 0;
      if (required > 0 && restored >= required) return null;
      const zones = Array.isArray(mission.state.zones) ? mission.state.zones : [];
      const next = zones.find((z) => z && !z.restored && z.gridPos);
      return next ? { id: next.id || null, gridPos: next.gridPos } : null;
    }

    if (mission.template === 'surviveInZone') {
      if (mission.state.completed) return null;
      if (mission.state.beaconId && mission.state.beaconGridPos) {
        return { id: mission.state.beaconId, gridPos: mission.state.beaconGridPos };
      }
      return null;
    }

    if (mission.template === 'occupyPoint') {
      if (mission.state.completed) return null;
      if (mission.state.beaconId && mission.state.beaconGridPos) {
        return { id: mission.state.beaconId, gridPos: mission.state.beaconGridPos };
      }
      return null;
    }

    if (mission.template === 'reclaimStolenItem') {
      if (mission.state.recovered) return null;

      if (mission.state.dropped && mission.state.dropId && mission.state.dropGridPos) {
        return { id: mission.state.dropId, gridPos: mission.state.dropGridPos };
      }

      const thiefId = Number(mission.state.thiefMonsterId);
      if (Number.isFinite(thiefId) && thiefId > 0) {
        const monsters = this.monsterManager?.getMonsters ? this.monsterManager.getMonsters() : [];
        const monster = Array.isArray(monsters) ? monsters.find((m) => Number(m?.id) === thiefId) : null;
        const gp = monster?.getGridPosition?.() || monster?.gridPos || null;
        if (gp && Number.isFinite(gp.x) && Number.isFinite(gp.y)) {
          return { id: `monster:${thiefId}`, gridPos: { x: gp.x, y: gp.y } };
        }
      }

      return null;
    }

    if (mission.template === 'hiddenTerminal') {
      if (mission.state.completed) return null;

      const revealTier = clamp(Math.round(mission.state.revealMarkerAtHintTier ?? mission.params?.revealMarkerAtHintTier ?? 99), 0, 99);
      const current = this.getCurrentRequiredMission();
      const isCurrent = current?.id === mission.id && current?.template === mission.template;
      const revealed = revealTier <= 0 || (isCurrent && (this.hintTier || 0) >= revealTier);
      if (!revealed) return null;

      if (mission.state.terminalId && mission.state.terminalGridPos) {
        return { id: mission.state.terminalId, gridPos: mission.state.terminalGridPos };
      }
      return null;
    }

    if (mission.template === 'scanWaypoints') {
      if (mission.state.completed) return null;
      const targets = Array.isArray(mission.state.targets) ? mission.state.targets : [];
      const next = targets.find((t) => t && !t.completed && t.gridPos) || null;
      return next ? { id: next.id || null, gridPos: next.gridPos } : null;
    }

    if (mission.template === 'codeLock') {
      if (mission.state.unlocked) return null;
      const clues = Array.isArray(mission.state.clues) ? mission.state.clues : [];
      const pending = clues.filter((c) => c && !c.collected && c.gridPos);
      pending.sort((a, b) => String(a.id || '').localeCompare(String(b.id || '')));
      const nextClue = pending[0] || null;
      if (nextClue) return { id: nextClue.id || null, gridPos: nextClue.gridPos };

      if (mission.state.codeReady && mission.state.keypadId && mission.state.keypadGridPos) {
        return { id: mission.state.keypadId, gridPos: mission.state.keypadGridPos };
      }
      return null;
    }

    if (mission.template === 'lockedDoor') {
      if (mission.state.unlocked) return null;
      if (!mission.state.keyPicked && mission.state.keyId && mission.state.keyGridPos) {
        return { id: mission.state.keyId, gridPos: mission.state.keyGridPos };
      }
      if (mission.state.doorId && mission.state.doorApproachGridPos) {
        return { id: mission.state.doorId, gridPos: mission.state.doorApproachGridPos };
      }
      if (mission.state.doorId && mission.state.doorGridPos) {
        return { id: mission.state.doorId, gridPos: mission.state.doorGridPos };
      }
      return null;
    }

    if (mission.template === 'doorLockNetwork') {
      const doors = Array.isArray(mission.state.doors) ? mission.state.doors : [];
      const total = Number(mission.state.total) || doors.length || 0;
      const unlocked = Number(mission.state.unlocked) || doors.filter((d) => d?.unlocked).length;
      mission.state.total = total;
      mission.state.unlocked = unlocked;

      if (total <= 0 || unlocked >= total) return null;

      const nextDoor = doors.find((d) => d && !d.unlocked && d.doorApproachGridPos) || doors.find((d) => d && !d.unlocked) || null;
      if (!nextDoor) return null;

      const prereqId = String(nextDoor.requiresMissionId || nextDoor.hintMissionId || '').trim();
      if (prereqId && prereqId !== mission.id) {
        const prereq = this.missions.get(prereqId) || null;
        if (prereq && !this.isMissionComplete(prereq)) {
          const next = this.getNextInteractableForMission(prereq);
          if (next) return next;
        }
      }

      if (nextDoor.id && nextDoor.doorApproachGridPos) {
        return { id: nextDoor.id, gridPos: nextDoor.doorApproachGridPos };
      }
      return null;
    }

    if (mission.template === 'placeItemsAtAltars') {
      if ((mission.state.altarsFilled || 0) >= (mission.state.altarsTotal || 0)) return null;
      const items = Array.isArray(mission.state.items) ? mission.state.items : [];
      const altars = Array.isArray(mission.state.altars) ? mission.state.altars : [];

      if ((mission.state.itemsCollected || 0) < (mission.state.itemsRequired || 0)) {
        const nextItem = items.find((i) => i && !i.collected && i.gridPos);
        return nextItem ? { id: nextItem.id || null, gridPos: nextItem.gridPos } : null;
      }

      const nextAltar = altars.find((a) => a && !a.filled && a.gridPos);
      return nextAltar ? { id: nextAltar.id || null, gridPos: nextAltar.gridPos } : null;
    }

    if (mission.template === 'placeKeysAtLocks') {
      const required = Number(mission.state.required) || 0;
      const keysCollected = Number(mission.state.keysCollected) || 0;
      const locksFilled = Number(mission.state.locksFilled) || 0;
      if (required <= 0 || locksFilled >= required) return null;

      const keys = Array.isArray(mission.state.keys) ? mission.state.keys : [];
      const locks = Array.isArray(mission.state.locks) ? mission.state.locks : [];

      if (keysCollected < required) {
        const nextKey = keys.find((k) => k && !k.collected && k.gridPos);
        return nextKey ? { id: nextKey.id || null, gridPos: nextKey.gridPos } : null;
      }

      const nextLock = locks.find((l) => l && !l.filled && l.gridPos);
      return nextLock ? { id: nextLock.id || null, gridPos: nextLock.gridPos } : null;
    }

    if (mission.template === 'searchRoomTypeN') {
      const targets = Array.isArray(mission.state.targets) ? mission.state.targets : [];
      const next = targets.find((t) => t && !t.searched && t.gridPos);
      return next ? { id: next.id || null, gridPos: next.gridPos } : null;
    }

    if (mission.template === 'searchAndTagRoom') {
      const targets = Array.isArray(mission.state.targets) ? mission.state.targets : [];
      const next = targets.find((t) => t && !t.tagged && t.gridPos);
      return next ? { id: next.id || null, gridPos: next.gridPos } : null;
    }

    if (mission.template === 'photographEvidence') {
      const targets = Array.isArray(mission.state.targets) ? mission.state.targets : [];
      const next = targets.find((t) => t && !(t.completed || t.photographed) && t.gridPos);
      return next ? { id: next.id || null, gridPos: next.gridPos } : null;
    }

    if (mission.template === 'holdToScan') {
      if (mission.state.completed) return null;
      const targets = Array.isArray(mission.state.targets) ? mission.state.targets : [];
      const next = targets.find((t) => t && !t.completed && t.gridPos);
      return next ? { id: next.id || null, gridPos: next.gridPos } : null;
    }

    if (mission.template === 'lureToSensor') {
      if (mission.state.completed) return null;
      const requireLure = mission.state.requireLure !== false;
      const until = Number(mission.state.lureUntilSec) || 0;
      const lureActive = !requireLure || (until > 0 && this.elapsedSec <= until);

      const requiredTriggers = clamp(Math.round(mission.state.requiredTriggers ?? mission.params?.requiredTriggers ?? 1), 1, 12);
      const triggered = clamp(Math.round(mission.state.triggered ?? 0), 0, requiredTriggers);
      mission.state.requiredTriggers = requiredTriggers;
      mission.state.triggered = triggered;

      if (requiredTriggers > 0 && triggered >= requiredTriggers) {
        mission.state.completed = true;
        return null;
      }

      const cooldownUntil = Number(mission.state.cooldownUntilSec) || 0;
      const cooldownRemaining = Math.max(0, cooldownUntil - this.elapsedSec);
      if (cooldownRemaining > 0) return null;

      const requireClear = mission.state.requireClear === undefined
        ? (requiredTriggers > 1)
        : (mission.state.requireClear !== false);
      mission.state.requireClear = requireClear;
      if (requireClear && mission.state.awaitingClear) return null;

      if (!mission.state.armed && mission.state.sensorId && mission.state.sensorGridPos) {
        return { id: mission.state.sensorId, gridPos: mission.state.sensorGridPos };
      }
      if (requireLure && !lureActive && mission.state.lureId && mission.state.lureGridPos) {
        return { id: mission.state.lureId, gridPos: mission.state.lureGridPos };
      }
      return null;
    }

    if (mission.template === 'deliverItemToTerminal') {
      if (mission.state.delivered) return null;
      const required = Number(mission.state.required) || 0;
      const collected = Number(mission.state.collected) || 0;

      if (collected < required) {
        const items = Array.isArray(mission.state.items) ? mission.state.items : [];
        const pending = items.filter((i) => i && !i.collected && i.gridPos);
        pending.sort((a, b) => String(a.id || '').localeCompare(String(b.id || '')));
        const next = pending[0] || null;
        return next ? { id: next.id || null, gridPos: next.gridPos } : null;
      }

      if (mission.state.terminalId && mission.state.terminalGridPos) {
        return { id: mission.state.terminalId, gridPos: mission.state.terminalGridPos };
      }
      return null;
    }

    if (mission.template === 'deliverFragile') {
      if (mission.state.delivered) return null;
      if (mission.state.carrying && mission.state.terminalId && mission.state.terminalGridPos) {
        return { id: mission.state.terminalId, gridPos: mission.state.terminalGridPos };
      }
      if (!mission.state.carrying && mission.state.packageId && mission.state.packageGridPos) {
        return { id: mission.state.packageId, gridPos: mission.state.packageGridPos };
      }
      return null;
    }

    if (mission.template === 'switchSequenceWithClues') {
      if (Array.isArray(mission.state.clues) && !mission.state.sequenceKnown) {
        const pending = mission.state.clues.filter((c) => c && !c.collected && c.gridPos);
        pending.sort((a, b) => (Number(a?.stepIndex) || 0) - (Number(b?.stepIndex) || 0));
        const nextClue = pending[0] || null;
        if (nextClue) return { id: nextClue.id || null, gridPos: nextClue.gridPos };
        mission.state.sequenceKnown = true;
      }
      const seq = Array.isArray(mission.state.sequence) ? mission.state.sequence : [];
      const idx = clamp(Math.round(mission.state.index ?? 0), 0, seq.length);
      if (seq.length < 2 || idx >= seq.length) return null;
      const nextId = seq[idx];
      const sw = Array.isArray(mission.state.switches)
        ? mission.state.switches.find((s) => s && s.id === nextId)
        : null;
      if (sw?.gridPos) return { id: nextId, gridPos: sw.gridPos };
      const entry = this.interactables?.get?.(nextId) || null;
      return entry?.gridPos ? { id: nextId, gridPos: entry.gridPos } : null;
    }

    if (mission.template === 'switchSequence') {
      const seq = Array.isArray(mission.state.sequence) ? mission.state.sequence : [];
      const idx = clamp(Math.round(mission.state.index ?? 0), 0, seq.length);
      if (seq.length < 2 || idx >= seq.length) return null;
      const nextId = seq[idx];
      const sw = Array.isArray(mission.state.switches)
        ? mission.state.switches.find((s) => s && s.id === nextId)
        : null;
      if (sw?.gridPos) return { id: nextId, gridPos: sw.gridPos };
      const entry = this.interactables?.get?.(nextId) || null;
      return entry?.gridPos ? { id: nextId, gridPos: entry.gridPos } : null;
    }

    if (mission.template === 'hideForSeconds') {
      return null;
    }

    if (mission.template === 'hideUntilClear') {
      return null;
    }

    if (mission.template === 'escort') {
      if (mission.state.completed) return null;
      if (!mission.state.started && mission.state.escortId && mission.state.escortGridPos) {
        return { id: mission.state.escortId, gridPos: mission.state.escortGridPos };
      }
      return null;
    }

    if (mission.template === 'escortRescue') {
      if (mission.state.completed) return null;
      if (!mission.state.started && mission.state.escortId && mission.state.escortGridPos) {
        return { id: mission.state.escortId, gridPos: mission.state.escortGridPos };
      }
      return null;
    }

    if (mission.template === 'escortToSafeRoom') {
      if (mission.state.completed) return null;
      if (!mission.state.started && mission.state.escortId && mission.state.escortGridPos) {
        return { id: mission.state.escortId, gridPos: mission.state.escortGridPos };
      }
      return null;
    }

    if (mission.template === 'unlockExit') {
      const gp = this.exitPoint?.getGridPosition?.() || this.worldState?.getExitPoint?.() || null;
      return { id: 'exit', gridPos: gp };
    }

    if (mission.template === 'timedEvac') {
      if (!mission.state.started) return null;
      const gp = this.exitPoint?.getGridPosition?.() || this.worldState?.getExitPoint?.() || null;
      return { id: 'exit', gridPos: gp };
    }

    return null;
  }

  getAutopilotTargets() {
    const targets = [];
    const requires = this.missionsConfig?.exit?.requires || [];
    const requiredIds = Array.isArray(requires) ? requires : [];
    const requiredSet = new Set(requiredIds.map((s) => String(s || '').trim()).filter(Boolean));

    for (const mission of this.missions.values()) {
      if (!mission) continue;
      if (requiredSet.size > 0 && !requiredSet.has(mission.id)) continue;

      if (mission.template === 'findKeycard') {
        if (mission.state.found) continue;
        const gp = mission.state.gridPos;
        if (gp) targets.push({ collected: false, id: `keycard:${mission.id}`, gridPos: gp, missionId: mission.id, template: mission.template });
      } else if (mission.template === 'bossFinale') {
        const phase = Math.max(0, Math.round(Number(mission.state.phase) || 0));
        if (phase <= 1) {
          const boss = this.bossSystem?.getState ? this.bossSystem.getState() : null;
          const tiles = Array.isArray(boss?.nodeTiles) ? boss.nodeTiles : [];
          if (tiles.length > 0) {
            for (const t of tiles) {
              if (!t || !Number.isFinite(t.x) || !Number.isFinite(t.y)) continue;
              targets.push({ collected: false, id: `bossNode:${t.x},${t.y}`, gridPos: { x: t.x, y: t.y }, missionId: mission.id, template: mission.template });
            }
          }
        } else if (phase === 2) {
          const boss = this.bossSystem?.getState ? this.bossSystem.getState() : null;
          const gp = boss?.bossSpawnGrid || null;
          if (gp && Number.isFinite(gp.x) && Number.isFinite(gp.y)) {
            targets.push({ collected: false, id: 'bossCore', gridPos: { x: gp.x, y: gp.y }, missionId: mission.id, template: mission.template });
          }
        }
      } else if (mission.template === 'collectEvidence') {
        const need = (mission.state.required || 0) - (mission.state.collected || 0);
        if (need <= 0) continue;
        const items = Array.isArray(mission.state.items) ? mission.state.items : [];
        for (const item of items) {
          if (item?.collected) continue;
          if (!item?.gridPos) continue;
          targets.push({ collected: false, id: item.id || null, gridPos: item.gridPos, missionId: mission.id, template: mission.template });
        }
      } else if (mission.template === 'restorePower') {
        const switches = Array.isArray(mission.state.switches) ? mission.state.switches : [];
        for (const sw of switches) {
          if (sw?.on) continue;
          if (!sw?.gridPos) continue;
          targets.push({ collected: false, id: sw.id || null, gridPos: sw.gridPos, missionId: mission.id, template: mission.template });
        }
      } else if (mission.template === 'reroutePower') {
        if (mission.state.powered) continue;
        if (!mission.state.clueRead && mission.state.clueId && mission.state.clueGridPos) {
          targets.push({ collected: false, id: mission.state.clueId, gridPos: mission.state.clueGridPos, missionId: mission.id, template: mission.template });
        }
        const breakers = Array.isArray(mission.state.breakers) ? mission.state.breakers : [];
        for (const br of breakers) {
          if (br?.on) continue;
          if (!br?.gridPos) continue;
          targets.push({ collected: false, id: br.id || null, gridPos: br.gridPos, missionId: mission.id, template: mission.template });
        }
      } else if (mission.template === 'activateShrines') {
        const shrines = Array.isArray(mission.state.shrines) ? mission.state.shrines : [];
        for (const shrine of shrines) {
          if (shrine?.on) continue;
          if (!shrine?.gridPos) continue;
          targets.push({ collected: false, id: shrine.id || null, gridPos: shrine.gridPos, missionId: mission.id, template: mission.template });
        }
      } else if (mission.template === 'restorePowerFuses') {
        if (mission.state.powered) continue;
        const required = Number(mission.state.fusesRequired) || 0;
        const collected = Number(mission.state.fusesCollected) || 0;
        const fuses = Array.isArray(mission.state.fuses) ? mission.state.fuses : [];

        if (!mission.state.installed) {
          for (const fuse of fuses) {
            if (!fuse || fuse.collected) continue;
            if (!fuse.gridPos) continue;
            targets.push({ collected: false, id: fuse.id || null, gridPos: fuse.gridPos, missionId: mission.id, template: mission.template });
          }
          if (collected >= required && mission.state.panelGridPos && mission.state.panelId) {
            targets.push({ collected: false, id: mission.state.panelId, gridPos: mission.state.panelGridPos, missionId: mission.id, template: mission.template });
          }
        } else if (!mission.state.powered && mission.state.panelGridPos && mission.state.panelId) {
          targets.push({ collected: false, id: mission.state.panelId, gridPos: mission.state.panelGridPos, missionId: mission.id, template: mission.template });
        }
      } else if (mission.template === 'powerGrid') {
        const branches = Array.isArray(mission.state.branches) ? mission.state.branches : [];
        const requiredPowered = Number(mission.state.requiredPowered) || branches.length || 0;
        const powered = Number(mission.state.powered) || branches.filter((b) => b?.powered).length;
        mission.state.requiredPowered = requiredPowered;
        mission.state.powered = powered;
        if (requiredPowered <= 0 || powered >= requiredPowered) continue;

        const fuses = Array.isArray(mission.state.fuses) ? mission.state.fuses : [];
        const fusesCollected = Number(mission.state.fusesCollected) || fuses.filter((f) => f?.collected).length;
        mission.state.fusesCollected = fusesCollected;

        if (fusesCollected < requiredPowered) {
          for (const fuse of fuses) {
            if (!fuse || fuse.collected) continue;
            if (!fuse.gridPos) continue;
            targets.push({ collected: false, id: fuse.id || null, gridPos: fuse.gridPos, missionId: mission.id, template: mission.template });
          }
        } else {
          for (const br of branches) {
            if (!br || br.powered) continue;
            if (!br.panelGridPos) continue;
            targets.push({ collected: false, id: br.panelId || null, gridPos: br.panelGridPos, missionId: mission.id, template: mission.template });
          }
        }
      } else if (mission.template === 'uploadEvidence') {
        if (mission.state.uploaded) continue;
        const required = Number(mission.state.required) || 0;
        const collected = Number(mission.state.collected) || 0;

        if (collected < required) {
          const items = Array.isArray(mission.state.items) ? mission.state.items : [];
          for (const item of items) {
            if (item?.collected) continue;
            if (!item?.gridPos) continue;
            targets.push({ collected: false, id: item.id || null, gridPos: item.gridPos, missionId: mission.id, template: mission.template });
          }
        } else if (mission.state.terminalGridPos && mission.state.terminalId) {
          targets.push({ collected: false, id: mission.state.terminalId, gridPos: mission.state.terminalGridPos, missionId: mission.id, template: mission.template });
        }
      } else if (mission.template === 'blackoutZone') {
        const required = Number(mission.state.required) || 0;
        const restored = Number(mission.state.restored) || 0;
        if (required > 0 && restored >= required) continue;
        const zones = Array.isArray(mission.state.zones) ? mission.state.zones : [];
        for (const z of zones) {
          if (!z || z.restored) continue;
          if (!z.gridPos) continue;
          targets.push({ collected: false, id: z.id || null, gridPos: z.gridPos, missionId: mission.id, template: mission.template });
        }
      } else if (mission.template === 'surviveInZone' || mission.template === 'occupyPoint') {
        if (mission.state.completed) continue;
        if (mission.state.beaconGridPos && mission.state.beaconId) {
          targets.push({ collected: false, id: mission.state.beaconId, gridPos: mission.state.beaconGridPos, missionId: mission.id, template: mission.template });
        }
      } else if (mission.template === 'codeLock') {
        if (mission.state.unlocked) continue;
        const clues = Array.isArray(mission.state.clues) ? mission.state.clues : [];
        for (const clue of clues) {
          if (!clue || clue.collected) continue;
          if (!clue.gridPos) continue;
          targets.push({ collected: false, id: clue.id || null, gridPos: clue.gridPos, missionId: mission.id, template: mission.template });
        }
        if (mission.state.codeReady && !mission.state.unlocked && mission.state.keypadGridPos && mission.state.keypadId) {
          targets.push({ collected: false, id: mission.state.keypadId, gridPos: mission.state.keypadGridPos, missionId: mission.id, template: mission.template });
        }
      } else if (mission.template === 'lockedDoor') {
        if (mission.state.unlocked) continue;
        if (!mission.state.keyPicked && mission.state.keyId && mission.state.keyGridPos) {
          targets.push({ collected: false, id: mission.state.keyId, gridPos: mission.state.keyGridPos, missionId: mission.id, template: mission.template });
        }
        if (mission.state.keyPicked && mission.state.doorId && mission.state.doorApproachGridPos) {
          targets.push({ collected: false, id: mission.state.doorId, gridPos: mission.state.doorApproachGridPos, missionId: mission.id, template: mission.template });
        }
      } else if (mission.template === 'reclaimStolenItem') {
        if (mission.state.recovered) continue;

        if (mission.state.dropped && mission.state.dropId && mission.state.dropGridPos) {
          targets.push({ collected: false, id: mission.state.dropId, gridPos: mission.state.dropGridPos, missionId: mission.id, template: mission.template });
          continue;
        }

        const thiefId = Number(mission.state.thiefMonsterId);
        if (!(Number.isFinite(thiefId) && thiefId > 0)) continue;

        const monsters = this.monsterManager?.getMonsters ? this.monsterManager.getMonsters() : [];
        const monster = Array.isArray(monsters) ? monsters.find((m) => Number(m?.id) === thiefId) : null;
        const gp = monster?.getGridPosition?.() || monster?.gridPos || null;
        if (!gp || !Number.isFinite(gp.x) || !Number.isFinite(gp.y)) continue;
        targets.push({ collected: false, id: `monster:${thiefId}`, gridPos: { x: gp.x, y: gp.y }, missionId: mission.id, template: mission.template });
      } else if (mission.template === 'hiddenTerminal') {
        if (mission.state.completed) continue;
        const revealTier = clamp(Math.round(mission.state.revealMarkerAtHintTier ?? mission.params?.revealMarkerAtHintTier ?? 99), 0, 99);
        const current = this.getCurrentRequiredMission();
        const isCurrent = current?.id === mission.id && current?.template === mission.template;
        const revealed = revealTier <= 0 || (isCurrent && (this.hintTier || 0) >= revealTier);
        if (!revealed) continue;
        if (mission.state.terminalId && mission.state.terminalGridPos) {
          targets.push({ collected: false, id: mission.state.terminalId, gridPos: mission.state.terminalGridPos, missionId: mission.id, template: mission.template });
        }
      } else if (mission.template === 'doorLockNetwork') {
        const doors = Array.isArray(mission.state.doors) ? mission.state.doors : [];
        const total = Number(mission.state.total) || doors.length || 0;
        const unlocked = Number(mission.state.unlocked) || doors.filter((d) => d?.unlocked).length;
        mission.state.total = total;
        mission.state.unlocked = unlocked;
        if (total <= 0 || unlocked >= total) continue;

        for (const door of doors) {
          if (!door || door.unlocked) continue;
          const gp = door.doorApproachGridPos || null;
          if (!gp) continue;
          targets.push({ collected: false, id: door.id || null, gridPos: gp, missionId: mission.id, template: mission.template });
        }
      } else if (mission.template === 'placeItemsAtAltars') {
        if ((mission.state.altarsFilled || 0) >= (mission.state.altarsTotal || 0)) continue;
        const items = Array.isArray(mission.state.items) ? mission.state.items : [];
        const altars = Array.isArray(mission.state.altars) ? mission.state.altars : [];

        if ((mission.state.itemsCollected || 0) < (mission.state.itemsRequired || 0)) {
          for (const item of items) {
            if (item?.collected) continue;
            if (!item?.gridPos) continue;
            targets.push({ collected: false, id: item.id || null, gridPos: item.gridPos, missionId: mission.id, template: mission.template });
          }
        } else {
          for (const altar of altars) {
            if (altar?.filled) continue;
            if (!altar?.gridPos) continue;
            targets.push({ collected: false, id: altar.id || null, gridPos: altar.gridPos, missionId: mission.id, template: mission.template });
          }
        }
      } else if (mission.template === 'placeKeysAtLocks') {
        const required = Number(mission.state.required) || 0;
        const keysCollected = Number(mission.state.keysCollected) || 0;
        const locksFilled = Number(mission.state.locksFilled) || 0;
        if (required <= 0 || locksFilled >= required) continue;

        const keys = Array.isArray(mission.state.keys) ? mission.state.keys : [];
        const locks = Array.isArray(mission.state.locks) ? mission.state.locks : [];

        if (keysCollected < required) {
          for (const key of keys) {
            if (key?.collected) continue;
            if (!key?.gridPos) continue;
            targets.push({ collected: false, id: key.id || null, gridPos: key.gridPos, missionId: mission.id, template: mission.template });
          }
        } else {
          for (const lock of locks) {
            if (lock?.filled) continue;
            if (!lock?.gridPos) continue;
            targets.push({ collected: false, id: lock.id || null, gridPos: lock.gridPos, missionId: mission.id, template: mission.template });
          }
        }
      } else if (mission.template === 'searchRoomTypeN') {
        if ((mission.state.searched || 0) >= (mission.state.required || 0)) continue;
        const points = Array.isArray(mission.state.targets) ? mission.state.targets : [];
        for (const point of points) {
          if (point?.searched) continue;
          if (!point?.gridPos) continue;
          targets.push({ collected: false, id: point.id || null, gridPos: point.gridPos, missionId: mission.id, template: mission.template });
        }
      } else if (mission.template === 'searchAndTagRoom') {
        if ((mission.state.tagged || 0) >= (mission.state.required || 0)) continue;
        const points = Array.isArray(mission.state.targets) ? mission.state.targets : [];
        for (const point of points) {
          if (point?.tagged) continue;
          if (!point?.gridPos) continue;
          targets.push({ collected: false, id: point.id || null, gridPos: point.gridPos, missionId: mission.id, template: mission.template });
        }
      } else if (mission.template === 'photographEvidence') {
        if ((mission.state.photos || 0) >= (mission.state.required || 0)) continue;
        const points = Array.isArray(mission.state.targets) ? mission.state.targets : [];
        for (const point of points) {
          if (point?.completed || point?.photographed) continue;
          if (!point?.gridPos) continue;
          targets.push({ collected: false, id: point.id || null, gridPos: point.gridPos, missionId: mission.id, template: mission.template });
        }
      } else if (mission.template === 'holdToScan') {
        if (mission.state.completed) continue;
        const points = Array.isArray(mission.state.targets) ? mission.state.targets : [];
        for (const point of points) {
          if (point?.completed) continue;
          if (!point?.gridPos) continue;
          targets.push({ collected: false, id: point.id || null, gridPos: point.gridPos, missionId: mission.id, template: mission.template });
        }
      } else if (mission.template === 'scanWaypoints') {
        if (mission.state.completed) continue;
        const points = Array.isArray(mission.state.targets) ? mission.state.targets : [];
        for (const point of points) {
          if (point?.completed) continue;
          if (!point?.gridPos) continue;
          targets.push({ collected: false, id: point.id || null, gridPos: point.gridPos, missionId: mission.id, template: mission.template });
        }
      } else if (mission.template === 'deliverItemToTerminal') {
        if (mission.state.delivered) continue;
        const required = Number(mission.state.required) || 0;
        const collected = Number(mission.state.collected) || 0;

        if (collected < required) {
          const items = Array.isArray(mission.state.items) ? mission.state.items : [];
          for (const item of items) {
            if (item?.collected) continue;
            if (!item?.gridPos) continue;
            targets.push({ collected: false, id: item.id || null, gridPos: item.gridPos, missionId: mission.id, template: mission.template });
          }
        } else if (mission.state.terminalGridPos && mission.state.terminalId) {
          targets.push({ collected: false, id: mission.state.terminalId, gridPos: mission.state.terminalGridPos, missionId: mission.id, template: mission.template });
        }
      } else if (mission.template === 'deliverFragile') {
        if (mission.state.delivered) continue;
        if (mission.state.carrying) {
          if (mission.state.terminalGridPos && mission.state.terminalId) {
            targets.push({ collected: false, id: mission.state.terminalId, gridPos: mission.state.terminalGridPos, missionId: mission.id, template: mission.template });
          }
        } else if (mission.state.packageGridPos && mission.state.packageId) {
          targets.push({ collected: false, id: mission.state.packageId, gridPos: mission.state.packageGridPos, missionId: mission.id, template: mission.template });
        }
      } else if (mission.template === 'switchSequence') {
        const seq = Array.isArray(mission.state.sequence) ? mission.state.sequence : [];
        const idx = clamp(Math.round(mission.state.index ?? 0), 0, seq.length);
        if (seq.length < 2 || idx >= seq.length) continue;
        const switches = Array.isArray(mission.state.switches) ? mission.state.switches : [];
        for (const sw of switches) {
          if (!sw || sw.on) continue;
          if (!sw.gridPos) continue;
          targets.push({ collected: false, id: sw.id || null, gridPos: sw.gridPos, missionId: mission.id, template: mission.template });
        }
      } else if (mission.template === 'switchSequenceWithClues') {
        const seq = Array.isArray(mission.state.sequence) ? mission.state.sequence : [];
        const idx = clamp(Math.round(mission.state.index ?? 0), 0, seq.length);
        if (seq.length >= 2 && idx >= seq.length) continue;

        if (!mission.state.sequenceKnown) {
          const clues = Array.isArray(mission.state.clues) ? mission.state.clues : [];
          for (const clue of clues) {
            if (!clue || clue.collected) continue;
            if (!clue.gridPos) continue;
            targets.push({ collected: false, id: clue.id || null, gridPos: clue.gridPos, missionId: mission.id, template: mission.template });
          }
        } else {
          const switches = Array.isArray(mission.state.switches) ? mission.state.switches : [];
          for (const sw of switches) {
            if (!sw || sw.on) continue;
            if (!sw.gridPos) continue;
            targets.push({ collected: false, id: sw.id || null, gridPos: sw.gridPos, missionId: mission.id, template: mission.template });
          }
        }
      } else if (mission.template === 'lureToSensor') {
        if (mission.state.completed) continue;
        const requireLure = mission.state.requireLure !== false;
        const until = Number(mission.state.lureUntilSec) || 0;
        const lureActive = !requireLure || (until > 0 && this.elapsedSec <= until);

        const requiredTriggers = clamp(Math.round(mission.state.requiredTriggers ?? mission.params?.requiredTriggers ?? 1), 1, 12);
        const triggered = clamp(Math.round(mission.state.triggered ?? 0), 0, requiredTriggers);
        mission.state.requiredTriggers = requiredTriggers;
        mission.state.triggered = triggered;

        if (requiredTriggers > 0 && triggered >= requiredTriggers) {
          mission.state.completed = true;
          continue;
        }

        const cooldownUntil = Number(mission.state.cooldownUntilSec) || 0;
        const cooldownRemaining = Math.max(0, cooldownUntil - this.elapsedSec);
        if (cooldownRemaining > 0) continue;

        const requireClear = mission.state.requireClear === undefined
          ? (requiredTriggers > 1)
          : (mission.state.requireClear !== false);
        mission.state.requireClear = requireClear;
        if (requireClear && mission.state.awaitingClear) continue;

        if (!mission.state.armed && mission.state.sensorId && mission.state.sensorGridPos) {
          targets.push({ collected: false, id: mission.state.sensorId, gridPos: mission.state.sensorGridPos, missionId: mission.id, template: mission.template });
        } else if (requireLure && !lureActive && mission.state.lureId && mission.state.lureGridPos) {
          targets.push({ collected: false, id: mission.state.lureId, gridPos: mission.state.lureGridPos, missionId: mission.id, template: mission.template });
        }
      } else if (mission.template === 'hideForSeconds') {
        if (mission.state.completed) continue;
        if (this.playerHidden) continue;
        const spots = this.interactables?.list?.() || [];
        for (const entry of spots) {
          if (!entry || entry.enabled === false || entry.collected) continue;
          if (entry.kind !== 'hidingSpot') continue;
          if (!entry.gridPos) continue;
          targets.push({ collected: false, id: entry.id || null, gridPos: entry.gridPos, missionId: mission.id, template: mission.template });
        }
      } else if (mission.template === 'hideUntilClear') {
        if (mission.state.completed) continue;
        if (this.playerHidden) continue;
        const spots = this.interactables?.list?.() || [];
        for (const entry of spots) {
          if (!entry || entry.enabled === false || entry.collected) continue;
          if (entry.kind !== 'hidingSpot') continue;
          if (!entry.gridPos) continue;
          targets.push({ collected: false, id: entry.id || null, gridPos: entry.gridPos, missionId: mission.id, template: mission.template });
        }
      } else if (mission.template === 'escort') {
        if (mission.state.completed) continue;
        if (mission.state.started) continue;
        if (mission.state.escortId && mission.state.escortGridPos) {
          targets.push({ collected: false, id: mission.state.escortId, gridPos: mission.state.escortGridPos, missionId: mission.id, template: mission.template });
        }
      } else if (mission.template === 'escortRescue') {
        if (mission.state.completed) continue;
        if (mission.state.started) continue;
        if (mission.state.escortId && mission.state.escortGridPos) {
          targets.push({ collected: false, id: mission.state.escortId, gridPos: mission.state.escortGridPos, missionId: mission.id, template: mission.template });
        }
      } else if (mission.template === 'escortToSafeRoom') {
        if (mission.state.completed) continue;
        if (mission.state.started) continue;
        if (mission.state.escortId && mission.state.escortGridPos) {
          targets.push({ collected: false, id: mission.state.escortId, gridPos: mission.state.escortGridPos, missionId: mission.id, template: mission.template });
        }
      }
    }
    return targets;
  }

  /**
   * For AutoPilot: state bundle containing objective + targets + exit lock state.
   */
  getAutopilotState() {
    const objectiveText = this.getObjectiveText();
    const objectiveMission = this.getCurrentRequiredMission();
    const next = this.getNextInteractableForMission(objectiveMission);

    const objective = objectiveMission
      ? {
        id: objectiveMission.id,
        template: objectiveMission.template,
        params: deepClone(objectiveMission.params || {}),
        progress: this.getObjectiveProgress(objectiveMission),
        nextInteractId: next?.id || null,
        nextInteractGridPos: next?.gridPos || null,
        objectiveText
      }
      : {
        id: 'exit',
        template: 'exit',
        params: {},
        progress: null,
        nextInteractId: 'exit',
        nextInteractGridPos: this.exitPoint?.getGridPosition?.() || this.worldState?.getExitPoint?.() || null,
        objectiveText
      };

    return {
      exitUnlocked: this.isExitUnlocked(),
      objective,
      targets: this.getAutopilotTargets()
    };
  }
}
