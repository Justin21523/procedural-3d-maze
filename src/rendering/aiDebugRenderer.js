import * as THREE from 'three';
import { CONFIG } from '../core/config.js';

const DEFAULT_UPDATE_MS = 250;

function gridCenterToWorld(grid) {
  if (!grid || !Number.isFinite(grid.x) || !Number.isFinite(grid.y)) return null;
  const tileSize = Number(CONFIG.TILE_SIZE) || 1;
  return new THREE.Vector3(
    (grid.x + 0.5) * tileSize,
    0.08,
    (grid.y + 0.5) * tileSize
  );
}

function getMonsterWorldPos(monsterWorldPos) {
  if (!monsterWorldPos) return null;
  if (typeof monsterWorldPos.clone === 'function') return monsterWorldPos.clone();
  if (Number.isFinite(monsterWorldPos.x) && Number.isFinite(monsterWorldPos.y) && Number.isFinite(monsterWorldPos.z)) {
    return new THREE.Vector3(monsterWorldPos.x, monsterWorldPos.y, monsterWorldPos.z);
  }
  return null;
}

export class AIDebugRenderer {
  constructor({ scene, monsterManager }) {
    this.scene = scene;
    this.monsterManager = monsterManager;
    this.enabled = false;
    this.timer = null;
    this.linesByMonsterId = new Map();

    this.group = new THREE.Group();
    this.group.name = 'ai-debug-lines';
    this.group.visible = false;
    this.scene?.add?.(this.group);

    this.materials = {
      path: new THREE.LineBasicMaterial({ color: 0x00dcff, transparent: true, opacity: 0.65 }),
      target: new THREE.LineBasicMaterial({ color: 0x00dcff, transparent: true, opacity: 0.9 }),
      lastKnown: new THREE.LineBasicMaterial({ color: 0xffeb3b, transparent: true, opacity: 0.85 }),
      noise: new THREE.LineBasicMaterial({ color: 0xff7043, transparent: true, opacity: 0.85 })
    };
  }

  _ensureLine(entry, key, material, maxPoints = 2) {
    if (entry[key]) return entry[key];
    const geo = new THREE.BufferGeometry();
    const size = Math.max(2, Math.round(Number(maxPoints) || 2));
    const arr = new Float32Array(size * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    geo.setDrawRange(0, 0);
    const line = new THREE.Line(geo, material);
    line.visible = false;
    entry[key] = line;
    this.group.add(line);
    return line;
  }

  _setSegment(line, from, to) {
    if (!line) return;
    if (!from || !to) {
      line.visible = false;
      return;
    }
    const attr = line.geometry?.getAttribute?.('position');
    if (!attr || !attr.array || attr.array.length < 6) {
      line.visible = false;
      return;
    }
    const a = attr.array;
    a[0] = from.x; a[1] = from.y; a[2] = from.z;
    a[3] = to.x;   a[4] = to.y;   a[5] = to.z;
    attr.needsUpdate = true;
    line.geometry.setDrawRange(0, 2);
    line.visible = true;
  }

  _setPolyline(line, points) {
    if (!line) return;
    if (!Array.isArray(points) || points.length < 2) {
      line.visible = false;
      return;
    }
    const attr = line.geometry?.getAttribute?.('position');
    if (!attr || !attr.array) {
      line.visible = false;
      return;
    }
    const maxPts = Math.floor(attr.array.length / 3);
    const n = Math.min(maxPts, points.length);
    if (n < 2) {
      line.visible = false;
      return;
    }
    const a = attr.array;
    for (let i = 0; i < n; i++) {
      const p = points[i];
      a[i * 3 + 0] = p.x;
      a[i * 3 + 1] = p.y;
      a[i * 3 + 2] = p.z;
    }
    attr.needsUpdate = true;
    line.geometry.setDrawRange(0, n);
    line.visible = true;
  }

  setEnabled(enabled) {
    const next = !!enabled;
    if (this.enabled === next) return;
    this.enabled = next;
    this.group.visible = next;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    if (next) {
      this.rebuild();
      const ms = Math.max(50, Math.round(Number(CONFIG.DEBUG_AI_3D_LINES_UPDATE_MS) || DEFAULT_UPDATE_MS));
      this.timer = setInterval(() => this.rebuild(), ms);
    } else {
      this.clearAll();
    }
  }

  clearAll() {
    if (!this.group) return;
    for (const entry of this.linesByMonsterId.values()) {
      for (const key of Object.keys(entry)) {
        const line = entry[key];
        if (!line) continue;
        line.visible = false;
        line.geometry?.dispose?.();
        if (line.parent) line.parent.remove(line);
      }
    }
    this.linesByMonsterId.clear();
  }

  rebuild() {
    if (!this.enabled || !this.group) return;
    const rows = this.monsterManager?.getAIDebug3DData?.({
      onlyChasing: CONFIG.DEBUG_AI_FILTER_CHASE_ONLY === true,
      onlyLeader: CONFIG.DEBUG_AI_FILTER_LEADER_ONLY === true,
      nearestN: Number(CONFIG.DEBUG_AI_FILTER_NEAREST_N) || 0
    }) || [];
    const seen = new Set();

    for (const r of rows) {
      const monsterPos = getMonsterWorldPos(r.worldPos);
      if (!monsterPos) continue;
      monsterPos.y = 0.08;
      const id = Number.isFinite(r.id) ? r.id : null;
      if (id === null) continue;
      seen.add(id);

      let entry = this.linesByMonsterId.get(id);
      if (!entry) {
        entry = {};
        this.linesByMonsterId.set(id, entry);
      }

      const targetPos = gridCenterToWorld(r.target);
      this._setSegment(this._ensureLine(entry, 'targetLine', this.materials.target, 2), monsterPos, targetPos);

      const lastKnownPos = gridCenterToWorld(r.lastKnown);
      this._setSegment(this._ensureLine(entry, 'lastKnownLine', this.materials.lastKnown, 2), monsterPos, lastKnownPos);

      const noisePos = gridCenterToWorld(r.lastNoise);
      this._setSegment(this._ensureLine(entry, 'noiseLine', this.materials.noise, 2), monsterPos, noisePos);

      const path = Array.isArray(r.path) ? r.path : null;
      const maxPts = Math.max(8, Math.round(Number(CONFIG.DEBUG_AI_3D_MAX_PATH_POINTS) || 64));
      const pathLine = this._ensureLine(entry, 'pathLine', this.materials.path, maxPts);
      if (path && path.length >= 2) {
        const pts = [];
        for (const g of path) {
          const p = gridCenterToWorld(g);
          if (p) pts.push(p);
        }
        this._setPolyline(pathLine, pts);
      } else {
        pathLine.visible = false;
      }
    }

    // Remove lines for monsters no longer in the debug set.
    for (const [id, entry] of this.linesByMonsterId.entries()) {
      if (seen.has(id)) continue;
      for (const key of Object.keys(entry)) {
        const line = entry[key];
        if (!line) continue;
        line.geometry?.dispose?.();
        if (line.parent) line.parent.remove(line);
      }
      this.linesByMonsterId.delete(id);
    }
  }

  dispose() {
    this.setEnabled(false);
    this.clearAll();
    if (this.group?.parent) this.group.parent.remove(this.group);
    for (const m of Object.values(this.materials || {})) {
      m?.dispose?.();
    }
    this.materials = null;
  }
}
