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

  setRefs({ eventBus, worldState, monsterManager, scene, gameState, exitPoint, interactableSystem } = {}) {
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
  }

  dispose() {
    this.clear();
  }

  clear() {
    this.unsubs.forEach((fn) => fn?.());
    this.unsubs = [];

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

    if (template === 'uploadEvidence') {
      mission.state.collected = 0;
      mission.state.required = 0;
      mission.state.total = 0;
      mission.state.items = [];
      mission.state.uploaded = true;
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

    if (template === 'lockedDoor') {
      mission.state.unlocked = true;
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

    if (template === 'searchRoomTypeN') {
      mission.state.searched = 0;
      mission.state.required = 0;
      mission.state.targets = [];
      return;
    }

    if (template === 'photographEvidence') {
      mission.state.photos = 0;
      mission.state.required = 0;
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
      bus.on(EVENTS.PLAYER_DAMAGED, (payload) => this.onPlayerDamaged(payload))
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
      } else if (template === 'uploadEvidence') {
        const total = clamp(Math.round(mission.params.count ?? 3), 1, 999);
        const required = clamp(Math.round(mission.params.required ?? total), 1, total);
        mission.state = {
          collected: 0,
          required,
          total,
          uploaded: false,
          items: [],
          terminalId: null,
          terminalGridPos: null
        };
        this.spawnUploadEvidence(mission, { avoid: [spawn, exit] });
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
      } else if (template === 'photographEvidence') {
        const required = clamp(Math.round(mission.params.count ?? 3), 1, 24);
        mission.state = { photos: 0, required, targets: [] };
        this.spawnPhotographEvidence(mission, { avoid: [spawn, exit] });
      } else if (template === 'holdToScan') {
        const count = clamp(Math.round(mission.params.count ?? 1), 1, 24);
        const seconds = clamp(Math.round(mission.params.seconds ?? mission.params.holdSeconds ?? 5), 2, 120);
        mission.state = { required: count, scanned: 0, seconds, targets: [], completed: false };
        this.spawnHoldToScan(mission, { avoid: [spawn, exit] });
      } else if (template === 'lureToSensor') {
        const lureSeconds = clamp(Math.round(mission.params.lureSeconds ?? mission.params.seconds ?? 10), 3, 120);
        mission.state = {
          armed: false,
          completed: false,
          requireLure: mission.params.requireLure !== false,
          lureSeconds,
          lureUntilSec: 0,
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
      } else if (template === 'surviveTimer') {
        const seconds = clamp(Math.round(mission.params.seconds ?? 60), 5, 3600);
        mission.state = { seconds, completed: false };
      } else if (template === 'surviveNoDamage') {
        const seconds = clamp(Math.round(mission.params.seconds ?? 20), 5, 3600);
        mission.state = { seconds, lastDamagedAtSec: 0, completed: false, hits: 0 };
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
      } else if (template === 'unlockExit') {
        mission.state = { unlocked: false };
      } else if (template === 'stealthNoise') {
        const seconds = clamp(Math.round(mission.params.seconds ?? 20), 5, 3600);
        const resetOnGunshot = mission.params.resetOnGunshot !== false;
        const maxGunshotsTotal = toFinite(mission.params.maxGunshotsTotal, null);
        mission.state = {
          seconds,
          resetOnGunshot,
          maxGunshotsTotal,
          gunshots: 0,
          lastNoiseAtSec: 0,
          completed: false
        };
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

    const label = 'Upload Terminal';
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
          if (mission.state.uploaded) return 'E: Terminal (Uploaded)';
          if (requiresPower) {
            const q = { itemId: powerItemId, result: null };
            this.eventBus?.emit?.(EVENTS.INVENTORY_QUERY_ITEM, q);
            const havePower = Number(q.result?.count) || 0;
            if (havePower <= 0) return 'E: Terminal (No Power)';
          }
          const missing = Math.max(0, (mission.state.required || 0) - (mission.state.collected || 0));
          if (missing > 0) return `E: Terminal (Need ${missing} evidence)`;
          return 'E: Upload Evidence';
        },
        interact: ({ entry }) => {
          if (mission.state.uploaded) {
            if (entry) {
              entry.requiresItem = [];
              entry.consumeItem = [];
            }
            return { ok: true, message: 'Already uploaded', state: { uploaded: true } };
          }

          const meta = entry?.meta || {};
          meta.uploaded = true;
          if (entry) {
            entry.requiresItem = [];
            entry.consumeItem = [];
          }
          setTerminalState(terminalObject, { uploaded: true });
          return { ok: true, message: 'Evidence uploaded', state: { uploaded: true } };
        },
        meta: { missionId: mission.id, template: mission.template, uploaded: false }
      })
    );
    this.interactableMeta.set(terminalId, { missionId: mission.id, template: mission.template });
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
          prompt: () => `E: ${label}`,
          interact: () => ({ ok: true, picked: true, message: 'Photo captured' }),
          meta: {
            missionId: mission.id,
            template: mission.template,
            index: i,
            aimMinDot,
            aimOffsetY,
            aimHint: 'Keep the target centered'
          }
        })
      );
      this.interactableMeta.set(interactableId, { missionId: mission.id, template: mission.template, index: i });
      mission.state.targets.push({ id: interactableId, gridPos: { x: pos.x, y: pos.y }, photographed: false });
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
          this.eventBus?.emit?.(EVENTS.NOISE_EMITTED, { source: 'player', kind: 'lure', strength: 0.7 });
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

  onKeypadCodeSubmitted(payload) {
    const keypadId = String(payload?.keypadId || '').trim();
    if (!keypadId) return;

    const meta = this.interactableMeta.get(keypadId);
    if (!meta) return;

    const mission = this.missions.get(meta.missionId);
    if (!mission || mission.template !== 'codeLock') return;

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
      this.eventBus?.emit?.(EVENTS.KEYPAD_CODE_RESULT, { actorKind, keypadId, ok: true, code: submitted });
      this.syncStatus();
      return;
    }

    mission.state.failedAttempts = (mission.state.failedAttempts || 0) + 1;
    if (actorKind === 'player') {
      this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'Incorrect code.', seconds: 1.6 });
      this.eventBus?.emit?.(EVENTS.NOISE_EMITTED, { source: 'player', kind: 'keypad', strength: 0.25 });
    }
    this.eventBus?.emit?.(EVENTS.KEYPAD_CODE_RESULT, { actorKind, keypadId, ok: false, code: submitted, message: 'Incorrect' });
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
        if (t && !t.photographed) t.photographed = true;
      }
      const photos = targets.filter((t) => t?.photographed).length;
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
    } else if (mission.template === 'uploadEvidence') {
      if (payload?.kind === 'terminal') {
        const uploaded = !!payload?.result?.state?.uploaded;
        if (uploaded && !mission.state.uploaded) {
          mission.state.uploaded = true;
          this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'Evidence uploaded.', seconds: 1.8 });
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
    } else if (mission.template === 'escort') {
      if (payload?.kind === 'escortBuddy') {
        const started = !!payload?.result?.state?.started;
        if (started && !mission.state.started) {
          mission.state.started = true;
          const entry = this.interactables?.get?.(id) || null;
          if (entry) entry.enabled = false;
          this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'Escort started. Lead them to the exit.', seconds: 2.0 });
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
    void payload;

    for (const mission of this.missions.values()) {
      if (!mission) continue;
      if (mission.template !== 'killCount') continue;
      if (this.isMissionComplete(mission)) continue;

      mission.state.killed = Math.min(mission.state.required || 1, (mission.state.killed || 0) + 1);
    }

    this.syncStatus();
  }

  onPlayerDamaged(payload) {
    void payload;

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

    this.syncStatus();
  }

  onNoiseEmitted(payload) {
    const source = payload?.source;
    if (source !== 'player') return;

    const kind = String(payload?.kind || '').toLowerCase();

    const nowSec = this.gameState?.getElapsedTime
      ? this.gameState.getElapsedTime()
      : this.elapsedSec;

    for (const mission of this.missions.values()) {
      if (!mission) continue;
      if (mission.template !== 'stealthNoise') continue;
      if (this.isMissionComplete(mission)) continue;

      const isGunshot = kind.includes('gun') || kind.includes('shot');
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
        // Soft fail: keep it locked and show the objective text; does not auto-lose.
        mission.state.failed = true;
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
        hintText = tier === 1
          ? 'Stay quiet until the timer completes.'
          : tier === 2
            ? 'Do not shoot; footsteps also reset the timer.'
            : 'Stop moving and wait—any noise will restart the countdown.';
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
          ? 'Aim at the target and press E to take a photo.'
          : tier === 2
            ? 'Get close enough and keep the target centered.'
            : 'If you cannot interact, try stepping closer or clearing line of sight.';
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

    for (const mission of this.missions.values()) {
      if (!mission) continue;
      if (mission.template !== 'stealthNoise') continue;
      if (mission.state.completed) continue;
      if (mission.state.failed) continue;

      const start = Number.isFinite(mission.state.lastNoiseAtSec) ? mission.state.lastNoiseAtSec : 0;
      const seconds = mission.state.seconds || 0;
      if (seconds <= 0) continue;

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
      const tileSize = CONFIG.TILE_SIZE || 1;
      const camDir = new THREE.Vector3();
      const targetWorld = new THREE.Vector3();
      const toTarget = new THREE.Vector3();

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
        const lureSeconds = clamp(Math.round(mission.state.lureSeconds ?? mission.params.lureSeconds ?? 10), 3, 120);
        const requireLure = mission.state.requireLure !== false;
        const until = Number(mission.state.lureUntilSec) || 0;
        const lureActive = !requireLure || (until > 0 && this.elapsedSec <= until);

        if (requireLure && until > 0 && this.elapsedSec > until) {
          mission.state.lureUntilSec = 0;
          const lureEntry = mission.state.lureId ? (this.interactables?.get?.(mission.state.lureId) || null) : null;
          if (lureEntry?.meta) lureEntry.meta.active = false;
          if (lureEntry?.object3d) setPowerSwitchState(lureEntry.object3d, false);
        }

        if (sensorGridPos && Number.isFinite(sensorGridPos.x) && Number.isFinite(sensorGridPos.y)) {
          const sensorEntry = mission.state.sensorId ? (this.interactables?.get?.(mission.state.sensorId) || null) : null;
          const stage = !mission.state.armed
            ? 'arm'
            : (requireLure && !lureActive ? 'trigger' : 'wait');

          if (sensorEntry?.object3d) {
            setSensorState(sensorEntry.object3d, { armed: !!mission.state.armed, active: stage === 'wait' && lureActive, success: false });
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
              mission.state.completed = true;
              if (sensorEntry?.object3d) {
                setSensorState(sensorEntry.object3d, { armed: true, active: false, success: true });
              }
              this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'Sensor triggered.', seconds: 1.8 });

              const lureEntry = mission.state.lureId ? (this.interactables?.get?.(mission.state.lureId) || null) : null;
              if (lureEntry?.object3d) setPowerSwitchState(lureEntry.object3d, false);
              mission.state.lureUntilSec = 0;
            }
          } else if (stage === 'trigger' && requireLure && until <= 0 && mission.state.armed) {
            // Keep the lure device visually off until triggered.
            const lureEntry = mission.state.lureId ? (this.interactables?.get?.(mission.state.lureId) || null) : null;
            if (lureEntry?.object3d) setPowerSwitchState(lureEntry.object3d, false);
            if (lureEntry?.meta) lureEntry.meta.active = false;
            mission.state.lureSeconds = lureSeconds;
          }
        }
      }

      for (const mission of this.missions.values()) {
        if (!mission) continue;
        if (mission.template !== 'escort') continue;
        if (mission.state.completed) continue;
        if (!mission.state.started) continue;

        const goal = mission.state.goalGridPos || null;
        const escortGridPos = mission.state.escortGridPos || null;
        if (!goal || !escortGridPos) continue;

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
          this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'Escort complete.', seconds: 1.8 });
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
    if (mission.template === 'reroutePower') {
      return !!mission.state.powered;
    }
    if (mission.template === 'activateShrines') {
      return (mission.state.activated?.size || 0) >= (mission.state.total || 0);
    }
    if (mission.template === 'restorePowerFuses') {
      return !!mission.state.powered;
    }
    if (mission.template === 'uploadEvidence') {
      return !!mission.state.uploaded;
    }
    if (mission.template === 'surviveTimer') {
      return !!mission.state.completed;
    }
    if (mission.template === 'surviveNoDamage') {
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
    if (mission.template === 'unlockExit') {
      return !!mission.state.unlocked;
    }
    if (mission.template === 'lockedDoor') {
      return !!mission.state.unlocked;
    }
    if (mission.template === 'placeItemsAtAltars') {
      return (mission.state.altarsFilled || 0) >= (mission.state.altarsTotal || 0);
    }
    if (mission.template === 'searchRoomTypeN') {
      return (mission.state.searched || 0) >= (mission.state.required || 0);
    }
    if (mission.template === 'photographEvidence') {
      return (mission.state.photos || 0) >= (mission.state.required || 0);
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
    if (mission.template === 'stealthNoise') {
      return !!mission.state.completed;
    }
    if (mission.template === 'lureToSensor') {
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
      if (mission.template === 'uploadEvidence') {
        const required = Number(mission.state.required) || 0;
        const collected = Number(mission.state.collected) || 0;
        if (!mission.state.uploaded) {
          if (required > 0 && collected < required) {
            return `Collect evidence (${collected}/${required})`;
          }
          return 'Upload evidence at the terminal (E)';
        }
        return 'Evidence uploaded. Reach the exit.';
      }
      if (mission.template === 'surviveTimer') {
        const remaining = Math.max(0, (mission.state.seconds || 0) - this.elapsedSec);
        const remainingSec = Math.ceil(remaining);
        return remaining > 0 ? `Survive (${remainingSec}s)` : 'Survive (done)';
      }
      if (mission.template === 'surviveNoDamage') {
        const start = Number.isFinite(mission.state.lastDamagedAtSec) ? mission.state.lastDamagedAtSec : 0;
        const remaining = Math.max(0, (mission.state.seconds || 0) - (this.elapsedSec - start));
        const remainingSec = Math.ceil(remaining);
        return remaining > 0 ? `Avoid damage (${remainingSec}s)` : 'Avoid damage (done)';
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
      if (mission.template === 'unlockExit') {
        return mission.state.unlocked ? 'Exit unlocked. Reach the exit.' : 'Unlock the exit (press E at the exit)';
      }
      if (mission.template === 'lockedDoor') {
        return mission.state.unlocked ? 'Door unlocked.' : 'Find a key and unlock the door';
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
      if (mission.template === 'searchRoomTypeN') {
        return `Search rooms (${mission.state.searched || 0}/${mission.state.required || 0})`;
      }
      if (mission.template === 'photographEvidence') {
        return `Photograph evidence (${mission.state.photos || 0}/${mission.state.required || 0})`;
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
      if (mission.template === 'stealthNoise') {
        if (mission.state.failed) return 'Stay quiet (failed)';
        const start = Number.isFinite(mission.state.lastNoiseAtSec) ? mission.state.lastNoiseAtSec : 0;
        const remaining = Math.max(0, (mission.state.seconds || 0) - (this.elapsedSec - start));
        const remainingSec = Math.ceil(remaining);
        return remaining > 0 ? `Stay quiet (${remainingSec}s)` : 'Stay quiet (done)';
      }
      if (mission.template === 'lureToSensor') {
        if (mission.state.completed) return 'Sensor triggered. Reach the exit.';
        if (!mission.state.armed) return 'Arm the sensor (E)';
        const requireLure = mission.state.requireLure !== false;
        const until = Number(mission.state.lureUntilSec) || 0;
        const remaining = Math.max(0, until - this.elapsedSec);
        if (requireLure && remaining <= 0) return 'Trigger the lure device (E)';
        return remaining > 0 ? `Lure a monster to the sensor (${Math.ceil(remaining)}s)` : 'Lure a monster to the sensor';
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
    if (mission.template === 'uploadEvidence') {
      return {
        collected: mission.state.collected || 0,
        required: mission.state.required || 0,
        total: mission.state.total || 0,
        uploaded: !!mission.state.uploaded,
        terminalId: mission.state.terminalId || null,
        terminalGridPos: mission.state.terminalGridPos || null
      };
    }
    if (mission.template === 'surviveTimer') {
      const remaining = Math.max(0, (mission.state.seconds || 0) - this.elapsedSec);
      return { seconds: mission.state.seconds || 0, remaining, completed: !!mission.state.completed };
    }
    if (mission.template === 'surviveNoDamage') {
      const start = Number.isFinite(mission.state.lastDamagedAtSec) ? mission.state.lastDamagedAtSec : 0;
      const remaining = Math.max(0, (mission.state.seconds || 0) - (this.elapsedSec - start));
      return { seconds: mission.state.seconds || 0, remaining, hits: mission.state.hits || 0, completed: !!mission.state.completed };
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
    if (mission.template === 'unlockExit') {
      return { unlocked: !!mission.state.unlocked };
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
    if (mission.template === 'placeItemsAtAltars') {
      return {
        itemId: mission.state.itemId || null,
        itemsCollected: mission.state.itemsCollected || 0,
        itemsRequired: mission.state.itemsRequired || 0,
        altarsFilled: mission.state.altarsFilled || 0,
        altarsTotal: mission.state.altarsTotal || 0
      };
    }
    if (mission.template === 'searchRoomTypeN') {
      return {
        searched: mission.state.searched || 0,
        required: mission.state.required || 0,
        targetsTotal: Array.isArray(mission.state.targets) ? mission.state.targets.length : 0
      };
    }
    if (mission.template === 'photographEvidence') {
      return {
        photos: mission.state.photos || 0,
        required: mission.state.required || 0,
        targetsTotal: Array.isArray(mission.state.targets) ? mission.state.targets.length : 0
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
    if (mission.template === 'stealthNoise') {
      const start = Number.isFinite(mission.state.lastNoiseAtSec) ? mission.state.lastNoiseAtSec : 0;
      const remaining = Math.max(0, (mission.state.seconds || 0) - (this.elapsedSec - start));
      return {
        seconds: mission.state.seconds || 0,
        remaining,
        gunshots: mission.state.gunshots || 0,
        failed: !!mission.state.failed,
        completed: !!mission.state.completed
      };
    }
    if (mission.template === 'lureToSensor') {
      const requireLure = mission.state.requireLure !== false;
      const until = Number(mission.state.lureUntilSec) || 0;
      const lureRemaining = Math.max(0, until - this.elapsedSec);
      const lureActive = !requireLure || (until > 0 && lureRemaining > 0);
      const stage = mission.state.completed
        ? 'completed'
        : (!mission.state.armed
          ? 'arm'
          : (requireLure && !lureActive ? 'trigger' : 'wait'));
      return {
        stage,
        armed: !!mission.state.armed,
        requireLure,
        lureRemaining,
        lureActive,
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

    if (mission.template === 'searchRoomTypeN') {
      const targets = Array.isArray(mission.state.targets) ? mission.state.targets : [];
      const next = targets.find((t) => t && !t.searched && t.gridPos);
      return next ? { id: next.id || null, gridPos: next.gridPos } : null;
    }

    if (mission.template === 'photographEvidence') {
      const targets = Array.isArray(mission.state.targets) ? mission.state.targets : [];
      const next = targets.find((t) => t && !t.photographed && t.gridPos);
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

    if (mission.template === 'unlockExit') {
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
      } else if (mission.template === 'searchRoomTypeN') {
        if ((mission.state.searched || 0) >= (mission.state.required || 0)) continue;
        const points = Array.isArray(mission.state.targets) ? mission.state.targets : [];
        for (const point of points) {
          if (point?.searched) continue;
          if (!point?.gridPos) continue;
          targets.push({ collected: false, id: point.id || null, gridPos: point.gridPos, missionId: mission.id, template: mission.template });
        }
      } else if (mission.template === 'photographEvidence') {
        if ((mission.state.photos || 0) >= (mission.state.required || 0)) continue;
        const points = Array.isArray(mission.state.targets) ? mission.state.targets : [];
        for (const point of points) {
          if (point?.photographed) continue;
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

        if (!mission.state.armed && mission.state.sensorId && mission.state.sensorGridPos) {
          targets.push({ collected: false, id: mission.state.sensorId, gridPos: mission.state.sensorGridPos, missionId: mission.id, template: mission.template });
        } else if (requireLure && !lureActive && mission.state.lureId && mission.state.lureGridPos) {
          targets.push({ collected: false, id: mission.state.lureId, gridPos: mission.state.lureGridPos, missionId: mission.id, template: mission.template });
        } else if (mission.state.sensorId && mission.state.sensorGridPos) {
          targets.push({ collected: false, id: mission.state.sensorId, gridPos: mission.state.sensorGridPos, missionId: mission.id, template: mission.template });
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
