import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { EVENTS } from '../events.js';
import { ROOM_TYPES } from '../../world/tileTypes.js';

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function makeMaterial(color, emissive = 0x000000, emissiveIntensity = 0.0, transparent = false, opacity = 1.0) {
  return new THREE.MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity,
    roughness: 0.75,
    metalness: 0.1,
    transparent,
    opacity
  });
}

function createHidingSpotObject({ occupied = false } = {}) {
  const group = new THREE.Group();

  const bodyMat = makeMaterial(0x263238, 0x000000, 0.0);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.45, 0.42), bodyMat);
  body.castShadow = false;
  body.receiveShadow = true;
  body.position.y = 0.725;
  group.add(body);

  const doorMat = makeMaterial(0x37474f, 0x000000, 0.0);
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.50, 1.35, 0.03), doorMat);
  door.castShadow = false;
  door.receiveShadow = true;
  door.position.set(0, 0.72, 0.23);
  group.add(door);

  const lightMat = makeMaterial(0x66ff99, 0x66ff99, 0.85);
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 10), lightMat);
  light.castShadow = false;
  light.receiveShadow = false;
  light.position.set(0.22, 0.18, 0.24);
  group.add(light);

  group.userData.__hideSpot = { light };
  setHidingSpotState(group, { occupied });
  return group;
}

function setHidingSpotState(object3d, { occupied = false } = {}) {
  const data = object3d?.userData?.__hideSpot || null;
  if (!data?.light?.material) return;
  const color = occupied ? 0xffcc66 : 0x66ff99;
  data.light.material.color.setHex(color);
  data.light.material.emissive.setHex(color);
}

function gridToWorldCenter(gridPos, tileSize) {
  const ts = tileSize || 1;
  return {
    x: (gridPos.x + 0.5) * ts,
    z: (gridPos.y + 0.5) * ts
  };
}

function pickRoomTiles(worldState, allowedRoomTypes) {
  const ws = worldState;
  const rooms = ws?.getRooms ? ws.getRooms() : [];
  const allowedSet = Array.isArray(allowedRoomTypes) && allowedRoomTypes.length > 0
    ? new Set(allowedRoomTypes)
    : null;

  const tiles = [];
  for (const room of rooms) {
    if (!room || !Array.isArray(room.tiles) || room.tiles.length === 0) continue;
    if (allowedSet && !allowedSet.has(room.type)) continue;
    for (const t of room.tiles) {
      if (!t) continue;
      tiles.push({ x: t.x, y: t.y, roomType: room.type });
    }
  }
  return tiles;
}

function pickDistinctTiles(worldState, count, options = {}) {
  const ws = worldState;
  const desired = Math.max(0, Math.round(count || 0));
  if (!ws?.isWalkableWithMargin || desired <= 0) return [];

  const allowedRoomTypes = options.allowedRoomTypes ?? null;
  const avoid = Array.isArray(options.minDistFrom) ? options.minDistFrom.filter(Boolean) : [];
  const minDist = Number.isFinite(options.minDist) ? options.minDist : 6;
  const margin = Number.isFinite(options.margin) ? options.margin : 1;
  const seed = Number.isFinite(options.seed) ? options.seed : Math.floor(Math.random() * 1_000_000_000);
  const rand = mulberry32(seed >>> 0);

  const candidates = pickRoomTiles(ws, allowedRoomTypes);
  if (candidates.length === 0) return [];

  const picked = [];
  const used = new Set();
  const maxAttempts = Math.max(desired * 140, 500);

  const isFarEnough = (tile) => {
    for (const a of avoid) {
      const d = Math.abs(tile.x - a.x) + Math.abs(tile.y - a.y);
      if (d < minDist) return false;
    }
    return true;
  };

  for (let i = 0; i < maxAttempts && picked.length < desired; i++) {
    const t = candidates[Math.floor(rand() * candidates.length)];
    if (!t) continue;
    const key = `${t.x},${t.y}`;
    if (used.has(key)) continue;
    if (!ws.isWalkableWithMargin(t.x, t.y, margin)) continue;
    if (!isFarEnough(t)) continue;
    used.add(key);
    picked.push({ x: t.x, y: t.y, roomType: t.roomType });
  }

  return picked.slice(0, desired);
}

export class HidingSpotSystem {
  constructor(options = {}) {
    this.eventBus = options.eventBus || null;
    this.worldState = options.worldState || null;
    this.scene = options.scene || null;
    this.interactables = options.interactableSystem || null;
    this.player = options.player || null;

    this.registeredIds = [];
    this.spawnedObjects = [];
  }

  setRefs({ eventBus, worldState, scene, interactableSystem, player } = {}) {
    if (eventBus) this.eventBus = eventBus;
    if (worldState) this.worldState = worldState;
    if (scene) this.scene = scene;
    if (interactableSystem) this.interactables = interactableSystem;
    if (player) this.player = player;
  }

  clear() {
    if (this.interactables && this.registeredIds.length > 0) {
      for (const id of this.registeredIds) {
        this.interactables.unregister?.(id);
      }
    }
    this.registeredIds = [];

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
  }

  startLevel(levelConfig = null) {
    this.clear();

    const enabled = (CONFIG.HIDE_SPOTS_ENABLED ?? true) && !CONFIG.LOW_PERF_MODE;
    if (!enabled) return;

    const ws = this.worldState;
    const scene = this.scene;
    const interactables = this.interactables;
    const player = this.player;
    if (!ws || !scene || !interactables || !player) return;

    player.setHidden?.(false);

    const spawn = ws.getSpawnPoint?.() || null;
    const exit = ws.getExitPoint?.() || null;
    const avoid = [spawn, exit].filter(Boolean);

    const max = CONFIG.HIDE_SPOT_COUNT ?? 4;
    const count = clamp(Math.round(levelConfig?.interactions?.hideSpots?.count ?? max), 0, 16);
    if (count <= 0) return;

    const allowedRoomTypes = Array.isArray(levelConfig?.interactions?.hideSpots?.roomTypes)
      ? levelConfig.interactions.hideSpots.roomTypes
      : [
        ROOM_TYPES.CLASSROOM,
        ROOM_TYPES.CLASSROOMS_BLOCK,
        ROOM_TYPES.OFFICE,
        ROOM_TYPES.LIBRARY,
        ROOM_TYPES.STORAGE
      ];

    const tiles = pickDistinctTiles(ws, count, {
      allowedRoomTypes,
      minDistFrom: avoid,
      minDist: levelConfig?.interactions?.hideSpots?.minDistFromSpawn ?? 6,
      margin: 1,
      seed: levelConfig?.maze?.seed
    });
    if (tiles.length === 0) return;

    const tileSize = CONFIG.TILE_SIZE || 1;

    for (let i = 0; i < tiles.length; i++) {
      const pos = tiles[i];
      const spotId = `hideSpot:${levelConfig?.id ?? 'L'}:${i + 1}`;
      const object3d = createHidingSpotObject({ occupied: false });
      const world = gridToWorldCenter(pos, tileSize);
      object3d.position.set(world.x, 0, world.z);
      object3d.rotation.y = Math.random() * Math.PI * 2;

      scene.add(object3d);
      this.spawnedObjects.push(object3d);

      const label = 'Hide';
      this.registeredIds.push(
        interactables.register({
          id: spotId,
          kind: 'hidingSpot',
          label,
          gridPos: { x: pos.x, y: pos.y },
          object3d,
          maxDistance: 2.2,
          prompt: () => {
            const activeId = player.getForcedInteractId?.() || null;
            const hidden = player.isHidden?.() ?? false;
            if (hidden && activeId === spotId) return 'E: Exit Hiding Spot';
            return 'E: Hide';
          },
          interact: ({ nowMs }) => {
            const activeId = player.getForcedInteractId?.() || null;
            const hidden = player.isHidden?.() ?? false;

            if (hidden && activeId === spotId) {
              player.setHidden?.(false);
              setHidingSpotState(object3d, { occupied: false });
              this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'You left the hiding spot.', seconds: 1.2 });
              return { ok: true, message: 'Unhidden', state: { hidden: false } };
            }

            if (!hidden) {
              player.setHidden?.(true, spotId);
              setHidingSpotState(object3d, { occupied: true });
              this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'You are hidden.', seconds: 1.2 });
              this.eventBus?.emit?.(EVENTS.NOISE_EMITTED, {
                kind: 'interact_hide',
                radius: 4,
                life: 0.5,
                maxLife: 0.5,
                grid: { x: pos.x, y: pos.y },
                world: new THREE.Vector3(world.x, 0, world.z),
                strength: 0.2,
                source: 'player',
                nowMs: Number.isFinite(nowMs) ? nowMs : undefined
              });
              return { ok: true, message: 'Hidden', state: { hidden: true } };
            }

            this.eventBus?.emit?.(EVENTS.UI_TOAST, { text: 'Already hidden somewhere else.', seconds: 1.2 });
            return { ok: false, message: 'Already hidden' };
          }
        })
      );
    }
  }
}

