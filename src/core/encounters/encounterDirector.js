import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { EVENTS } from '../events.js';
import { ROOM_TYPES } from '../../world/tileTypes.js';
import { gridToWorldCenter, manhattan } from '../missions/missionUtils.js';
import {
  createAlarmTrapObject,
  createTradeKioskObject,
  createTreasureChestObject,
  setAlarmTrapState,
  setTreasureChestState
} from './encounterObjects.js';

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function toInt(v, fallback = null) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : fallback;
}

function toNumber(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function pick1(list) {
  if (!Array.isArray(list) || list.length === 0) return null;
  return list[Math.floor(Math.random() * list.length)] || list[0] || null;
}

function normalizeRoomType(value) {
  if (Number.isFinite(Number(value))) {
    const n = Math.round(Number(value));
    const ok = Object.values(ROOM_TYPES).includes(n);
    return ok ? n : null;
  }
  const key = String(value || '').trim().toUpperCase();
  if (!key) return null;
  const id = ROOM_TYPES[key];
  return Number.isFinite(id) ? id : null;
}

function normalizeRoomTypes(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const v of list) {
    const id = normalizeRoomType(v);
    if (Number.isFinite(id)) out.push(id);
  }
  return out.length > 0 ? out : null;
}

function shuffleInPlace(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

export class EncounterDirector {
  constructor(options = {}) {
    this.eventBus = options.eventBus || null;
    this.worldState = options.worldState || null;
    this.scene = options.scene || null;
    this.player = options.player || null;
    this.gun = options.gun || null;
    this.gameState = options.gameState || null;
    this.monsterManager = options.monsterManager || null;
    this.interactableSystem = options.interactableSystem || null;
    this.pickupManager = options.pickupManager || null;
    this.lights = options.lights || null;
    this.audioManager = options.audioManager || null;

    this._lightBaseline = null;
    this._blackoutTimer = 0;

    this.entries = [];
    this.unsubs = [];
    this.bindEvents();
  }

  setRefs(refs = {}) {
    if (refs.eventBus) this.eventBus = refs.eventBus;
    if (refs.worldState) this.worldState = refs.worldState;
    if (refs.scene) this.scene = refs.scene;
    if (refs.player) this.player = refs.player;
    if (refs.gun) this.gun = refs.gun;
    if (refs.gameState) this.gameState = refs.gameState;
    if (refs.monsterManager) this.monsterManager = refs.monsterManager;
    if (refs.interactableSystem) this.interactableSystem = refs.interactableSystem;
    if (refs.pickupManager) this.pickupManager = refs.pickupManager;
    if (refs.lights) this.lights = refs.lights;
    if (refs.audioManager) this.audioManager = refs.audioManager;
    this.bindEvents();
  }

  clear() {
    for (const e of this.entries) {
      if (e?.object3d && this.scene) this.scene.remove(e.object3d);
      if (e?.interactableId && this.interactableSystem?.unregister) {
        this.interactableSystem.unregister(e.interactableId);
      }
    }
    this.entries = [];
    this._blackoutTimer = 0;
    this.applyBlackoutMultiplier(1.0);
  }

  dispose() {
    this.clear();
    this.unsubs.forEach((fn) => fn?.());
    this.unsubs = [];
  }

  bindEvents() {
    this.unsubs.forEach((fn) => fn?.());
    this.unsubs = [];
    const bus = this.eventBus;
    if (!bus?.on) return;

    this.unsubs.push(bus.on(EVENTS.INTERACT, (payload) => this.onInteract(payload)));
    this.unsubs.push(bus.on(EVENTS.ROOM_ENTERED, (payload) => this.onRoomEntered(payload)));
    this.unsubs.push(bus.on(EVENTS.TIMER_TICK, (payload) => this.onTimerTick(payload)));
  }

  startLevel(levelConfig) {
    this.clear();
    const cfg = (levelConfig && typeof levelConfig === 'object') ? levelConfig : {};
    const encounters = isPlainObject(cfg.encounters) ? cfg.encounters : {};
    const ws = this.worldState;
    const scene = this.scene;
    const interactables = this.interactableSystem;
    if (!ws || !scene || !interactables) return;

    // B1: Treasure chest room
    const chestCfg = isPlainObject(encounters.treasureChest) ? encounters.treasureChest : {};
    if (chestCfg.enabled === true) {
      const count = clamp(toInt(chestCfg.count, 1) ?? 1, 1, 3);
      const minDist = clamp(toInt(chestCfg.minDistFromSpawn, 10) ?? 10, 0, 999);
      for (let i = 0; i < count; i++) {
        const gridPos = this.pickRoomTile({
          avoid: [ws.getSpawnPoint?.(), ws.getExitPoint?.()],
          minDistFromSpawn: minDist,
          roomTypes: chestCfg.roomTypes
        });
        if (!gridPos) continue;
        this.spawnTreasureChest(gridPos, { lootScale: chestCfg.lootScale });
      }
    }

    // B2: Patrol squad (spawn extra monsters with a corridor route)
    const patrolCfg = isPlainObject(encounters.patrolSquad) ? encounters.patrolSquad : {};
    if (patrolCfg.enabled === true) {
      void this.spawnPatrolSquad(patrolCfg);
    }

    // B3: Cursed room
    const cursedCfg = isPlainObject(encounters.cursedRoom) ? encounters.cursedRoom : {};
    if (cursedCfg.enabled === true) {
      const room = this.pickRoom({
        avoid: [ws.getSpawnPoint?.(), ws.getExitPoint?.()],
        minDistFromSpawn: clamp(toInt(cursedCfg.minDistFromSpawn, 8) ?? 8, 0, 999),
        roomTypes: cursedCfg.roomTypes
      });
      if (room) {
        this.entries.push({
          kind: 'cursedRoom',
          roomId: room.id ?? null,
          roomType: Number.isFinite(room.type) ? room.type : null,
          appliedAtSec: null,
          seconds: clamp(toNumber(cursedCfg.seconds, 18) ?? 18, 4, 120),
          noiseRadiusMult: clamp(toNumber(cursedCfg.noiseRadiusMult, 1.25) ?? 1.25, 1.0, 3.0),
          scentStrengthMult: clamp(toNumber(cursedCfg.scentStrengthMult, 1.35) ?? 1.35, 1.0, 3.0)
        });
      }
    }

    // B4: Alarm traps (step-trigger)
    const trapCfg = isPlainObject(encounters.alarmTraps) ? encounters.alarmTraps : {};
    if (trapCfg.enabled === true) {
      const count = clamp(toInt(trapCfg.count, 3) ?? 3, 1, 10);
      const minDist = clamp(toInt(trapCfg.minDistFromSpawn, 7) ?? 7, 0, 999);
      const placed = [];
      for (let i = 0; i < count; i++) {
        const gridPos = this.pickCorridorTile({
          avoid: [ws.getSpawnPoint?.(), ws.getExitPoint?.(), ...placed],
          minDistFromSpawn: minDist,
          minDistFromOthers: 5
        });
        if (!gridPos) continue;
        placed.push(gridPos);
        this.spawnAlarmTrap(gridPos, {
          radius: clamp(toNumber(trapCfg.triggerRadius, 0.65) ?? 0.65, 0.35, 2.0),
          noiseRadius: clamp(toInt(trapCfg.noiseRadius, 18) ?? 18, 3, 60),
          damage: clamp(toInt(trapCfg.damage, 6) ?? 6, 0, 60)
        });
      }
    }

    // B5: Trade point
    const tradeCfg = isPlainObject(encounters.tradePoint) ? encounters.tradePoint : {};
    if (tradeCfg.enabled === true) {
      const gridPos = this.pickRoomTile({
        avoid: [ws.getSpawnPoint?.(), ws.getExitPoint?.()],
        minDistFromSpawn: clamp(toInt(tradeCfg.minDistFromSpawn, 9) ?? 9, 0, 999),
        roomTypes: tradeCfg.roomTypes
      });
      if (gridPos) {
        this.spawnTradeKiosk(gridPos, {
          ammoCost: clamp(toInt(tradeCfg.ammoCost, 30) ?? 30, 1, 999),
          toolRewardCount: clamp(toInt(tradeCfg.toolRewardCount, 2) ?? 2, 1, 6),
          healthReward: clamp(toInt(tradeCfg.healthReward, 18) ?? 18, 0, 80)
        });
      }
    }

    // B6: Short blackout event (triggered on a random room entry)
    const blackoutCfg = isPlainObject(encounters.shortBlackout) ? encounters.shortBlackout : {};
    if (blackoutCfg.enabled === true) {
      const room = this.pickRoom({
        avoid: [ws.getSpawnPoint?.(), ws.getExitPoint?.()],
        minDistFromSpawn: clamp(toInt(blackoutCfg.minDistFromSpawn, 6) ?? 6, 0, 999),
        roomTypes: blackoutCfg.roomTypes
      });
      if (room) {
        this.entries.push({
          kind: 'shortBlackout',
          roomId: room.id ?? null,
          roomType: Number.isFinite(room.type) ? room.type : null,
          seconds: clamp(toNumber(blackoutCfg.seconds, 10) ?? 10, 3, 30),
          mult: clamp(toNumber(blackoutCfg.lightMultiplier, 0.25) ?? 0.25, 0.05, 0.8),
          triggered: false
        });
      }
    }
  }

  pickRoom({ avoid = [], minDistFromSpawn = 0, roomTypes = null } = {}) {
    const ws = this.worldState;
    if (!ws?.getRooms) return null;
    const rooms = ws.getRooms().filter((r) => r && Array.isArray(r.tiles) && r.tiles.length > 0);
    const spawn = ws.getSpawnPoint?.() || null;
    const exit = ws.getExitPoint?.() || null;

    const allowTypes = normalizeRoomTypes(roomTypes);

    const okRoom = (room) => {
      if (!room) return false;
      if (room.type === ROOM_TYPES.CORRIDOR) return false;
      if (allowTypes && !allowTypes.includes(room.type)) return false;
      const anyTile = room.tiles?.[Math.floor(Math.random() * room.tiles.length)] || null;
      if (!anyTile) return false;
      if (spawn && manhattan(anyTile, spawn) < minDistFromSpawn) return false;
      if (exit && manhattan(anyTile, exit) < 5) return false;
      for (const a of avoid || []) {
        if (!a) continue;
        if (manhattan(anyTile, a) < 5) return false;
      }
      return true;
    };

    const candidates = rooms.filter(okRoom);
    return pick1(candidates);
  }

  pickRoomTile({ avoid = [], minDistFromSpawn = 0, roomTypes = null } = {}) {
    const ws = this.worldState;
    if (!ws) return null;
    const spawn = ws.getSpawnPoint?.() || null;
    const exit = ws.getExitPoint?.() || null;

    const allowTypes = normalizeRoomTypes(roomTypes);
    const rooms = ws.getRooms ? ws.getRooms() : [];
    const candidates = [];

    for (const room of rooms) {
      if (!room || !Array.isArray(room.tiles) || room.tiles.length === 0) continue;
      if (room.type === ROOM_TYPES.CORRIDOR) continue;
      if (allowTypes && !allowTypes.includes(room.type)) continue;
      for (const t of room.tiles) {
        if (!t) continue;
        if (!ws.isWalkableWithMargin?.(t.x, t.y, 1)) continue;
        if (spawn && manhattan(t, spawn) < minDistFromSpawn) continue;
        if (exit && manhattan(t, exit) < 5) continue;
        let tooClose = false;
        for (const a of avoid || []) {
          if (!a) continue;
          if (manhattan(t, a) < 5) {
            tooClose = true;
            break;
          }
        }
        if (tooClose) continue;
        candidates.push({ x: t.x, y: t.y });
      }
    }

    if (candidates.length === 0) return null;
    shuffleInPlace(candidates);
    return candidates[0] || null;
  }

  pickCorridorTile({ avoid = [], minDistFromSpawn = 0, minDistFromOthers = 0 } = {}) {
    const ws = this.worldState;
    if (!ws?.findRandomWalkableTile) return null;
    const spawn = ws.getSpawnPoint?.() || null;
    const exit = ws.getExitPoint?.() || null;

    for (let i = 0; i < 500; i++) {
      const t = ws.findRandomWalkableTile();
      if (!t) continue;
      if (!ws.isWalkableWithMargin?.(t.x, t.y, 1)) continue;
      if (ws.getRoomType && ws.getRoomType(t.x, t.y) !== ROOM_TYPES.CORRIDOR) continue;
      if (spawn && manhattan(t, spawn) < minDistFromSpawn) continue;
      if (exit && manhattan(t, exit) < 4) continue;
      let tooClose = false;
      for (const a of avoid || []) {
        if (!a) continue;
        if (manhattan(t, a) < Math.max(4, minDistFromOthers)) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;
      return { x: t.x, y: t.y };
    }
    return null;
  }

  spawnTreasureChest(gridPos, options = {}) {
    const scene = this.scene;
    const interactables = this.interactableSystem;
    if (!scene || !interactables) return;

    const tileSize = CONFIG.TILE_SIZE || 1;
    const pos = gridToWorldCenter(gridPos.x, gridPos.y, tileSize);
    pos.y = 0;

    const chest = createTreasureChestObject({ opened: false });
    chest.position.copy(pos);
    scene.add(chest);

    const id = `enc:chest:${gridPos.x},${gridPos.y}:${Math.random().toString(16).slice(2)}`;
    const lootScale = clamp(toNumber(options.lootScale, 1.0) ?? 1.0, 0.5, 3.0);

    interactables.register({
      id,
      kind: 'treasureChest',
      object3d: chest,
      gridPos: { x: gridPos.x, y: gridPos.y },
      interactRange: 1.4,
      text: 'Open Chest [E]',
      onInteract: () => {
        if (chest.userData.__opened) {
          return { ok: true, message: 'Empty' };
        }
        setTreasureChestState(chest, { opened: true });

        const strength = 1.0;
        this.eventBus?.emit?.(EVENTS.NOISE_REQUESTED, {
          source: 'encounter',
          kind: 'chest_open',
          strength,
          position: pos.clone(),
          radius: Math.max(6, Math.round(22 * lootScale)),
          ttl: 1.4
        });
        this.audioManager?.playObjectiveChime?.();
        this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'Chest opened — it was loud', seconds: 1.6 });

        const base = pos.clone();
        const scatter = (i, n) => {
          const ang = (i / Math.max(1, n)) * Math.PI * 2;
          const r = 0.35 + Math.random() * 0.25;
          return base.clone().add(new THREE.Vector3(Math.cos(ang) * r, 0, Math.sin(ang) * r));
        };

        const bus = this.eventBus;
        if (!bus?.emit) return { ok: true, opened: true };

        const toolKinds = ['lure', 'trap', 'jammer', 'decoy', 'smoke', 'flash', 'sensor', 'mine'];
        shuffleInPlace(toolKinds);
        const toolsToDrop = clamp(toInt(2 * lootScale, 2) ?? 2, 1, 5);
        for (let i = 0; i < toolsToDrop; i++) {
          const kind = toolKinds[i % toolKinds.length];
          bus.emit(EVENTS.PICKUP_SPAWN_REQUESTED, { kind, amount: 1, ttl: 45, position: scatter(i, toolsToDrop) });
        }

        bus.emit(EVENTS.PICKUP_SPAWN_REQUESTED, { kind: 'ammo', amount: clamp(toInt(25 * lootScale, 25) ?? 25, 10, 120), ttl: 22, position: scatter(7, 12) });
        bus.emit(EVENTS.PICKUP_SPAWN_REQUESTED, { kind: 'healthSmall', amount: clamp(toInt(10 * lootScale, 10) ?? 10, 6, 40), ttl: 18, position: scatter(9, 12) });
        return { ok: true, opened: true };
      }
    });

    this.entries.push({
      kind: 'treasureChest',
      gridPos,
      object3d: chest,
      interactableId: id
    });
  }

  spawnAlarmTrap(gridPos, options = {}) {
    const scene = this.scene;
    if (!scene) return;
    const tileSize = CONFIG.TILE_SIZE || 1;
    const pos = gridToWorldCenter(gridPos.x, gridPos.y, tileSize);
    pos.y = 0;

    const trap = createAlarmTrapObject();
    trap.position.copy(pos);
    scene.add(trap);

    this.entries.push({
      kind: 'alarmTrap',
      gridPos,
      object3d: trap,
      radius: clamp(toNumber(options.radius, 0.65) ?? 0.65, 0.35, 2.0),
      noiseRadius: clamp(toInt(options.noiseRadius, 18) ?? 18, 3, 60),
      damage: clamp(toInt(options.damage, 6) ?? 6, 0, 60),
      triggered: false
    });
  }

  spawnTradeKiosk(gridPos, options = {}) {
    const scene = this.scene;
    const interactables = this.interactableSystem;
    if (!scene || !interactables) return;

    const tileSize = CONFIG.TILE_SIZE || 1;
    const pos = gridToWorldCenter(gridPos.x, gridPos.y, tileSize);
    pos.y = 0;

    const kiosk = createTradeKioskObject();
    kiosk.position.copy(pos);
    scene.add(kiosk);

    const id = `enc:trade:${gridPos.x},${gridPos.y}:${Math.random().toString(16).slice(2)}`;
    const ammoCost = clamp(toInt(options.ammoCost, 30) ?? 30, 1, 999);
    const toolRewardCount = clamp(toInt(options.toolRewardCount, 2) ?? 2, 1, 6);
    const healthReward = clamp(toInt(options.healthReward, 18) ?? 18, 0, 80);

    interactables.register({
      id,
      kind: 'tradeKiosk',
      object3d: kiosk,
      gridPos: { x: gridPos.x, y: gridPos.y },
      interactRange: 1.55,
      text: `Trade: ${ammoCost} ammo → tools+health [E]`,
      onInteract: () => {
        const g = this.gun || null;

        const ok = this.tryConsumeAmmo(ammoCost, g);
        if (!ok) {
          this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: `Need ${ammoCost} ammo`, seconds: 1.4 });
          return { ok: false, message: 'need_ammo' };
        }

        const base = pos.clone();
        const bus = this.eventBus;
        if (bus?.emit) {
          const toolKinds = ['lure', 'trap', 'jammer', 'decoy', 'smoke', 'flash', 'sensor', 'mine'];
          shuffleInPlace(toolKinds);
          for (let i = 0; i < toolRewardCount; i++) {
            const kind = toolKinds[i % toolKinds.length];
            const p = base.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.7, 0, (Math.random() - 0.5) * 0.7));
            bus.emit(EVENTS.PICKUP_SPAWN_REQUESTED, { kind, amount: 1, ttl: 40, position: p });
          }
          if (healthReward > 0) {
            bus.emit(EVENTS.PICKUP_SPAWN_REQUESTED, { kind: 'healthSmall', amount: healthReward, ttl: 18, position: base.clone().add(new THREE.Vector3(0.3, 0, -0.3)) });
          }
        }

        this.audioManager?.playPickupAttachment?.();
        this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'Trade complete', seconds: 1.3 });
        return { ok: true, traded: true };
      }
    });

    this.entries.push({
      kind: 'tradeKiosk',
      gridPos,
      object3d: kiosk,
      interactableId: id
    });
  }

  tryConsumeAmmo(amount, gun = null) {
    const g = gun || null;
    const cost = Math.max(0, Math.round(Number(amount) || 0));
    if (!g || cost <= 0) return false;
    if (typeof g.consumeAmmo === 'function') {
      return g.consumeAmmo(cost) === true;
    }
    // Back-compat: try to subtract from active weapon reserve if accessible.
    try {
      const state = g.getWeaponState ? g.getWeaponState() : null;
      if (!state) return false;
      const have = Math.max(0, Math.round(Number(state.ammoReserve) || 0));
      if (have < cost) return false;
      state.ammoReserve = have - cost;
      return true;
    } catch (err) {
      void err;
      return false;
    }
  }

  readLightBaseline() {
    const lights = this.lights;
    if (!lights) return null;
    const ambient = lights?.ambientLight?.intensity;
    const hemi = lights?.hemiLight?.intensity;
    const directional = lights?.directionalLight?.intensity;
    const baseIntensity = lights?.flickerData?.baseIntensity;
    const originalIntensity = lights?.flickerData?.originalIntensity;
    return {
      ambient: Number.isFinite(baseIntensity) ? baseIntensity : (Number.isFinite(ambient) ? ambient : 0.3),
      hemi: Number.isFinite(hemi) ? hemi : 0.25,
      directional: Number.isFinite(originalIntensity) ? originalIntensity : (Number.isFinite(directional) ? directional : 0.7)
    };
  }

  applyBlackoutMultiplier(mult) {
    const lights = this.lights;
    if (!lights) return;
    if (!this._lightBaseline) this._lightBaseline = this.readLightBaseline();
    const base = this._lightBaseline || this.readLightBaseline();
    if (!base) return;

    const m = Number.isFinite(mult) ? Math.max(0, mult) : 1;
    const ambient = base.ambient * m;
    const directional = base.directional * m;
    const hemi = base.hemi * m;

    if (lights.flickerData) {
      lights.flickerData.baseIntensity = ambient;
      lights.flickerData.originalIntensity = directional;
    }
    if (lights.ambientLight) lights.ambientLight.intensity = ambient;
    if (lights.directionalLight) lights.directionalLight.intensity = directional;
    if (lights.hemiLight) lights.hemiLight.intensity = hemi;
  }

  async spawnPatrolSquad(patrolCfg) {
    const mm = this.monsterManager;
    const ws = this.worldState;
    if (!mm?.spawner?.spawnAtGrid || !ws) return;

    const count = clamp(toInt(patrolCfg.count, 3) ?? 3, 1, 6);
    const minDist = clamp(toInt(patrolCfg.minDistFromSpawn, 9) ?? 9, 0, 999);
    const routeLen = clamp(toInt(patrolCfg.routeWaypoints, 4) ?? 4, 3, 8);
    const route = [];

    const start = this.pickCorridorTile({ avoid: [ws.getSpawnPoint?.(), ws.getExitPoint?.()], minDistFromSpawn: minDist });
    if (!start) return;
    route.push(start);

    for (let i = 1; i < routeLen; i++) {
      const next = this.pickCorridorTile({ avoid: [ws.getSpawnPoint?.(), ws.getExitPoint?.(), ...route], minDistFromSpawn: minDist, minDistFromOthers: 4 });
      if (!next) break;
      route.push(next);
    }

    if (route.length < 3) return;

    const spawnedMonsters = [];
    for (let i = 0; i < count; i++) {
      const spawn = route[i % route.length];
      const beforeCount = mm.monsters.length;
      await mm.spawner.spawnAtGrid(spawn, null);
      const after = mm.monsters.length;
      if (after > beforeCount) {
        spawnedMonsters.push(mm.monsters[after - 1]);
      }
    }

    for (const m of spawnedMonsters) {
      if (!m) continue;
      m.patrolRoute = route.map((t) => ({ x: t.x, y: t.y }));
      m.patrolIndex = Math.floor(Math.random() * Math.max(1, route.length));
    }

    this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'You hear footsteps in the halls...', seconds: 1.8 });
  }

  onInteract(payload) {
    void payload;
  }

  onRoomEntered(payload) {
    const roomType = payload?.roomType;
    const roomId = payload?.roomId ?? null;
    const playerGrid = payload?.gridPos ?? payload?.playerGridPos ?? this.player?.getGridPosition?.() ?? null;
    if (!Number.isFinite(roomType)) return;

    // Cursed room: apply temporary noise/scent penalties.
    for (const e of this.entries) {
      if (!e || e.kind !== 'cursedRoom') continue;
      if (e.appliedAtSec !== null) continue;
      if (e.roomType !== null && e.roomType !== roomType) continue;
      if (e.roomId !== null && roomId !== null && e.roomId !== roomId) continue;
      e.appliedAtSec = this.gameState?.getElapsedTime?.() ?? 0;

      const seconds = Number(e.seconds) || 18;
      const until = (e.appliedAtSec || 0) + seconds;
      this.player?.setPerceptionModifiers?.({
        noiseRadiusMult: e.noiseRadiusMult,
        scentStrengthMult: e.scentStrengthMult,
        untilSec: until
      });

      this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'Cursed room — you leave stronger traces', seconds: 1.9 });
      this.eventBus?.emit?.(EVENTS.NOISE_REQUESTED, {
        source: 'encounter',
        kind: 'curse_enter',
        strength: 0.85,
        position: this.player?.getPosition?.()?.clone?.() ?? new THREE.Vector3(),
        radius: 12,
        ttl: 0.9
      });
    }

    // Short blackout: trigger when entering the chosen room.
    for (const e of this.entries) {
      if (!e || e.kind !== 'shortBlackout') continue;
      if (e.triggered) continue;
      if (e.roomId !== null && roomId !== null && e.roomId !== roomId) continue;
      // Allow type match if roomId isn't tracked by the world.
      if (e.roomId === null && e.roomType !== null && e.roomType !== roomType) continue;
      e.triggered = true;
      this._blackoutTimer = Math.max(this._blackoutTimer, Number(e.seconds) || 10);
      this.applyBlackoutMultiplier(Number(e.mult) || 0.25);
      this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'Power flickers... blackout!', seconds: 1.7 });
      this.eventBus?.emit?.(EVENTS.NOISE_REQUESTED, {
        source: 'encounter',
        kind: 'blackout',
        strength: 0.6,
        position: this.player?.getPosition?.()?.clone?.() ?? new THREE.Vector3(),
        radius: 10,
        ttl: 0.8
      });
      this.audioManager?.playObjectiveChime?.();
    }

    // Alarm traps: trigger if the player entered within a tile.
    if (playerGrid && Number.isFinite(playerGrid.x) && Number.isFinite(playerGrid.y)) {
      for (const e of this.entries) {
        if (!e || e.kind !== 'alarmTrap') continue;
        if (e.triggered) continue;
        const dist = manhattan(playerGrid, e.gridPos);
        if (dist > 0) continue;
        e.triggered = true;
        setAlarmTrapState(e.object3d, { triggered: true });
        this.gameState?.takeDamage?.(Number(e.damage) || 0);
        this.eventBus?.emit?.(EVENTS.NOISE_REQUESTED, {
          source: 'encounter',
          kind: 'alarm_trap',
          strength: 1.0,
          position: gridToWorldCenter(e.gridPos.x, e.gridPos.y, CONFIG.TILE_SIZE || 1),
          radius: Number(e.noiseRadius) || 18,
          ttl: 1.35
        });
        this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'Trap triggered!', seconds: 1.3 });
      }
    }
  }

  onTimerTick(payload) {
    void payload;

    // Blackout timer countdown
    if ((this._blackoutTimer || 0) > 0) {
      this._blackoutTimer = Math.max(0, (this._blackoutTimer || 0) - 1);
      if (this._blackoutTimer <= 0) {
        this.applyBlackoutMultiplier(1.0);
      }
    }
  }
}
