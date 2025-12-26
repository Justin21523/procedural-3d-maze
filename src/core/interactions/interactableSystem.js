import * as THREE from 'three';
import { EVENTS } from '../events.js';
import { CONFIG } from '../config.js';

function isVec3(v) {
  return !!v && typeof v.x === 'number' && typeof v.y === 'number' && typeof v.z === 'number';
}

function findInteractableId(object3d) {
  let cur = object3d;
  while (cur) {
    const id = cur?.userData?.interactableId;
    if (typeof id === 'string' && id.trim()) return id.trim();
    cur = cur.parent || null;
  }
  return null;
}

export class InteractableSystem {
  constructor(options = {}) {
    this.eventBus = options.eventBus || null;
    this.scene = options.scene || null;
    this.camera = options.camera || null; // THREE.Camera or wrapper with getCamera()
    this.input = options.input || null;
    this.worldState = options.worldState || null;

    this.maxDistance = Number.isFinite(options.maxDistance) ? options.maxDistance : 2.4;
    this.autoInteractDistance = Number.isFinite(options.autoInteractDistance)
      ? options.autoInteractDistance
      : 1.6;

    this.raycaster = new THREE.Raycaster();
    this.raycaster.near = 0.05;
    this.raycaster.far = 12;

    this.interactables = new Map(); // id -> interactable
    this.roots = []; // Object3D roots for raycast

    this.hoverId = null;
    this.hoverText = '';

    this._tmpCamDir = new THREE.Vector3();
  }

  setRefs({ eventBus, scene, camera, input, worldState } = {}) {
    if (eventBus) this.eventBus = eventBus;
    if (scene) this.scene = scene;
    if (camera) this.camera = camera;
    if (input) this.input = input;
    if (worldState) this.worldState = worldState;
  }

  getTileSize() {
    return CONFIG.TILE_SIZE || 1;
  }

  worldToGrid(pos) {
    if (!isVec3(pos)) return null;
    const ts = this.getTileSize();
    return { x: Math.floor(pos.x / ts), y: Math.floor(pos.z / ts) };
  }

  hasLineOfSight(playerPos, entry) {
    const ws = this.worldState;
    if (!ws?.hasLineOfSight) return true;
    const a = this.worldToGrid(playerPos);
    const b = entry?.gridPos;
    if (!a || !b || !Number.isFinite(b.x) || !Number.isFinite(b.y)) return true;
    return !!ws.hasLineOfSight(a, b);
  }

  clear() {
    this.interactables.clear();
    this.roots = [];
    this.setHover(null, '');
  }

  register(interactable) {
    if (!interactable) return null;
    const id = String(interactable.id || '').trim();
    if (!id) return null;
    const object3d = interactable.object3d || interactable.mesh || null;
    if (!object3d) return null;

    object3d.userData = object3d.userData || {};
    object3d.userData.interactableId = id;

    const entry = {
      id,
      kind: String(interactable.kind || 'unknown'),
      label: String(interactable.label || ''),
      gridPos: interactable.gridPos || null,
      object3d,
      collected: !!interactable.collected,
      enabled: interactable.enabled !== false,
      maxDistance: Number.isFinite(interactable.maxDistance) ? interactable.maxDistance : null,
      prompt: interactable.prompt || null, // string or ({actorKind}) => string
      canInteract: typeof interactable.canInteract === 'function' ? interactable.canInteract : null,
      interact: typeof interactable.interact === 'function' ? interactable.interact : null,
      meta: interactable.meta || null
    };

    this.interactables.set(id, entry);
    this.roots.push(object3d);
    return id;
  }

  unregister(id) {
    const key = String(id || '').trim();
    if (!key) return false;
    const entry = this.interactables.get(key);
    if (!entry) return false;
    this.interactables.delete(key);
    this.roots = this.roots.filter((obj) => obj !== entry.object3d);
    if (this.hoverId === key) {
      this.setHover(null, '');
    }
    return true;
  }

  get(id) {
    const key = String(id || '').trim();
    if (!key) return null;
    return this.interactables.get(key) || null;
  }

  list() {
    return Array.from(this.interactables.values());
  }

  getCameraObject() {
    if (!this.camera) return null;
    return typeof this.camera.getCamera === 'function' ? this.camera.getCamera() : this.camera;
  }

  getInteractDistanceFor(entry) {
    const d = entry?.maxDistance;
    if (Number.isFinite(d) && d > 0) return d;
    return this.maxDistance;
  }

  buildPrompt(entry, ctx = {}) {
    if (!entry) return '';
    if (entry.collected || entry.enabled === false) return '';
    const actorKind = ctx.actorKind || 'player';
    if (typeof entry.prompt === 'function') {
      return String(entry.prompt({ actorKind, entry, ctx }) || '');
    }
    if (typeof entry.prompt === 'string') return entry.prompt;
    const label = entry.label || entry.kind || 'Interact';
    return actorKind === 'player' ? `E: ${label}` : label;
  }

  setHover(id, text) {
    const nextId = id ? String(id) : null;
    const nextText = String(text || '');
    const changed = nextId !== this.hoverId || nextText !== this.hoverText;
    this.hoverId = nextId;
    this.hoverText = nextText;
    if (changed) {
      this.eventBus?.emit?.(EVENTS.INTERACTABLE_HOVER, {
        id: this.hoverId,
        text: this.hoverText
      });
    }
  }

  pickHovered(playerPos) {
    const cam = this.getCameraObject();
    if (!cam) return null;
    if (!playerPos) return null;
    if (!this.roots || this.roots.length === 0) return null;

    cam.getWorldDirection(this._tmpCamDir);
    if (this._tmpCamDir.lengthSq() <= 1e-8) return null;
    this._tmpCamDir.normalize();

    const origin = cam.position.clone();
    this.raycaster.set(origin, this._tmpCamDir);
    this.raycaster.far = Math.max(2, this.maxDistance + 3);

    const hits = this.raycaster.intersectObjects(this.roots, true);
    if (!hits || hits.length === 0) return null;

    for (const hit of hits) {
      const id = findInteractableId(hit.object);
      if (!id) continue;
      const entry = this.interactables.get(id);
      if (!entry || entry.enabled === false || entry.collected) continue;

      const dist = Number(hit.distance);
      const maxDist = this.getInteractDistanceFor(entry);
      if (!(dist <= maxDist)) continue;

      if (!this.hasLineOfSight(playerPos, entry)) continue;

      if (entry.canInteract) {
        try {
          if (!entry.canInteract({ actorKind: 'player', entry, playerPos })) continue;
        } catch (err) {
          console.warn('⚠️ Interactable canInteract failed:', err?.message || err);
          continue;
        }
      }

      return entry;
    }

    return null;
  }

  pickNearest(playerPos, maxDistance) {
    if (!isVec3(playerPos)) return null;
    const maxD = Number.isFinite(maxDistance) ? maxDistance : this.autoInteractDistance;
    if (!(maxD > 0)) return null;

    let best = null;
    let bestDistSq = maxD * maxD;
    for (const entry of this.interactables.values()) {
      if (!entry || entry.enabled === false || entry.collected) continue;
      const obj = entry.object3d;
      if (!obj) continue;
      const dx = obj.position.x - playerPos.x;
      const dz = obj.position.z - playerPos.z;
      const distSq = dx * dx + dz * dz;
      if (distSq > bestDistSq) continue;

      if (!this.hasLineOfSight(playerPos, entry)) continue;

      if (entry.canInteract) {
        try {
          if (!entry.canInteract({ actorKind: 'ai', entry, playerPos })) continue;
        } catch (err) {
          console.warn('⚠️ Interactable canInteract failed:', err?.message || err);
          continue;
        }
      }

      best = entry;
      bestDistSq = distSq;
    }
    return best;
  }

  tryInteract(entry, options = {}) {
    if (!entry || entry.enabled === false || entry.collected) return false;
    const actorKind = options.actorKind || 'player';
    const playerPos = options.playerPos || null;
    const nowMs = options.nowMs ?? performance.now();

    if (isVec3(playerPos) && !this.hasLineOfSight(playerPos, entry)) {
      if (actorKind === 'player') {
        this.eventBus?.emit?.(EVENTS.INTERACTABLE_HOVER, { id: entry.id, text: 'Blocked by wall' });
      }
      return false;
    }

    const maxDist = this.getInteractDistanceFor(entry);
    if (isVec3(playerPos) && entry.object3d) {
      const dx = entry.object3d.position.x - playerPos.x;
      const dz = entry.object3d.position.z - playerPos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > maxDist + 0.01) return false;
    }

    let result = null;
    if (entry.interact) {
      try {
        result = entry.interact({ actorKind, entry, playerPos, nowMs });
      } catch (err) {
        console.warn('⚠️ Interactable interact() failed:', err?.message || err);
        result = { ok: false, message: 'Interaction failed' };
      }
    } else {
      result = { ok: true };
    }

    const ok = !!result?.ok || result === true;
    const message = typeof result?.message === 'string' ? result.message : null;
    const picked = !!result?.picked;
    const remove = !!result?.remove || picked;

    if (picked) {
      entry.collected = true;
    }

    if (remove && entry.object3d) {
      entry.object3d.visible = false;
      try {
        this.scene?.remove?.(entry.object3d);
      } catch {
        // ignore
      }
      this.roots = this.roots.filter((o) => o !== entry.object3d);
    }

    this.eventBus?.emit?.(EVENTS.INTERACT, {
      actorKind,
      id: entry.id,
      kind: entry.kind,
      gridPos: entry.gridPos || null,
      ok,
      message,
      result: result || null,
      nowMs
    });

    if (picked) {
      this.eventBus?.emit?.(EVENTS.ITEM_PICKED, {
        actorKind,
        id: entry.id,
        kind: entry.kind,
        gridPos: entry.gridPos || null,
        message,
        nowMs
      });
    }

    // Clear hover if it was removed.
    if (remove && this.hoverId === entry.id) {
      this.setHover(null, '');
    }

    if (message && actorKind === 'player') {
      // Show feedback via the same hover prompt channel.
      this.eventBus?.emit?.(EVENTS.INTERACTABLE_HOVER, {
        id: entry.id,
        text: message
      });
    }

    return ok;
  }

  update(deltaTime, ctx = null) {
    void deltaTime;

    const cam = this.getCameraObject();
    if (!cam) {
      this.setHover(null, '');
      return;
    }

    const playerPos = ctx?.playerPos || null;
    const hovered = isVec3(playerPos) ? this.pickHovered(playerPos) : null;
    const hoverText = hovered ? this.buildPrompt(hovered, { actorKind: 'player' }) : '';
    this.setHover(hovered?.id || null, hoverText);

    const input = this.input;
    const wantsManual = !!input?.consumeKeyPress?.('KeyE');
    const interactCmd = ctx?.externalCommand?.interact;
    const wantsAuto = interactCmd === true || typeof interactCmd === 'string';
    if (!wantsManual && !wantsAuto) return;

    if (wantsManual) {
      if (!hovered) return;
      this.tryInteract(hovered, {
        actorKind: 'player',
        playerPos,
        nowMs: ctx?.nowMs
      });
      return;
    }

    // Autopilot / AI: allow proximity interact without strict raycast aiming.
    if (typeof interactCmd === 'string') {
      const wantedId = interactCmd.trim();
      if (!wantedId) return;
      const wanted = this.get(wantedId);
      if (!wanted) return;
      this.tryInteract(wanted, {
        actorKind: 'ai',
        playerPos,
        nowMs: ctx?.nowMs
      });
      return;
    }

    const target = hovered || this.pickNearest(playerPos, this.autoInteractDistance);
    if (!target) return;
    this.tryInteract(target, {
      actorKind: 'ai',
      playerPos,
      nowMs: ctx?.nowMs
    });
  }
}
