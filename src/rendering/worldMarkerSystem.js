import * as THREE from 'three';
import { CONFIG } from '../core/config.js';
import { EVENTS } from '../core/events.js';

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function normalizeKind(kind) {
  const k = String(kind || '').trim();
  return k ? k : 'unknown';
}

function hexToCss(hex) {
  const h = Number(hex);
  if (!Number.isFinite(h)) return '#ffffff';
  return `#${(h >>> 0).toString(16).padStart(6, '0')}`;
}

function createMarkerTexture({ label, color, size = 64 } = {}) {
  const s = Math.max(16, Math.round(Number(size) || 64));
  const canvas = document.createElement('canvas');
  canvas.width = s;
  canvas.height = s;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.clearRect(0, 0, s, s);

  const cx = s / 2;
  const cy = s / 2;
  const r = s * 0.42;

  // Glow
  const grd = ctx.createRadialGradient(cx, cy, r * 0.15, cx, cy, r);
  grd.addColorStop(0, 'rgba(255,255,255,0.95)');
  grd.addColorStop(0.25, `${hexToCss(color)}cc`);
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grd;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 1.12, 0, Math.PI * 2);
  ctx.fill();

  // Core disc
  ctx.fillStyle = hexToCss(color);
  ctx.globalAlpha = 0.92;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // Border
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = Math.max(2, Math.round(s * 0.05));
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  // Label
  const text = String(label || '').trim();
  if (text) {
    ctx.font = `bold ${Math.round(s * 0.34)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.fillText(text, cx + 1, cy + 2);
    ctx.fillStyle = 'rgba(255,255,255,0.98)';
    ctx.fillText(text, cx, cy);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export class WorldMarkerSystem {
  constructor(options = {}) {
    this.scene = options.scene || null;
    this.camera = options.camera || null;
    this.player = options.player || null;
    this.worldState = options.worldState || null;
    this.pickupManager = options.pickupManager || null;
    this.toolSystem = options.toolSystem || null;
    this.missionDirector = options.missionDirector || null;
    this.exitPoint = options.exitPoint || null;
    this.eventBus = options.eventBus || null;

    this.enabled = options.enabled !== false;
    this.maxDistance = Number.isFinite(options.maxDistance) ? options.maxDistance : 32;
    this.maxObjectiveDistance = Number.isFinite(options.maxObjectiveDistance) ? options.maxObjectiveDistance : 80;

    this.group = new THREE.Group();
    this.group.name = '__worldMarkers';
    this.group.visible = this.enabled;
    this.scene?.add?.(this.group);

    this.sprites = [];
    this.materialCache = new Map(); // key -> SpriteMaterial

    this._time = 0;
    this._tmpCamPos = new THREE.Vector3();
  }

  setRefs({ scene, camera, player, worldState, pickupManager, toolSystem, missionDirector, exitPoint, eventBus } = {}) {
    if (scene && scene !== this.scene) {
      try {
        this.scene?.remove?.(this.group);
      } catch {
        // ignore
      }
      this.scene = scene;
      this.scene?.add?.(this.group);
    }
    if (camera) this.camera = camera;
    if (player) this.player = player;
    if (worldState) this.worldState = worldState;
    if (pickupManager) this.pickupManager = pickupManager;
    if (toolSystem) this.toolSystem = toolSystem;
    if (missionDirector) this.missionDirector = missionDirector;
    if (exitPoint) this.exitPoint = exitPoint;
    if (eventBus) this.eventBus = eventBus;
  }

  dispose() {
    try {
      this.scene?.remove?.(this.group);
    } catch {
      // ignore
    }
    for (const sprite of this.sprites) {
      try {
        this.group.remove(sprite);
      } catch {
        // ignore
      }
    }
    this.sprites = [];
    for (const mat of this.materialCache.values()) {
      try {
        mat.map?.dispose?.();
      } catch {
        // ignore
      }
      try {
        mat.dispose?.();
      } catch {
        // ignore
      }
    }
    this.materialCache.clear();
  }

  emitToast(text, seconds = 1.4) {
    const msg = String(text || '').trim();
    if (!msg) return;
    this.eventBus?.emit?.(EVENTS.UI_TOAST, {
      text: msg,
      seconds: Number.isFinite(seconds) ? seconds : 1.4
    });
  }

  getMarkerStyle(type, kind) {
    const k = String(kind || '').toLowerCase();
    if (type === 'objective') {
      return { color: 0xffa726, label: '!' };
    }

    if (k === 'ammo') return { color: 0x66aaff, label: 'A' };
    if (k === 'health') return { color: 0x66ff99, label: 'H' };
    if (k === 'lure') return { color: 0xff7043, label: 'L' };
    if (k === 'trap') return { color: 0x42a5f5, label: 'T' };
    if (k === 'jammer') return { color: 0xba68c8, label: 'J' };
    if (k === 'decoy') return { color: 0xff5252, label: 'D' };
    if (k === 'smoke') return { color: 0xb0bec5, label: 'S' };
    if (k === 'flash') return { color: 0xfff59d, label: 'F' };
    if (k === 'sensor') return { color: 0x4dd0e1, label: 'R' };
    if (k === 'mine') return { color: 0xff1744, label: 'M' };

    if (type === 'device') return { color: 0xffffff, label: '●' };
    return { color: 0xffffff, label: '?' };
  }

  getMaterial(type, kind) {
    const key = `${type}:${normalizeKind(kind)}`;
    const cached = this.materialCache.get(key);
    if (cached) return cached;

    const style = this.getMarkerStyle(type, kind);
    const tex = createMarkerTexture(style);
    const mat = new THREE.SpriteMaterial({
      map: tex || null,
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      depthTest: false
    });
    this.materialCache.set(key, mat);
    return mat;
  }

  ensureSprites(count) {
    while (this.sprites.length < count) {
      const sprite = new THREE.Sprite(this.getMaterial('pickup', 'unknown'));
      sprite.visible = false;
      sprite.renderOrder = 9999;
      this.group.add(sprite);
      this.sprites.push(sprite);
    }
  }

  update(dt, ctx = null) {
    const delta = Number.isFinite(dt) ? dt : 0;
    this._time += Math.max(0, delta);

    const input = this.player?.input || null;
    if (input?.consumeKeyPress?.('KeyM')) {
      this.enabled = !this.enabled;
      this.group.visible = this.enabled;
      this.emitToast(this.enabled ? 'Markers ON [M]' : 'Markers OFF [M]', 1.0);
    }

    if (!this.enabled) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;

    const cam = this.camera?.getCamera ? this.camera.getCamera() : this.camera;
    if (cam?.getWorldPosition) {
      cam.getWorldPosition(this._tmpCamPos);
    } else if (cam?.position) {
      this._tmpCamPos.copy(cam.position);
    } else {
      this._tmpCamPos.set(0, 0, 0);
    }

    const markers = [];

    const pickupMarkers = this.pickupManager?.getPickupWorldMarkers?.() || [];
    for (const p of pickupMarkers) {
      if (!p?.position) continue;
      markers.push({
        type: 'pickup',
        kind: p.kind,
        position: p.position,
        y: 1.15,
        baseScale: 0.55,
        maxDistance: this.maxDistance
      });
    }

    const deviceMarkers = this.toolSystem?.getDeviceWorldMarkers?.() || [];
    for (const d of deviceMarkers) {
      if (!d?.position) continue;
      markers.push({
        type: 'device',
        kind: d.kind,
        position: d.position,
        y: 1.25,
        baseScale: 0.62,
        maxDistance: this.maxDistance
      });
    }

    const targets = this.missionDirector?.getAutopilotTargets ? this.missionDirector.getAutopilotTargets() : [];
    const tileSize = CONFIG.TILE_SIZE || 1;
    for (const t of targets) {
      const g = t?.gridPos || null;
      if (!g) continue;
      markers.push({
        type: 'objective',
        kind: 'objective',
        position: new THREE.Vector3((g.x + 0.5) * tileSize, 0, (g.y + 0.5) * tileSize),
        y: 1.75,
        baseScale: 0.82,
        maxDistance: this.maxObjectiveDistance
      });
    }

    this.ensureSprites(markers.length);

    for (let i = 0; i < this.sprites.length; i++) {
      const sprite = this.sprites[i];
      const m = markers[i] || null;
      if (!m) {
        sprite.visible = false;
        continue;
      }

      sprite.material = this.getMaterial(m.type, m.kind);
      sprite.position.copy(m.position);
      sprite.position.y = Number.isFinite(m.y) ? m.y : 1.2;

      const dist = sprite.position.distanceTo(this._tmpCamPos);
      const maxD = Number.isFinite(m.maxDistance) ? m.maxDistance : this.maxDistance;
      if (Number.isFinite(maxD) && maxD > 0 && dist > maxD) {
        sprite.visible = false;
        continue;
      }

      const mult = clamp(1.0, 2.35, 0.85 + dist * 0.06);
      const pulse = m.type === 'objective' ? (1 + Math.sin(this._time * 5.0) * 0.08) : 1.0;
      const s = Math.max(0.2, (Number(m.baseScale) || 0.55) * mult * pulse);
      sprite.scale.set(s, s, 1);
      sprite.visible = true;
    }

    // Hide extras (if any)
    for (let i = markers.length; i < this.sprites.length; i++) {
      this.sprites[i].visible = false;
    }

    void ctx;
  }
}

