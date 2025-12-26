import { CONFIG } from '../../core/config.js';
import { createMonsterMix } from '../../ai/monsterTypes.js';
import { createSpriteBillboard } from '../monsterSprite.js';

export class MonsterSpawner {
  constructor(manager, modelSelector) {
    this.manager = manager;
    this.modelSelector = modelSelector;

    this.respawnDelay = CONFIG.MONSTER_RESPAWN_DELAY ?? 0.6;
    this.autoRespawnEnabled = true;
    this.pendingRespawns = [];
  }

  getMaxAliveMonsters() {
    const manager = this.manager;
    const fromLevel = manager?.levelConfig?.monsters?.maxCount;
    const fromConfig = CONFIG.MONSTER_MAX_COUNT;
    const max = fromLevel ?? fromConfig ?? Infinity;
    return Number.isFinite(max) ? Math.max(0, max) : Infinity;
  }

  getAliveCount() {
    const monsters = this.manager?.monsters || [];
    let alive = 0;
    for (const m of monsters) {
      if (!m) continue;
      if (m.isDead) continue;
      alive += 1;
    }
    return alive;
  }

  setAutoRespawnEnabled(enabled) {
    this.autoRespawnEnabled = !!enabled;
  }

  setRespawnDelay(seconds) {
    const s = Number.isFinite(seconds) ? seconds : null;
    if (s !== null) {
      this.respawnDelay = Math.max(0, s);
    }
  }

  clear() {
    this.pendingRespawns = [];
  }

  queueRespawn(typeConfig) {
    if (!this.autoRespawnEnabled) return;
    this.pendingRespawns.push({
      timer: this.respawnDelay,
      typeConfig
    });
  }

  updateRespawns(dt) {
    for (let i = this.pendingRespawns.length - 1; i >= 0; i--) {
      const entry = this.pendingRespawns[i];
      entry.timer -= dt;
      if (entry.timer <= 0) {
        const typeConfig = entry.typeConfig || createMonsterMix(1)[0];
        this.spawnReplacement(typeConfig);
        this.pendingRespawns.splice(i, 1);
      }
    }
  }

  manhattan(a, b) {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }

  getPlayerSpawnGrid() {
    const manager = this.manager;
    const grid = manager.playerRef?.getGridPosition?.();
    if (grid && Number.isFinite(grid.x) && Number.isFinite(grid.y)) return grid;
    return manager.worldState?.getSpawnPoint?.() || null;
  }

  pickSpreadOutSpawn(occupied = [], options = {}) {
    const manager = this.manager;
    const ws = manager.worldState;
    if (!ws?.findRandomWalkableTile) {
      return ws?.getSpawnPoint?.() || { x: 1, y: 1 };
    }

    const playerGrid = this.getPlayerSpawnGrid();
    const maxDim = Math.max(ws?.width || 0, ws?.height || 0) || 32;

    const baseMinPlayerDist =
      options.minPlayerDist ??
      Math.max(3, Math.floor(maxDim * 0.25));

    const baseMinOtherDist =
      options.minOtherDist ??
      Math.max(2, Math.floor(maxDim * 0.18));

    const margin = options.margin ?? 1;
    const baseSamples = options.samples ?? 220;

    const occupiedSet = new Set(
      (occupied || []).map(p => `${p.x},${p.y}`)
    );

    const passes = [
      { minPlayerDist: baseMinPlayerDist + 2, minOtherDist: baseMinOtherDist + 2, samples: baseSamples },
      { minPlayerDist: baseMinPlayerDist + 1, minOtherDist: baseMinOtherDist + 1, samples: baseSamples + 60 },
      { minPlayerDist: baseMinPlayerDist, minOtherDist: baseMinOtherDist, samples: baseSamples + 120 },
      { minPlayerDist: Math.max(2, baseMinPlayerDist - 1), minOtherDist: Math.max(1, baseMinOtherDist - 1), samples: baseSamples + 200 },
      { minPlayerDist: 0, minOtherDist: 0, samples: baseSamples + 320 },
    ];

    for (const pass of passes) {
      let best = null;

      for (let i = 0; i < pass.samples; i++) {
        const tile = ws.findRandomWalkableTile();
        if (!tile) continue;
        const key = `${tile.x},${tile.y}`;
        if (occupiedSet.has(key)) continue;

        if (margin > 0 && ws.isWalkableWithMargin) {
          if (!ws.isWalkableWithMargin(tile.x, tile.y, margin)) continue;
        }

        const distToPlayer = playerGrid ? this.manhattan(tile, playerGrid) : 9999;
        if (distToPlayer < pass.minPlayerDist) continue;

        let minDistToOthers = Infinity;
        for (const pos of occupied) {
          const d = this.manhattan(tile, pos);
          if (d < minDistToOthers) minDistToOthers = d;
        }

        if (Number.isFinite(minDistToOthers) && minDistToOthers < pass.minOtherDist) {
          continue;
        }

        const spreadScore = Number.isFinite(minDistToOthers) ? minDistToOthers : maxDim;
        const score = spreadScore * 4.0 + distToPlayer * 1.5 + Math.random() * 0.25;

        if (!best || score > best.score) {
          best = { x: tile.x, y: tile.y, score };
        }
      }

      if (best) {
        return { x: best.x, y: best.y };
      }
    }

    const spawns = ws?.getMonsterSpawns?.() || [];
    const available = spawns.filter(p => !occupiedSet.has(`${p.x},${p.y}`));
    if (available.length > 0) {
      return available[Math.floor(Math.random() * available.length)];
    }

    return ws.findRandomWalkableTile() || playerGrid || { x: 1, y: 1 };
  }

  pickRespawnPoint() {
    const existing = this.manager.getMonsterPositions?.() || [];
    return this.pickSpreadOutSpawn(existing);
  }

  async spawnAtGrid(spawnPosition, typeConfig = null) {
    if (!spawnPosition) return;
    const manager = this.manager;
    const levelConfig = manager.levelConfig;
    const maxAlive = this.getMaxAliveMonsters();
    if (Number.isFinite(maxAlive) && this.getAliveCount() >= maxAlive) {
      return;
    }

    if (!(CONFIG.MONSTER_USE_ASSET_MODELS ?? true)) {
      manager.spawnPlaceholderMonster(spawnPosition, typeConfig, levelConfig);
      return;
    }

    try {
      const manifest = await this.modelSelector.loadManifest();
      const enemyModelPool = this.modelSelector.pickModelPool(manifest);
      const modelPath = this.modelSelector.pickFromBag(enemyModelPool);

      if (modelPath) {
        const { model, animations } = await manager.modelLoader.loadModelWithAnimations(modelPath);
        await manager.spawnMonster(model, animations, spawnPosition, typeConfig, levelConfig, null, { modelPath });
        return;
      }

      const spriteResult = createSpriteBillboard({
        path: typeConfig?.sprite || '/models/monster.png',
        framesFolder: typeConfig?.spriteFramesPath ?? '../assets/moonman-sequence',
        frameRate: typeConfig?.spriteFrameRate ?? 8,
        randomStart: true,
        clipLengthRange: { min: 20, max: 60 },
        scale: { x: 1.5, y: 2.5 }
      });
      const spriteGroup = spriteResult.group || spriteResult;
      await manager.spawnMonster(
        spriteGroup,
        [],
        spawnPosition,
        typeConfig,
        levelConfig,
        spriteResult.updateAnimation
      );
    } catch (err) {
      console.warn('⚠️ Directed spawn failed, using placeholder', err?.message || err);
      manager.spawnPlaceholderMonster(spawnPosition, typeConfig, levelConfig);
    }
  }

  async spawnReplacement(typeConfig) {
    const manager = this.manager;
    const spawn = this.pickRespawnPoint();
    if (!spawn) return;
    const maxAlive = this.getMaxAliveMonsters();
    if (Number.isFinite(maxAlive) && this.getAliveCount() >= maxAlive) {
      return;
    }

    if (!(CONFIG.MONSTER_USE_ASSET_MODELS ?? true)) {
      manager.spawnPlaceholderMonster(spawn, typeConfig, manager.levelConfig);
      return;
    }

    try {
      const manifest = await this.modelSelector.loadManifest();
      const enemyModelPool = this.modelSelector.pickModelPool(manifest);
      const modelPath = this.modelSelector.pickFromBag(enemyModelPool);

      if (modelPath) {
        console.log(`   🎲 Replacement model: ${modelPath}`);
        const { model, animations } = await manager.modelLoader.loadModelWithAnimations(modelPath);
        await manager.spawnMonster(model, animations, spawn, typeConfig, manager.levelConfig, null, { modelPath });
      } else {
        const spriteResult = createSpriteBillboard({
          path: typeConfig?.sprite || '/models/monster.png',
          framesFolder: typeConfig?.spriteFramesPath ?? '../assets/moonman-sequence',
          frameRate: typeConfig?.spriteFrameRate ?? 8,
          randomStart: true,
          clipLengthRange: { min: 20, max: 60 },
          scale: { x: 1.5, y: 2.5 }
        });
        const spriteGroup = spriteResult.group || spriteResult;
        await manager.spawnMonster(
          spriteGroup,
          [],
          spawn,
          typeConfig,
          manager.levelConfig,
          spriteResult.updateAnimation
        );
      }
    } catch (err) {
      console.warn('⚠️ Replacement spawn failed, using placeholder', err?.message || err);
      manager.spawnPlaceholderMonster(spawn, typeConfig);
    }
  }
}
