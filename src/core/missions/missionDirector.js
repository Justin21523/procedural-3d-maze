import * as THREE from 'three';
import { EVENTS } from '../events.js';
import { CONFIG } from '../config.js';
import { normalizeMissionsConfig } from './missionTemplates.js';
import { pickDistinctTiles, gridToWorldCenter, manhattan } from './missionUtils.js';
import {
  createKeycardObject,
  createEvidenceObject,
  createPowerSwitchObject,
  setPowerSwitchState,
  createClueNoteObject,
  createKeypadObject,
  setKeypadState,
  createFuseObject,
  createFusePanelObject,
  setFusePanelState,
  createTerminalObject,
  setTerminalState
} from './missionObjects.js';
import { ROOM_CONFIGS } from '../../world/tileTypes.js';

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

export class MissionDirector {
  constructor(options = {}) {
    this.eventBus = options.eventBus || null;
    this.worldState = options.worldState || null;
    this.scene = options.scene || null;
    this.gameState = options.gameState || null;
    this.exitPoint = options.exitPoint || null;
    this.interactables = options.interactableSystem || null;

    this.levelConfig = null;
    this.missionsConfig = null;

    this.missions = new Map(); // id -> mission
    this.interactableMeta = new Map(); // interactableId -> { missionId, template, index }
    this.registeredIds = [];
    this.spawnedObjects = [];

    this.elapsedSec = 0;
    this.lastStatusKey = '';
    this.exitUnlocked = true;
    this.exitLockMessage = '';

    this.hintTier = 0;
    this.hintObjectiveKey = '';

    this.completedMissionIds = new Set();
    this.failedMissionIds = new Set();

    this.unsubs = [];
  }

  setRefs({ eventBus, worldState, scene, gameState, exitPoint, interactableSystem } = {}) {
    if (eventBus) this.eventBus = eventBus;
    if (worldState) this.worldState = worldState;
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
    this.elapsedSec = 0;
    this.exitUnlocked = true;
    this.exitLockMessage = '';
    this.lastStatusKey = '';
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

    this.spawnFromConfig(this.missionsConfig);
    this.bindEvents();
    this.syncStatus(true);
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
      } else if (template === 'surviveTimer') {
        const seconds = clamp(Math.round(mission.params.seconds ?? 60), 5, 3600);
        mission.state = { seconds, completed: false };
      } else if (template === 'enterRoomType') {
        const required = clamp(Math.round(mission.params.count ?? 1), 1, 999);
        const roomTypes = normalizeRoomTypes(mission.params.roomTypes) || null;
        mission.state = { entered: 0, required, roomTypes };
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
    if (tiles.length === 0) return;

    const pos = tiles[0];
    const object3d = createKeycardObject();
    const world = gridToWorldCenter(pos);
    object3d.position.set(world.x, 0, world.z);

    this.scene.add(object3d);
    this.spawnedObjects.push(object3d);

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

    const tiles = pickDistinctTiles(ws, mission.state.total, {
      allowedRoomTypes,
      minDistFrom: avoid,
      minDist: mission.params.minDistFromSpawn ?? 6,
      margin: 1
    });
    if (tiles.length === 0) return;

    mission.state.items = [];

    for (let i = 0; i < tiles.length; i++) {
      const pos = tiles[i];
      const object3d = createEvidenceObject();
      const world = gridToWorldCenter(pos);
      object3d.position.set(world.x, 0, world.z);
      object3d.rotation.y = Math.random() * Math.PI * 2;

      this.scene.add(object3d);
      this.spawnedObjects.push(object3d);

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
  }

  spawnPowerSwitches(mission, options = {}) {
    const ws = this.worldState;
    const avoid = Array.isArray(options.avoid) ? options.avoid.filter(Boolean) : [];
    const allowedRoomTypes = Array.isArray(mission.params.roomTypes) ? mission.params.roomTypes : null;

    const tiles = pickDistinctTiles(ws, mission.state.total, {
      allowedRoomTypes,
      minDistFrom: avoid,
      minDist: mission.params.minDistFromSpawn ?? 6,
      margin: 1
    });
    if (tiles.length === 0) return;

    mission.state.switches = [];

    for (let i = 0; i < tiles.length; i++) {
      const pos = tiles[i];
      const object3d = createPowerSwitchObject(false);
      const world = gridToWorldCenter(pos);
      object3d.position.set(world.x, 0, world.z);

      this.scene.add(object3d);
      this.spawnedObjects.push(object3d);

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

    const fusesRequired = clamp(Math.round(mission.state.fusesRequired ?? mission.params.fuses ?? 3), 1, 12);
    mission.state.fusesRequired = fusesRequired;

    const fuseTiles = pickDistinctTiles(ws, fusesRequired, {
      allowedRoomTypes: fuseRoomTypes,
      minDistFrom: avoid,
      minDist: mission.params.minDistFromSpawn ?? 7,
      margin: 1
    });
    if (fuseTiles.length === 0) return;
    mission.state.fusesRequired = fuseTiles.length;

    mission.state.fuses = [];

    for (let i = 0; i < fuseTiles.length; i++) {
      const pos = fuseTiles[i];
      const object3d = createFuseObject();
      const world = gridToWorldCenter(pos);
      object3d.position.set(world.x, 0, world.z);

      this.scene.add(object3d);
      this.spawnedObjects.push(object3d);

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

    const avoidForPanel = avoid.concat(fuseTiles);
    const panelTiles = pickDistinctTiles(ws, 1, {
      allowedRoomTypes: panelRoomTypes,
      minDistFrom: avoidForPanel,
      minDist: mission.params.minDistFromSpawn ?? 7,
      margin: 1
    });
    if (panelTiles.length === 0) return;

    const panelPos = panelTiles[0];
    const panelObject = createFusePanelObject({ installed: false, powered: false });
    const panelWorld = gridToWorldCenter(panelPos);
    panelObject.position.set(panelWorld.x, 0, panelWorld.z);
    this.scene.add(panelObject);
    this.spawnedObjects.push(panelObject);

    const panelId = `panel:${mission.id}`;
    mission.state.panelId = panelId;
    mission.state.panelGridPos = { x: panelPos.x, y: panelPos.y };

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

    const tiles = pickDistinctTiles(ws, mission.state.total, {
      allowedRoomTypes: evidenceRoomTypes,
      minDistFrom: avoid,
      minDist: mission.params.minDistFromSpawn ?? 6,
      margin: 1
    });
    if (tiles.length === 0) return;
    mission.state.total = tiles.length;
    mission.state.required = clamp(Math.round(mission.state.required ?? mission.state.total), 1, mission.state.total);

    mission.state.items = [];

    for (let i = 0; i < tiles.length; i++) {
      const pos = tiles[i];
      const object3d = createEvidenceObject();
      const world = gridToWorldCenter(pos);
      object3d.position.set(world.x, 0, world.z);
      object3d.rotation.y = Math.random() * Math.PI * 2;

      this.scene.add(object3d);
      this.spawnedObjects.push(object3d);

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

    const avoidForTerminal = avoid.concat(tiles);
    const terminalTiles = pickDistinctTiles(ws, 1, {
      allowedRoomTypes: terminalRoomTypes,
      minDistFrom: avoidForTerminal,
      minDist: mission.params.minDistFromSpawn ?? 7,
      margin: 1
    });
    if (terminalTiles.length === 0) return;

    const terminalPos = terminalTiles[0];
    const terminalObject = createTerminalObject({ uploaded: false });
    const terminalWorld = gridToWorldCenter(terminalPos);
    terminalObject.position.set(terminalWorld.x, 0, terminalWorld.z);
    this.scene.add(terminalObject);
    this.spawnedObjects.push(terminalObject);

    const terminalId = `terminal:${mission.id}`;
    mission.state.terminalId = terminalId;
    mission.state.terminalGridPos = { x: terminalPos.x, y: terminalPos.y };

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
        consumeItem: { itemId, count: mission.state.required || 0 },
        prompt: () => {
          if (mission.state.uploaded) return 'E: Terminal (Uploaded)';
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

    let clueCount = clamp(Math.round(mission.state.cluesTotal ?? 3), 2, 6);

    const clueTiles = pickDistinctTiles(ws, clueCount, {
      allowedRoomTypes: clueRoomTypes,
      minDistFrom: avoid,
      minDist: mission.params.minDistFromSpawn ?? 7,
      margin: 1
    });
    if (clueTiles.length === 0) return;
    clueCount = clueTiles.length;
    mission.state.cluesTotal = clueCount;

    const avoidForKeypad = avoid.concat(clueTiles);
    const keypadTiles = pickDistinctTiles(ws, 1, {
      allowedRoomTypes: keypadRoomTypes,
      minDistFrom: avoidForKeypad,
      minDist: mission.params.minDistFromSpawn ?? 7,
      margin: 1
    });
    if (keypadTiles.length === 0) return;

    const digits = shuffleInPlace(Array.from({ length: 10 }, (_, i) => i)).slice(0, clueCount);

    mission.state.clues = [];

    for (let i = 0; i < clueTiles.length; i++) {
      const pos = clueTiles[i];
      const slot = toSlotLabel(i);
      const digit = digits[i] ?? Math.floor(Math.random() * 10);

      const object3d = createClueNoteObject(slot);
      const world = gridToWorldCenter(pos);
      object3d.position.set(world.x, 0, world.z);

      this.scene.add(object3d);
      this.spawnedObjects.push(object3d);

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

    const keypadPos = keypadTiles[0];
    const keypadObject = createKeypadObject(false);
    const keypadWorld = gridToWorldCenter(keypadPos);
    keypadObject.position.set(keypadWorld.x, 0, keypadWorld.z);
    this.scene.add(keypadObject);
    this.spawnedObjects.push(keypadObject);

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
    } else if (mission.template === 'codeLock') {
      if (payload?.kind === 'keypad') {
        const unlocked = !!payload?.result?.state?.unlocked;
        if (unlocked) {
          mission.state.unlocked = true;
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
    if (mission.template === 'restorePowerFuses') {
      return !!mission.state.powered;
    }
    if (mission.template === 'uploadEvidence') {
      return !!mission.state.uploaded;
    }
    if (mission.template === 'surviveTimer') {
      return !!mission.state.completed;
    }
    if (mission.template === 'enterRoomType') {
      return (mission.state.entered || 0) >= (mission.state.required || 0);
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
    if (mission.template === 'stealthNoise') {
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
    for (const id of requiredIds) {
      const mission = this.missions.get(id);
      if (!mission) continue;
      if (!this.isMissionComplete(mission)) return mission;
    }
    return null;
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
        return remaining > 0 ? `Survive (${remaining}s)` : 'Survive (done)';
      }
      if (mission.template === 'enterRoomType') {
        const roomLabel = formatRoomTypeList(mission.state.roomTypes);
        return `Enter ${roomLabel} (${mission.state.entered || 0}/${mission.state.required || 0})`;
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
      if (mission.template === 'stealthNoise') {
        if (mission.state.failed) return 'Stay quiet (failed)';
        const start = Number.isFinite(mission.state.lastNoiseAtSec) ? mission.state.lastNoiseAtSec : 0;
        const remaining = Math.max(0, (mission.state.seconds || 0) - (this.elapsedSec - start));
        return remaining > 0 ? `Stay quiet (${remaining}s)` : 'Stay quiet (done)';
      }
      return mission.id;
    };

    for (const id of requiredIds) {
      const mission = this.missions.get(id);
      if (!mission) continue;
      if (!this.isMissionComplete(mission)) {
        return formatMission(mission);
      }
    }

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
    if (mission.template === 'enterRoomType') {
      return {
        entered: mission.state.entered || 0,
        required: mission.state.required || 0,
        roomTypes: normalizeRoomTypes(mission.state.roomTypes) || []
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
