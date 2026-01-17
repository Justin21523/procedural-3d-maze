import * as THREE from 'three';
import { CONFIG } from './config.js';
import { EVENTS } from './events.js';
import { MonsterTypes } from '../ai/monsterTypes.js';

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function manhattan(a, b) {
  if (!a || !b) return Infinity;
  return Math.abs((a.x || 0) - (b.x || 0)) + Math.abs((a.y || 0) - (b.y || 0));
}

function pickRandom(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

export class BossSystem {
  constructor(options = {}) {
    this.eventBus = options.eventBus || null;
    this.worldState = options.worldState || null;
    this.monsterManager = options.monsterManager || null;
    this.deviceManager = options.deviceManager || null;
    this.gameState = options.gameState || null;
    this.audioManager = options.audioManager || null;

    this.levelConfig = null;
    this.enabled = true;

    this.state = this.defaultState();
    this.unsubs = [];
    this.bind();
  }

  defaultState() {
    return {
      active: false,
      phase: 0, // 0 none, 1 shield, 2 core, 3 escape
      bossId: null,
      bossSpawnGrid: null,
      nodeTiles: [],
      bossMaxHealth: 0,
      bossHealth: 0,
      shieldActive: false,
      nodesTotal: 0,
      nodesRemaining: 0,
      escapeSeconds: 0,
      escapeUntilSec: 0,
      escapeStartedAtSec: 0
    };
  }

  setRefs({ eventBus, worldState, monsterManager, deviceManager, gameState, audioManager } = {}) {
    if (eventBus) this.eventBus = eventBus;
    if (worldState) this.worldState = worldState;
    if (monsterManager) this.monsterManager = monsterManager;
    if (deviceManager) this.deviceManager = deviceManager;
    if (gameState) this.gameState = gameState;
    if (audioManager) this.audioManager = audioManager;
    this.bind();
  }

  bind() {
    this.unsubs.forEach((fn) => fn?.());
    this.unsubs = [];
    const bus = this.eventBus;
    if (!bus?.on) return;

    this.unsubs.push(bus.on(EVENTS.DEVICE_DESTROYED, (payload) => this.onDeviceDestroyed(payload)));
    this.unsubs.push(bus.on(EVENTS.MONSTER_KILLED, (payload) => this.onMonsterKilled(payload)));
    this.unsubs.push(bus.on(EVENTS.TIMER_TICK, (payload) => this.onTimerTick(payload)));
  }

  clear() {
    this.levelConfig = null;
    this.state = this.defaultState();
  }

  async startLevel(levelConfig = null) {
    this.clear();
    this.levelConfig = levelConfig || null;
    if (!this.enabled) return;

    const bossCfg = levelConfig?.boss || null;
    const enabled = bossCfg?.enabled === true;
    if (!enabled) return;

    await this.startBossFight(bossCfg);
  }

  emitBossUpdate(reason = '') {
    this.eventBus?.emit?.(EVENTS.BOSS_UPDATED, { ...this.getState(), reason: String(reason || '') });
  }

  getState() {
    return { ...this.state, nodeTiles: Array.isArray(this.state.nodeTiles) ? this.state.nodeTiles.map((t) => ({ x: t.x, y: t.y })) : [] };
  }

  getBossMonster() {
    const id = this.state.bossId;
    if (!id) return null;
    const list = this.monsterManager?.getMonsters?.() || [];
    for (const m of list) {
      if (!m || m.isDead || m.isDying) continue;
      if (m.id === id) return m;
    }
    return null;
  }

  pickBossSpawnGrid() {
    const ws = this.worldState;
    if (!ws) return null;
    const spawn = ws.getSpawnPoint?.() || null;
    const exit = ws.getExitPoint?.() || null;

    const rooms = ws.getRooms?.() || [];
    const candidates = [];
    for (const r of rooms) {
      if (!r) continue;
      const cx = Math.floor((Number(r?.x) || 0) + (Number(r?.width) || 1) / 2);
      const cy = Math.floor((Number(r?.y) || 0) + (Number(r?.height) || 1) / 2);
      if (!ws.isWalkable?.(cx, cy)) continue;
      const dSpawn = spawn ? manhattan({ x: cx, y: cy }, spawn) : 999;
      const dExit = exit ? manhattan({ x: cx, y: cy }, exit) : 999;
      const score = dSpawn * 1.2 + dExit * 0.35 + Math.random() * 0.5;
      candidates.push({ x: cx, y: cy, score });
    }
    candidates.sort((a, b) => (b.score || 0) - (a.score || 0));
    const pick = candidates[0] || ws.findRandomWalkableTile?.() || spawn || null;
    return pick ? { x: pick.x, y: pick.y } : null;
  }

  pickShieldNodeTiles(count, avoid = []) {
    const ws = this.worldState;
    if (!ws) return [];
    const spawn = ws.getSpawnPoint?.() || null;
    const exit = ws.getExitPoint?.() || null;
    const rooms = ws.getRooms?.() || [];

    const minSpawnDist = Math.max(6, Math.round(Number(CONFIG.BOSS_NODE_MIN_DIST_FROM_SPAWN) || 10));
    const minExitDist = Math.max(4, Math.round(Number(CONFIG.BOSS_NODE_MIN_DIST_FROM_EXIT) || 6));

    const candidates = [];
    for (const r of rooms) {
      if (!r) continue;
      const tiles = Array.isArray(r.tiles) ? r.tiles : [];
      const center = {
        x: Math.floor((Number(r?.x) || 0) + (Number(r?.width) || 1) / 2),
        y: Math.floor((Number(r?.y) || 0) + (Number(r?.height) || 1) / 2)
      };

      const sample = tiles.length > 0 ? pickRandom(tiles) : center;
      const x = sample?.x ?? center.x;
      const y = sample?.y ?? center.y;
      if (!ws.isWalkable?.(x, y)) continue;
      if (spawn && manhattan({ x, y }, spawn) < minSpawnDist) continue;
      if (exit && manhattan({ x, y }, exit) < minExitDist) continue;

      let tooClose = false;
      for (const a of avoid) {
        if (!a) continue;
        if (manhattan({ x, y }, a) < 4) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;
      candidates.push({ x, y, score: Math.random() });
    }
    if (candidates.length === 0) {
      const out = [];
      for (let i = 0; i < count; i++) {
        const t = ws.findRandomWalkableTile?.();
        if (t) out.push({ x: t.x, y: t.y });
      }
      return out;
    }

    const out = [];
    while (out.length < count && candidates.length > 0) {
      const pick = candidates.splice(Math.floor(Math.random() * candidates.length), 1)[0];
      if (!pick) break;
      out.push({ x: pick.x, y: pick.y });
    }
    return out;
  }

  async startBossFight(bossCfg = {}) {
    const ws = this.worldState;
    const mm = this.monsterManager;
    const dm = this.deviceManager;
    if (!ws || !mm || !dm) return;

    const typeId = String(bossCfg?.typeId || 'BOSS_CORE').trim();
    const bossType = MonsterTypes?.[typeId] || MonsterTypes?.BOSS_CORE || null;
    const nodeCount = clamp(Math.round(Number(bossCfg?.shieldNodes ?? CONFIG.BOSS_SHIELD_NODES ?? 3)), 1, 8);
    const escapeSeconds = clamp(Math.round(Number(bossCfg?.escapeSeconds ?? CONFIG.BOSS_ESCAPE_SECONDS ?? 35)), 10, 180);

    const bossGrid = this.pickBossSpawnGrid();
    if (!bossGrid) return;

    // Spawn shield nodes first so they show up on markers quickly.
    const nodeTiles = this.pickShieldNodeTiles(nodeCount, [bossGrid]);
    const tileSize = CONFIG.TILE_SIZE || 1;
    for (const tile of nodeTiles) {
      const pos = new THREE.Vector3(tile.x * tileSize + tileSize / 2, 0.15, tile.y * tileSize + tileSize / 2);
      dm.spawnBossShieldNode?.(pos, tile, { bossKey: `boss:${String(this.levelConfig?.id || '')}` });
    }

    // Spawn boss monster (excluded from SpawnDirector counts via isBoss flag).
    await mm.spawnAtGrid?.(bossGrid, bossType);

    // Find the newly spawned boss: take the closest to our desired spawn tile.
    const monsters = mm.getMonsters?.() || [];
    let boss = null;
    let bestDist = Infinity;
    for (const m of monsters) {
      if (!m || m.isDead || m.isDying) continue;
      if (m.typeConfig?.id !== bossType?.id) continue;
      const g = m.getGridPosition?.();
      if (!g) continue;
      const d = manhattan(g, bossGrid);
      if (d < bestDist) {
        bestDist = d;
        boss = m;
      }
    }
    if (!boss) return;

    boss.isBoss = true;
    boss.boss = {
      shieldActive: true,
      shieldNodesTotal: nodeCount,
      shieldNodesRemaining: nodeCount
    };

    // Beefy health pool (keeps visuals consistent even if configs change).
    const baseHp = Math.max(40, Math.round(Number(CONFIG.BOSS_CORE_HEALTH) || 120));
    boss.maxHealth = baseHp;
    boss.health = baseHp;

    this.state = {
      active: true,
      phase: 1,
      bossId: boss.id,
      bossSpawnGrid: bossGrid,
      nodeTiles: nodeTiles.map((t) => ({ x: t.x, y: t.y })),
      bossMaxHealth: boss.maxHealth,
      bossHealth: boss.health,
      shieldActive: true,
      nodesTotal: nodeCount,
      nodesRemaining: nodeCount,
      escapeSeconds,
      escapeUntilSec: 0,
      escapeStartedAtSec: 0
    };

    this.audioManager?.playObjectiveChime?.();
    this.emitBossUpdate('spawned');
  }

  onDeviceDestroyed(payload) {
    if (!this.state.active) return;
    const kind = String(payload?.kind || '').trim();
    if (kind !== 'bossShieldNode') return;
    if (this.state.phase !== 1) return;

    this.state.nodesRemaining = Math.max(0, (this.state.nodesRemaining || 0) - 1);
    const gp = payload?.gridPos;
    if (gp && Number.isFinite(gp.x) && Number.isFinite(gp.y) && Array.isArray(this.state.nodeTiles)) {
      this.state.nodeTiles = this.state.nodeTiles.filter((t) => !(t && t.x === gp.x && t.y === gp.y));
    }
    const boss = this.getBossMonster();
    if (boss?.boss) {
      boss.boss.shieldNodesRemaining = this.state.nodesRemaining;
    }

    if (this.state.nodesRemaining <= 0) {
      this.state.phase = 2;
      this.state.shieldActive = false;
      if (boss?.boss) boss.boss.shieldActive = false;
      this.audioManager?.playObjectiveChime?.();
      this.emitBossUpdate('shieldDown');
      return;
    }

    this.emitBossUpdate('nodeDestroyed');
  }

  onMonsterKilled(payload) {
    if (!this.state.active) return;
    const monster = payload?.monster || null;
    if (!monster || monster.id !== this.state.bossId) return;

    this.state.phase = 3;
    this.state.bossHealth = 0;
    this.state.escapeStartedAtSec = performance.now() / 1000;
    this.state.escapeUntilSec = this.state.escapeStartedAtSec + (this.state.escapeSeconds || 35);

    this.audioManager?.playObjectiveChime?.();
    this.audioManager?.playAlarmBeep?.();
    this.emitBossUpdate('bossDefeated');
  }

  onTimerTick(payload) {
    if (!this.state.active) return;
    const elapsedSec = Number(payload?.elapsedSec);
    if (!Number.isFinite(elapsedSec)) return;

    const boss = this.getBossMonster();
    if (boss) {
      this.state.bossHealth = Math.max(0, Math.round(Number(boss.health) || 0));
      this.state.bossMaxHealth = Math.max(1, Math.round(Number(boss.maxHealth) || 1));
    }

    if (this.state.phase === 3 && (this.state.escapeUntilSec || 0) > 0) {
      const remaining = this.state.escapeUntilSec - (performance.now() / 1000);
      if (remaining <= 0) {
        // Let MissionDirector/Exit handle messaging; just trigger a hard fail.
        this.gameState?.lose?.('Lockdown complete — failed to escape');
      } else if (remaining <= 10 && Math.random() < 0.55) {
        this.audioManager?.playAlarmBeep?.();
      }
    }

    this.emitBossUpdate('tick');
  }

  dispose() {
    this.unsubs.forEach((fn) => fn?.());
    this.unsubs = [];
    this.clear();
  }
}
