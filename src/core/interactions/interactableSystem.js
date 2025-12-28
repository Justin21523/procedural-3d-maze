import * as THREE from 'three';
import { EVENTS } from '../events.js';
import { CONFIG } from '../config.js';

function isVec3(v) {
  return !!v && typeof v.x === 'number' && typeof v.y === 'number' && typeof v.z === 'number';
}

function normalizeItemId(itemId) {
  const id = String(itemId || '').trim();
  return id ? id : null;
}

function toCount(value, fallback = 1) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, n);
}

function normalizeItemSpec(spec) {
  if (!spec) return [];
  if (typeof spec === 'string') {
    const itemId = normalizeItemId(spec);
    return itemId ? [{ itemId, count: 1, message: '' }] : [];
  }
  if (Array.isArray(spec)) {
    const out = [];
    for (const entry of spec) {
      out.push(...normalizeItemSpec(entry));
    }
    return out;
  }
  if (typeof spec === 'object') {
    const itemId = normalizeItemId(spec.itemId ?? spec.id);
    if (itemId) {
      const count = toCount(spec.count, 1);
      if (count <= 0) return [];
      const message = typeof spec.message === 'string' ? spec.message : '';
      const label = typeof spec.label === 'string' ? spec.label : '';
      return [{ itemId, count, message, label }];
    }

    // Treat plain objects like `{ fuse: 3, evidence: 2 }`.
    const out = [];
    for (const [k, v] of Object.entries(spec)) {
      const id = normalizeItemId(k);
      if (!id) continue;
      const count = toCount(v, 0);
      if (count <= 0) continue;
      out.push({ itemId: id, count, message: '', label: '' });
    }
    return out;
  }

  return [];
}

function mergeItemSpecs(list) {
  const merged = new Map(); // itemId -> { itemId, count, message, label }
  for (const entry of list) {
    const itemId = normalizeItemId(entry?.itemId);
    if (!itemId) continue;
    const count = toCount(entry?.count, 1);
    if (count <= 0) continue;

    const message = typeof entry?.message === 'string' ? entry.message : '';
    const label = typeof entry?.label === 'string' ? entry.label : '';

    const prev = merged.get(itemId);
    if (!prev) {
      merged.set(itemId, { itemId, count, message, label });
      continue;
    }

    prev.count = Math.max(prev.count || 0, count);
    if (!prev.message && message) prev.message = message;
    if (!prev.label && label) prev.label = label;
  }
  return Array.from(merged.values());
}

function defaultItemLabel(itemId) {
  return String(itemId || '').replaceAll('_', ' ').trim() || String(itemId || '');
}

function buildMissingItemMessage(req, have) {
  const message = typeof req?.message === 'string' ? req.message : '';
  if (message) return message;
  const itemLabel = req?.label || defaultItemLabel(req?.itemId);
  const need = toCount(req?.count, 1);
  const got = toCount(have, 0);
  return `Need ${need}× ${itemLabel} (${got}/${need})`;
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

    const requiresItem = normalizeItemSpec(interactable.requiresItem);
    const consumeItemRaw = interactable.consumeItem === true ? interactable.requiresItem : interactable.consumeItem;
    const consumeItem = normalizeItemSpec(consumeItemRaw);

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
      requiresItem,
      consumeItem,
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

    const bus = this.eventBus;
    const requirements = mergeItemSpecs([...(entry.requiresItem || []), ...(entry.consumeItem || [])]);
    if (bus?.emit && requirements.length > 0) {
      for (const req of requirements) {
        const q = { itemId: req.itemId, result: null };
        bus.emit(EVENTS.INVENTORY_QUERY_ITEM, q);
        const have = Number(q.result?.count) || 0;
        const need = Number(req.count) || 1;
        if (have >= need) continue;

        const message = buildMissingItemMessage(req, have);
        if (actorKind === 'player') {
          bus.emit(EVENTS.INTERACTABLE_HOVER, { id: entry.id, text: message });
        }

        bus.emit(EVENTS.INTERACT, {
          actorKind,
          id: entry.id,
          kind: entry.kind,
          gridPos: entry.gridPos || null,
          ok: false,
          message,
          result: {
            ok: false,
            blocked: true,
            reason: 'requires_item',
            itemId: req.itemId,
            required: need,
            have
          },
          nowMs
        });

        return false;
      }
    }

    const consumedItems = [];
    if (bus?.emit && Array.isArray(entry.consumeItem) && entry.consumeItem.length > 0) {
      for (const spec of entry.consumeItem) {
        const itemId = normalizeItemId(spec?.itemId);
        if (!itemId) continue;
        const count = toCount(spec?.count, 1);
        if (count <= 0) continue;

        const consumePayload = { actorKind, itemId, count, result: null };
        bus.emit(EVENTS.INVENTORY_CONSUME_ITEM, consumePayload);
        const ok = !!consumePayload.result?.ok;
        const consumed = Number(consumePayload.result?.consumed) || 0;
        if (!ok || consumed <= 0) {
          // Refund any prior consumption and abort without calling entry.interact().
          for (const refund of consumedItems) {
            bus.emit(EVENTS.INVENTORY_GIVE_ITEM, { actorKind, itemId: refund.itemId, count: refund.count });
          }
          const have = Number(consumePayload.result?.remaining) || 0;
          const required = Number(consumePayload.result?.required) || count;
          const message = buildMissingItemMessage({ itemId, count: required, message: spec?.message, label: spec?.label }, have);
          if (actorKind === 'player') {
            bus.emit(EVENTS.INTERACTABLE_HOVER, { id: entry.id, text: message });
          }
          bus.emit(EVENTS.INTERACT, {
            actorKind,
            id: entry.id,
            kind: entry.kind,
            gridPos: entry.gridPos || null,
            ok: false,
            message,
            result: {
              ok: false,
              blocked: true,
              reason: 'consume_failed',
              itemId,
              required,
              have
            },
            nowMs
          });
          return false;
        }
        consumedItems.push({ itemId, count: consumed });
      }
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

    if (!ok && bus?.emit && consumedItems.length > 0) {
      // Roll back inventory consumption if the interaction itself failed.
      for (const refund of consumedItems) {
        bus.emit(EVENTS.INVENTORY_GIVE_ITEM, { actorKind, itemId: refund.itemId, count: refund.count });
      }
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
      if (hovered) {
        this.tryInteract(hovered, {
          actorKind: 'player',
          playerPos,
          nowMs: ctx?.nowMs
        });
        return;
      }

      const forcedId = String(ctx?.forcedInteractId || '').trim();
      if (forcedId) {
        const forced = this.get(forcedId);
        if (forced) {
          this.tryInteract(forced, {
            actorKind: 'player',
            playerPos,
            nowMs: ctx?.nowMs
          });
        }
      }
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
