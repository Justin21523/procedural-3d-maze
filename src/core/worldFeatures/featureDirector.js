import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { EVENTS } from '../events.js';
import { TILE_TYPES, ROOM_TYPES } from '../../world/tileTypes.js';
import { gridToWorldCenter, manhattan } from '../missions/missionUtils.js';
import {
  createKeycardPickupObject,
  createLockedDoorBarrierObject,
  createRotatingDoorBarrierObject,
  createVentEntranceObject,
  createMedicalStationObject,
  createArmoryLockerObject,
  createControlTerminalObject,
  setLockedDoorBarrierState,
  setRotatingDoorBarrierState,
  setArmoryLockerState
} from './featureObjects.js';

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

function pickN(list, n) {
  const arr = Array.isArray(list) ? list.slice() : [];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, Math.max(0, Math.round(n || 0)));
}

export class FeatureDirector {
  constructor(options = {}) {
    this.eventBus = options.eventBus || null;
    this.worldState = options.worldState || null;
    this.scene = options.scene || null;
    this.player = options.player || null;
    this.gameState = options.gameState || null;
    this.interactableSystem = options.interactableSystem || null;
    this.audioManager = options.audioManager || null;
    this.entries = [];
    this.unsubs = [];
    this.activeTransit = null;
    this.bindEvents();
  }

  setRefs(refs = {}) {
    if (refs.eventBus) this.eventBus = refs.eventBus;
    if (refs.worldState) this.worldState = refs.worldState;
    if (refs.scene) this.scene = refs.scene;
    if (refs.player) this.player = refs.player;
    if (refs.gameState) this.gameState = refs.gameState;
    if (refs.interactableSystem) this.interactableSystem = refs.interactableSystem;
    if (refs.audioManager) this.audioManager = refs.audioManager;
    this.bindEvents();
  }

  bindEvents() {
    this.unsubs.forEach((fn) => fn?.());
    this.unsubs = [];
    const bus = this.eventBus;
    if (!bus?.on) return;
    this.unsubs.push(bus.on(EVENTS.TIMER_TICK, () => this.onTimerTick()));
  }

  clear() {
    const ws = this.worldState;
    for (const e of this.entries) {
      if (e?.object3d) this.scene?.remove?.(e.object3d);
      if (e?.interactableId && this.interactableSystem?.unregister) {
        this.interactableSystem.unregister(e.interactableId);
      }
      if (e?.kind === 'lockedDoor' && e?.gridPos && ws?.setObstacle) {
        // Ensure doors do not remain blocked after reloads.
        ws.setObstacle(e.gridPos.x, e.gridPos.y, false);
      }
      if (e?.kind === 'rotatingDoor' && e?.gridPos && ws?.setObstacle) {
        ws.setObstacle(e.gridPos.x, e.gridPos.y, false);
      }
    }
    this.entries = [];
    this.activeTransit = null;
  }

  startLevel(levelConfig) {
    this.clear();
    const cfg = (levelConfig && typeof levelConfig === 'object') ? levelConfig : {};
    const features = isPlainObject(cfg.features) ? cfg.features : {};
    const lockedCfg = isPlainObject(features.lockedDoors) ? features.lockedDoors : null;
    const rotatingCfg = isPlainObject(features.rotatingDoors) ? features.rotatingDoors : null;
    const ventCfg = isPlainObject(features.vents) ? features.vents : null;
    const specialCfg = isPlainObject(features.specialRooms) ? features.specialRooms : null;

    const usedDoorTiles = new Set();
    if (lockedCfg && lockedCfg.enabled === true) {
      this.spawnLockedDoors(lockedCfg, { usedDoorTiles });
    }
    if (rotatingCfg && rotatingCfg.enabled === true) {
      this.spawnRotatingDoors(rotatingCfg, { usedDoorTiles });
    }
    if (ventCfg && ventCfg.enabled === true) {
      this.spawnVentShortcuts(ventCfg);
    }
    if (specialCfg && specialCfg.enabled === true) {
      this.spawnSpecialRooms(specialCfg);
    }
  }

  queryItemCount(itemId) {
    const id = String(itemId || '').trim();
    if (!id) return 0;
    const bus = this.eventBus;
    if (!bus?.emit) return 0;
    const query = { itemId: id, result: null };
    bus.emit(EVENTS.INVENTORY_QUERY_ITEM, query);
    return Math.max(0, Math.round(Number(query.result?.count) || 0));
  }

  giveItem(itemId, count = 1) {
    const id = String(itemId || '').trim();
    if (!id) return;
    this.eventBus?.emit?.(EVENTS.INVENTORY_GIVE_ITEM, {
      actorKind: 'player',
      itemId: id,
      count: Math.max(0, Math.round(Number(count) || 1))
    });
  }

  pickRoomTile({ minDistFromSpawn = 0, avoid = [] } = {}) {
    const ws = this.worldState;
    if (!ws?.getRooms) return null;
    const spawn = ws.getSpawnPoint?.() || null;
    const exit = ws.getExitPoint?.() || null;
    const rooms = ws.getRooms().filter((r) => r && r.type !== ROOM_TYPES.CORRIDOR && Array.isArray(r.tiles) && r.tiles.length > 0);
    const candidates = [];

    for (const room of rooms) {
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
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  applyRoomType(room, roomType) {
    const ws = this.worldState;
    if (!ws?.roomMap) return;
    if (!room || !Array.isArray(room.tiles)) return;
    const t = Number(roomType);
    if (!Number.isFinite(t)) return;
    room.type = t;

    for (const tile of room.tiles) {
      if (!tile) continue;
      if (!ws.roomMap?.[tile.y]) continue;
      ws.roomMap[tile.y][tile.x] = t;
    }
    for (const door of room.doors || []) {
      if (!door) continue;
      if (!ws.roomMap?.[door.y]) continue;
      ws.roomMap[door.y][door.x] = t;
    }
  }

  pickRoom({ minDistFromSpawn = 0, avoidRooms = [] } = {}) {
    const ws = this.worldState;
    if (!ws?.getRooms) return null;
    const spawn = ws.getSpawnPoint?.() || null;
    const exit = ws.getExitPoint?.() || null;

    const avoidSet = new Set((avoidRooms || []).filter(Boolean));
    const rooms = ws.getRooms().filter((r) => {
      if (!r) return false;
      if (!Array.isArray(r.tiles) || r.tiles.length < 10) return false;
      if (r.type === ROOM_TYPES.CORRIDOR) return false;
      if (r.type === ROOM_TYPES.POOL) return false;
      if (avoidSet.has(r)) return false;
      const center = { x: (r.x + Math.floor(r.width / 2)), y: (r.y + Math.floor(r.height / 2)) };
      if (spawn && manhattan(center, spawn) < minDistFromSpawn) return false;
      if (exit && manhattan(center, exit) < 6) return false;
      return true;
    });

    if (rooms.length === 0) return null;
    return rooms[Math.floor(Math.random() * rooms.length)];
  }

  pickRoomInteractTile(room) {
    const ws = this.worldState;
    if (!ws?.isWalkableWithMargin) return null;
    if (!room || !Array.isArray(room.tiles) || room.tiles.length === 0) return null;

    const target = { x: (room.x + Math.floor(room.width / 2)), y: (room.y + Math.floor(room.height / 2)) };
    const doors = Array.isArray(room.doors) ? room.doors : [];

    const candidates = [];
    for (const t of room.tiles) {
      if (!t) continue;
      if (!ws.isWalkableWithMargin(t.x, t.y, 1)) continue;
      let nearDoor = false;
      for (const d of doors) {
        if (d && manhattan(t, d) <= 2) {
          nearDoor = true;
          break;
        }
      }
      if (nearDoor) continue;
      candidates.push(t);
    }

    if (candidates.length === 0) return null;
    candidates.sort((a, b) => manhattan(a, target) - manhattan(b, target));
    return { x: candidates[0].x, y: candidates[0].y };
  }

  spawnSpecialRooms(specialCfg) {
    const cfg = isPlainObject(specialCfg) ? specialCfg : {};
    const medicalCfg = isPlainObject(cfg.medical) ? cfg.medical : null;
    const armoryCfg = isPlainObject(cfg.armory) ? cfg.armory : null;
    const controlCfg = isPlainObject(cfg.control) ? cfg.control : null;
    if (medicalCfg && medicalCfg.enabled !== false) {
      this.spawnMedicalRooms(medicalCfg);
    }
    if (armoryCfg && armoryCfg.enabled !== false) {
      this.spawnArmoryRooms(armoryCfg);
    }
    if (controlCfg && controlCfg.enabled !== false) {
      this.spawnControlRooms(controlCfg);
    }
  }

  spawnMedicalRooms(medicalCfg) {
    const ws = this.worldState;
    const scene = this.scene;
    const interactables = this.interactableSystem;
    if (!ws || !scene || !interactables) return;

    const count = clamp(toInt(medicalCfg.count, 1) ?? 1, 0, 6);
    if (count <= 0) return;
    const minDist = clamp(toInt(medicalCfg.minDistFromSpawn, 8) ?? 8, 0, 999);
    const healAmount = clamp(toInt(medicalCfg.healAmount, 28) ?? 28, 5, 100);
    const charges = clamp(toInt(medicalCfg.charges, 1) ?? 1, 1, 5);
    const makeNoise = medicalCfg.makeNoise !== false;

    const usedRooms = [];
    const tileSize = CONFIG.TILE_SIZE || 1;

    for (let i = 0; i < count; i++) {
      const room = this.pickRoom({ minDistFromSpawn: minDist, avoidRooms: usedRooms });
      if (!room) break;
      const tile = this.pickRoomInteractTile(room);
      if (!tile) {
        usedRooms.push(room);
        continue;
      }
      usedRooms.push(room);
      this.applyRoomType(room, ROOM_TYPES.MEDICAL);

      const pos = gridToWorldCenter(tile.x, tile.y, tileSize);
      pos.y = 0;
      const station = createMedicalStationObject();
      station.position.copy(pos);
      station.rotation.y = Math.random() * Math.PI * 2;
      scene.add(station);

      const entry = {
        kind: 'medicalRoom',
        room,
        gridPos: tile,
        object3d: station,
        chargesLeft: charges,
        healAmount
      };

      const id = `feat:medical:${tile.x},${tile.y}:${Math.random().toString(16).slice(2)}`;
      interactables.register({
        id,
        kind: 'medicalStation',
        label: 'Medical Station',
        object3d: station,
        gridPos: { x: tile.x, y: tile.y },
        maxDistance: 1.65,
        prompt: () => {
          if (entry.chargesLeft <= 0) return 'Medical Station (empty)';
          return `Use Medical Station (+${healAmount} HP) [E] (${entry.chargesLeft})`;
        },
        interact: () => {
          if (entry.chargesLeft <= 0) return { ok: false, message: 'Empty' };
          if (!this.gameState?.heal) return { ok: false, message: 'No effect' };

          const before = Number(this.gameState.currentHealth) || 0;
          this.gameState.heal(healAmount);
          const after = Number(this.gameState.currentHealth) || before;
          const gained = Math.max(0, after - before);
          entry.chargesLeft = Math.max(0, (entry.chargesLeft || 0) - 1);
          this.audioManager?.playPickupHeal?.();

          if (makeNoise) {
            this.eventBus?.emit?.(EVENTS.NOISE_REQUESTED, {
              source: 'player',
              kind: 'med_station',
              position: pos.clone(),
              strength: 0.55,
              radius: 10,
              ttl: 0.9
            });
          }

          const msg = gained > 0 ? `Healed +${gained} HP` : 'Already at full health';
          this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: msg, seconds: 1.2 });
          return { ok: true, healed: gained, chargesLeft: entry.chargesLeft };
        }
      });

      entry.interactableId = id;
      this.entries.push(entry);
    }
  }

  spawnArmoryRooms(armoryCfg) {
    const ws = this.worldState;
    const scene = this.scene;
    const interactables = this.interactableSystem;
    if (!ws || !scene || !interactables) return;

    const count = clamp(toInt(armoryCfg.count, 1) ?? 1, 0, 6);
    if (count <= 0) return;
    const minDist = clamp(toInt(armoryCfg.minDistFromSpawn, 10) ?? 10, 0, 999);
    const charges = clamp(toInt(armoryCfg.charges, 1) ?? 1, 1, 4);
    const ammoAmount = clamp(toInt(armoryCfg.ammoAmount, 45) ?? 45, 10, 200);
    const toolCount = clamp(toInt(armoryCfg.toolCount, 2) ?? 2, 0, 6);

    const usedRooms = [];
    const tileSize = CONFIG.TILE_SIZE || 1;

    for (let i = 0; i < count; i++) {
      const room = this.pickRoom({ minDistFromSpawn: minDist, avoidRooms: usedRooms });
      if (!room) break;
      const tile = this.pickRoomInteractTile(room);
      if (!tile) {
        usedRooms.push(room);
        continue;
      }
      usedRooms.push(room);
      this.applyRoomType(room, ROOM_TYPES.ARMORY);

      const pos = gridToWorldCenter(tile.x, tile.y, tileSize);
      pos.y = 0;
      const locker = createArmoryLockerObject();
      locker.position.copy(pos);
      locker.rotation.y = Math.random() * Math.PI * 2;
      scene.add(locker);

      const entry = {
        kind: 'armoryRoom',
        room,
        gridPos: tile,
        object3d: locker,
        chargesLeft: charges,
        ammoAmount,
        toolCount
      };

      const id = `feat:armory:${tile.x},${tile.y}:${Math.random().toString(16).slice(2)}`;
      interactables.register({
        id,
        kind: 'armoryLocker',
        label: 'Armory Locker',
        object3d: locker,
        gridPos: { x: tile.x, y: tile.y },
        maxDistance: 1.65,
        prompt: () => {
          if (entry.chargesLeft <= 0) return 'Armory Locker (empty)';
          return `Open Armory Locker [E] (${entry.chargesLeft})`;
        },
        interact: () => {
          if (entry.chargesLeft <= 0) return { ok: false, message: 'Empty' };
          entry.chargesLeft = Math.max(0, (entry.chargesLeft || 0) - 1);
          setArmoryLockerState(locker, { opened: true });

          const bus = this.eventBus;
          if (bus?.emit) {
            bus.emit(EVENTS.PICKUP_SPAWN_REQUESTED, { kind: 'ammo', amount: ammoAmount, ttl: 28, position: pos.clone() });
            const toolKinds = ['smoke', 'flash', 'decoy', 'jammer', 'trap', 'lure', 'sensor', 'mine'];
            for (let j = 0; j < toolCount; j++) {
              const kind = toolKinds[Math.floor(Math.random() * toolKinds.length)];
              const p = pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.8, 0, (Math.random() - 0.5) * 0.8));
              bus.emit(EVENTS.PICKUP_SPAWN_REQUESTED, { kind, amount: 1, ttl: 40, position: p });
            }
          }

          this.audioManager?.playPickupAttachment?.();
          this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'Armory cache retrieved', seconds: 1.3 });
          return { ok: true, chargesLeft: entry.chargesLeft };
        }
      });

      entry.interactableId = id;
      this.entries.push(entry);
    }
  }

  spawnControlRooms(controlCfg) {
    const ws = this.worldState;
    const scene = this.scene;
    const interactables = this.interactableSystem;
    if (!ws || !scene || !interactables) return;

    const count = clamp(toInt(controlCfg.count, 1) ?? 1, 0, 6);
    if (count <= 0) return;
    const minDist = clamp(toInt(controlCfg.minDistFromSpawn, 10) ?? 10, 0, 999);
    const charges = clamp(toInt(controlCfg.charges, 1) ?? 1, 1, 4);
    const revealSeconds = clamp(toInt(controlCfg.revealSeconds, 10) ?? 10, 3, 60);
    const makeNoise = controlCfg.makeNoise !== false;

    const usedRooms = [];
    const tileSize = CONFIG.TILE_SIZE || 1;

    for (let i = 0; i < count; i++) {
      const room = this.pickRoom({ minDistFromSpawn: minDist, avoidRooms: usedRooms });
      if (!room) break;
      const tile = this.pickRoomInteractTile(room);
      if (!tile) {
        usedRooms.push(room);
        continue;
      }
      usedRooms.push(room);
      this.applyRoomType(room, ROOM_TYPES.CONTROL);

      const pos = gridToWorldCenter(tile.x, tile.y, tileSize);
      pos.y = 0;
      const terminal = createControlTerminalObject();
      terminal.position.copy(pos);
      terminal.rotation.y = Math.random() * Math.PI * 2;
      scene.add(terminal);

      const entry = {
        kind: 'controlRoom',
        room,
        gridPos: tile,
        object3d: terminal,
        chargesLeft: charges,
        revealSeconds
      };

      const id = `feat:control:${tile.x},${tile.y}:${Math.random().toString(16).slice(2)}`;
      interactables.register({
        id,
        kind: 'controlTerminal',
        label: 'Control Terminal',
        object3d: terminal,
        gridPos: { x: tile.x, y: tile.y },
        maxDistance: 1.65,
        prompt: () => {
          if (entry.chargesLeft <= 0) return 'Control Terminal (offline)';
          return `Run Surveillance Sweep [E] (${entry.chargesLeft})`;
        },
        interact: () => {
          if (entry.chargesLeft <= 0) return { ok: false, message: 'Offline' };
          entry.chargesLeft = Math.max(0, (entry.chargesLeft || 0) - 1);

          this.eventBus?.emit?.(EVENTS.WORLD_REVEAL_MONSTERS, { seconds: revealSeconds });
          this.audioManager?.playObjectiveChime?.();
          this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: `Surveillance online (${revealSeconds}s)`, seconds: 1.3 });

          if (makeNoise) {
            this.eventBus?.emit?.(EVENTS.NOISE_REQUESTED, {
              source: 'player',
              kind: 'terminal',
              position: pos.clone(),
              strength: 0.45,
              radius: 12,
              ttl: 0.8
            });
          }

          return { ok: true, chargesLeft: entry.chargesLeft };
        }
      });

      entry.interactableId = id;
      this.entries.push(entry);
    }
  }

  findDoorCandidates({ minDistFromSpawn = 0 } = {}) {
    const ws = this.worldState;
    if (!ws?.grid) return [];
    const spawn = ws.getSpawnPoint?.() || null;
    const exit = ws.getExitPoint?.() || null;

    const out = [];
    for (let y = 0; y < ws.height; y++) {
      for (let x = 0; x < ws.width; x++) {
        if (ws.grid?.[y]?.[x] !== TILE_TYPES.DOOR) continue;
        if (!ws.isWalkableWithMargin?.(x, y, 1)) continue;
        const pos = { x, y };
        if (spawn && manhattan(pos, spawn) < minDistFromSpawn) continue;
        if (exit && manhattan(pos, exit) < 5) continue;
        out.push(pos);
      }
    }
    return out;
  }

  spawnLockedDoors(lockedCfg, { usedDoorTiles = null } = {}) {
    const ws = this.worldState;
    const scene = this.scene;
    const interactables = this.interactableSystem;
    if (!ws || !scene || !interactables) return;

    const count = clamp(toInt(lockedCfg.count, 2) ?? 2, 1, 8);
    const minDist = clamp(toInt(lockedCfg.minDistFromSpawn, 9) ?? 9, 0, 999);
    const keyItemId = String(lockedCfg.keyItemId || 'keycard').trim() || 'keycard';
    const keyCount = clamp(toInt(lockedCfg.keyCount, 1) ?? 1, 1, 3);
    const reuseKey = lockedCfg.reuseKey !== false; // default true

    const doorCandidates = this.findDoorCandidates({ minDistFromSpawn: minDist });
    const doors = pickN(
      doorCandidates.filter((p) => !(usedDoorTiles && usedDoorTiles.has(`${p.x},${p.y}`))),
      count
    );
    if (doors.length === 0) return;

    // Spawn keycards first (so doors can avoid those tiles).
    const keyTiles = [];
    for (let i = 0; i < keyCount; i++) {
      const keyTile = this.pickRoomTile({ minDistFromSpawn: minDist, avoid: [...doors, ...keyTiles] });
      if (!keyTile) break;
      keyTiles.push(keyTile);
      this.spawnKeyPickup(keyTile, { itemId: keyItemId, label: 'Keycard' });
    }

    const tileSize = CONFIG.TILE_SIZE || 1;
    for (let i = 0; i < doors.length; i++) {
      const gridPos = doors[i];
      usedDoorTiles?.add?.(`${gridPos.x},${gridPos.y}`);
      const pos = gridToWorldCenter(gridPos.x, gridPos.y, tileSize);
      pos.y = 0;

      ws.setObstacle(gridPos.x, gridPos.y, true);

      const barrier = createLockedDoorBarrierObject();
      barrier.position.copy(pos);
      scene.add(barrier);

      const id = `feat:lockedDoor:${gridPos.x},${gridPos.y}:${Math.random().toString(16).slice(2)}`;
      interactables.register({
        id,
        kind: 'lockedDoor',
        object3d: barrier,
        gridPos: { x: gridPos.x, y: gridPos.y },
        interactRange: 1.65,
        text: `Locked Door (need ${keyItemId}) [E]`,
        onInteract: () => {
          const have = this.queryItemCount(keyItemId);
          if (have <= 0) {
            this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: `Need ${keyItemId}`, seconds: 1.4 });
            return { ok: false, reason: 'missing_key' };
          }

          // Unlock
          ws.setObstacle(gridPos.x, gridPos.y, false);
          setLockedDoorBarrierState(barrier, { unlocked: true });
          this.audioManager?.playObjectiveChime?.();
          this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'Door unlocked', seconds: 1.2 });

          if (!reuseKey) {
            this.eventBus?.emit?.(EVENTS.INVENTORY_CONSUME_ITEM, { actorKind: 'player', itemId: keyItemId, count: 1, result: null });
          }

          // Remove barrier to make the passage obvious.
          try {
            scene.remove(barrier);
          } catch {
            // ignore
          }
          try {
            interactables.unregister(id);
          } catch {
            // ignore
          }

          return { ok: true, unlocked: true };
        }
      });

      this.entries.push({
        kind: 'lockedDoor',
        gridPos,
        object3d: barrier,
        interactableId: id
      });
    }
  }

  spawnRotatingDoors(rotatingCfg, { usedDoorTiles = null } = {}) {
    const ws = this.worldState;
    const scene = this.scene;
    const interactables = this.interactableSystem;
    if (!ws || !scene || !interactables) return;

    const count = clamp(toInt(rotatingCfg.count, 4) ?? 4, 1, 18);
    const minDist = clamp(toInt(rotatingCfg.minDistFromSpawn, 7) ?? 7, 0, 999);
    const autoCloseSeconds = clamp(toInt(rotatingCfg.autoCloseSeconds, 7) ?? 7, 0, 60);
    const startOpen = rotatingCfg.startOpen === true;

    const all = this.findDoorCandidates({ minDistFromSpawn: minDist })
      .filter((p) => !(usedDoorTiles && usedDoorTiles.has(`${p.x},${p.y}`)));
    const picked = pickN(all, count);
    if (picked.length === 0) return;

    const tileSize = CONFIG.TILE_SIZE || 1;
    for (const gridPos of picked) {
      usedDoorTiles?.add?.(`${gridPos.x},${gridPos.y}`);
      const pos = gridToWorldCenter(gridPos.x, gridPos.y, tileSize);
      pos.y = 0;

      const barrier = createRotatingDoorBarrierObject();
      barrier.position.copy(pos);
      scene.add(barrier);

      const id = `feat:rotDoor:${gridPos.x},${gridPos.y}:${Math.random().toString(16).slice(2)}`;
      const initialOpen = !!startOpen;
      setRotatingDoorBarrierState(barrier, { open: initialOpen });
      ws.setObstacle(gridPos.x, gridPos.y, !initialOpen);

      const entry = {
        kind: 'rotatingDoor',
        gridPos: { x: gridPos.x, y: gridPos.y },
        object3d: barrier,
        interactableId: id,
        open: initialOpen,
        autoCloseSeconds,
        closeAtSec: null
      };

      interactables.register({
        id,
        kind: 'rotatingDoor',
        object3d: barrier,
        gridPos: { x: gridPos.x, y: gridPos.y },
        interactRange: 1.65,
        text: initialOpen ? 'Gate (open) [E]' : 'Gate (closed) [E]',
        onInteract: () => {
          entry.open = !entry.open;
          setRotatingDoorBarrierState(barrier, { open: entry.open });
          ws.setObstacle(gridPos.x, gridPos.y, !entry.open);

          const now = this.gameState?.getElapsedTime?.() ?? 0;
          if (entry.open && entry.autoCloseSeconds > 0) {
            entry.closeAtSec = Math.round(now + entry.autoCloseSeconds);
          } else {
            entry.closeAtSec = null;
          }

          this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: entry.open ? 'Gate opened' : 'Gate closed', seconds: 1.0 });
          return { ok: true, open: entry.open };
        }
      });

      this.entries.push(entry);
    }
  }

  spawnKeyPickup(gridPos, { itemId = 'keycard', label = 'Keycard' } = {}) {
    const ws = this.worldState;
    const scene = this.scene;
    const interactables = this.interactableSystem;
    if (!ws || !scene || !interactables) return;
    const tileSize = CONFIG.TILE_SIZE || 1;
    const pos = gridToWorldCenter(gridPos.x, gridPos.y, tileSize);
    pos.y = 0;

    const obj = createKeycardPickupObject();
    obj.position.copy(pos);
    scene.add(obj);

    const id = `feat:key:${String(itemId)}:${gridPos.x},${gridPos.y}:${Math.random().toString(16).slice(2)}`;
    interactables.register({
      id,
      kind: 'keyPickup',
      object3d: obj,
      gridPos: { x: gridPos.x, y: gridPos.y },
      interactRange: 1.4,
      text: `Pick up ${label} [E]`,
      onInteract: () => {
        this.giveItem(itemId, 1);
        this.audioManager?.playPickupAttachment?.();
        this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: `${label} acquired`, seconds: 1.4 });
        try { scene.remove(obj); } catch { /* ignore */ }
        try { interactables.unregister(id); } catch { /* ignore */ }
        return { ok: true, picked: true };
      }
    });

    this.entries.push({
      kind: 'keyPickup',
      gridPos,
      object3d: obj,
      interactableId: id,
      itemId: String(itemId)
    });
  }

  spawnVentShortcuts(ventCfg) {
    const ws = this.worldState;
    const scene = this.scene;
    const interactables = this.interactableSystem;
    const player = this.player;
    if (!ws || !scene || !interactables || !player) return;

    const pairs = clamp(toInt(ventCfg.pairs, 1) ?? 1, 1, 4);
    const crawlSeconds = clamp(toInt(ventCfg.crawlSeconds, 6) ?? 6, 2, 20);
    const minDist = clamp(toInt(ventCfg.minDistFromSpawn, 9) ?? 9, 0, 999);
    const minSeparation = clamp(toInt(ventCfg.minSeparationTiles, 16) ?? 16, 6, 999);

    const avoid = [ws.getSpawnPoint?.(), ws.getExitPoint?.()].filter(Boolean);
    const vents = [];

    for (let i = 0; i < pairs * 2; i++) {
      let t = null;
      for (let tries = 0; tries < 120; tries++) {
        const cand = this.pickRoomTile({ minDistFromSpawn: minDist, avoid: [...avoid, ...vents] });
        if (!cand) continue;
        if (vents.length > 0) {
          const farEnough = vents.every((v) => manhattan(v, cand) >= minSeparation);
          if (!farEnough) continue;
        }
        t = cand;
        break;
      }
      if (!t) break;
      vents.push(t);
    }
    if (vents.length < 2) return;

    const tileSize = CONFIG.TILE_SIZE || 1;
    for (let i = 0; i + 1 < vents.length; i += 2) {
      const a = vents[i];
      const b = vents[i + 1];
      this.spawnVentEndpoint(a, b, { crawlSeconds, label: `Vent ${i / 2 + 1}` });
      this.spawnVentEndpoint(b, a, { crawlSeconds, label: `Vent ${i / 2 + 1}` });
    }
  }

  spawnVentEndpoint(fromGrid, toGrid, { crawlSeconds = 6, label = 'Vent' } = {}) {
    const ws = this.worldState;
    const scene = this.scene;
    const interactables = this.interactableSystem;
    const player = this.player;
    if (!ws || !scene || !interactables || !player) return;

    const tileSize = CONFIG.TILE_SIZE || 1;
    const fromWorld = gridToWorldCenter(fromGrid.x, fromGrid.y, tileSize);
    fromWorld.y = 0;

    const obj = createVentEntranceObject();
    obj.position.copy(fromWorld);
    scene.add(obj);

    const id = `feat:vent:${fromGrid.x},${fromGrid.y}->${toGrid.x},${toGrid.y}:${Math.random().toString(16).slice(2)}`;
    interactables.register({
      id,
      kind: 'vent',
      object3d: obj,
      gridPos: { x: fromGrid.x, y: fromGrid.y },
      interactRange: 1.45,
      text: `Enter ${label} [E]`,
      onInteract: () => {
        if (this.activeTransit) {
          this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'Already in transit', seconds: 1.0 });
          return { ok: false, reason: 'busy' };
        }

        const now = this.gameState?.getElapsedTime?.() ?? 0;
        const endAt = Math.round(now + Math.max(2, crawlSeconds));
        const toWorld = gridToWorldCenter(toGrid.x, toGrid.y, tileSize);
        toWorld.y = CONFIG.PLAYER_HEIGHT;

        this.activeTransit = {
          endAtSec: endAt,
          toGrid: { x: toGrid.x, y: toGrid.y },
          toWorld: toWorld.clone()
        };

        player.setMovementDisabledUntil?.(endAt);
        this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'Crawling through vents…', seconds: 1.4 });
        const pos = player.getPosition?.() || null;
        if (pos) {
          this.eventBus?.emit?.(EVENTS.NOISE_REQUESTED, {
            source: 'player',
            kind: 'vent_enter',
            strength: 0.4,
            position: pos.clone(),
            radius: 6,
            ttl: 0.7
          });
        }
        return { ok: true, transit: true };
      }
    });

    this.entries.push({
      kind: 'vent',
      gridPos: { x: fromGrid.x, y: fromGrid.y },
      object3d: obj,
      interactableId: id
    });
  }

  onTimerTick() {
    const ws = this.worldState;
    if (!ws?.setObstacle) return;
    const now = this.gameState?.getElapsedTime?.() ?? 0;

    if (this.activeTransit && now >= (this.activeTransit.endAtSec || 0)) {
      const dest = this.activeTransit.toWorld || null;
      const player = this.player;
      if (dest && player?.setPosition) {
        player.setPosition(dest.x, CONFIG.PLAYER_HEIGHT, dest.z);
        this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'Exited vents', seconds: 1.1 });
        this.eventBus?.emit?.(EVENTS.NOISE_REQUESTED, {
          source: 'player',
          kind: 'vent_exit',
          strength: 0.7,
          position: new THREE.Vector3(dest.x, 0, dest.z),
          radius: 10,
          ttl: 0.9
        });
      }
      this.activeTransit = null;
    }

    for (const e of this.entries) {
      if (!e || e.kind !== 'rotatingDoor') continue;
      if (!e.open) continue;
      const closeAt = Number.isFinite(e.closeAtSec) ? e.closeAtSec : null;
      if (closeAt === null) continue;
      if (now < closeAt) continue;

      e.open = false;
      e.closeAtSec = null;
      ws.setObstacle(e.gridPos.x, e.gridPos.y, true);
      setRotatingDoorBarrierState(e.object3d, { open: false });
      this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'Gate closed', seconds: 0.9 });
    }
  }
}
