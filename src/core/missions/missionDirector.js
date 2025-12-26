import * as THREE from 'three';
import { EVENTS } from '../events.js';
import { CONFIG } from '../config.js';
import { normalizeMissionsConfig } from './missionTemplates.js';
import { pickDistinctTiles, gridToWorldCenter, manhattan } from './missionUtils.js';
import { createKeycardObject, createEvidenceObject, createPowerSwitchObject, setPowerSwitchState } from './missionObjects.js';
import { ROOM_CONFIGS } from '../../world/tileTypes.js';

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function normalizeRole(role) {
  return String(role || '').trim().toLowerCase();
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
    if (mission.template === 'surviveTimer') {
      return !!mission.state.completed;
    }
    if (mission.template === 'enterRoomType') {
      return (mission.state.entered || 0) >= (mission.state.required || 0);
    }
    if (mission.template === 'killCount') {
      return (mission.state.killed || 0) >= (mission.state.required || 0);
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
  }

  getExitLockedMessage() {
    return this.exitLockMessage || 'Exit locked';
  }

  /**
   * For AutoPilot: return a list of uncompleted interactable objectives.
   * Compatible shape: [{ collected, gridPos:{x,y} }]
   */
  getAutopilotTargets() {
    const targets = [];
    for (const mission of this.missions.values()) {
      if (!mission) continue;
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

    const objective = objectiveMission
      ? {
        id: objectiveMission.id,
        template: objectiveMission.template,
        params: deepClone(objectiveMission.params || {}),
        progress: this.getObjectiveProgress(objectiveMission),
        objectiveText
      }
      : {
        id: 'exit',
        template: 'exit',
        params: {},
        progress: null,
        objectiveText
      };

    return {
      exitUnlocked: this.isExitUnlocked(),
      objective,
      targets: this.getAutopilotTargets()
    };
  }
}
