import * as THREE from 'three';
import { Pathfinding } from './pathfinding.js';
import { CONFIG } from '../core/config.js';

/**
 * AutoPilot: produces movement/look commands for the player
 * based on mission points, exit, and monster avoidance.
 */
export class AutoPilot {
  constructor(worldState, monsterManager, missionPointsRef, exitPointRef, playerController, levelConfig = null) {
    this.worldState = worldState;
    this.monsterManager = monsterManager;
    this.missionPointsRef = missionPointsRef; // function or array reference
    this.exitPointRef = exitPointRef;         // function or object with getGridPosition
    this.playerController = playerController;

    this.pathfinder = new Pathfinding(worldState);
    this.currentPath = [];
    this.currentTarget = null;   // 目前鎖定的格子
    this.targetType = 'mission'; // mission | exit | explore
    this.lastPlanTime = 0;
    // 規劃頻率（秒）— 可以用 CONFIG 覆蓋
    const apCfg = levelConfig?.autopilot || {};
    const defaultPlanInterval = CONFIG.AUTOPILOT_REPLAN_INTERVAL ?? 0.6;
    this.planInterval = apCfg.replanInterval ?? defaultPlanInterval;
    // 避怪半徑（格）
    this.avoidDistance = apCfg.avoidRadius ?? CONFIG.AUTOPILOT_AVOID_RADIUS ?? 5;
    this.enabled = false;

    // 探索記憶：避免一直在同一區域打轉
    this.visitedTiles = new Map(); // key -> timestamp(ms)
    this.visitTTL = CONFIG.AUTOPILOT_VISIT_TTL || 60_000; // 一格記憶 60 秒後才會被當成「可再走」

    // 探索偏好：盡量挑遠、沒走過的地方
    this.minExploreDistance = CONFIG.AUTOPILOT_MIN_EXPLORE_DIST || 18; // 最少距離，才當作「值得走的遠目標」
    this.explorationSamples = CONFIG.AUTOPILOT_EXPLORE_SAMPLES || 80; // 每次隨機抽樣幾個 walkable tile 來評分

    // 卡住偵測
    this.lastGrid = null;
    this.stuckTimer = 0;
    this.stuckThreshold = apCfg.stuckSeconds ?? 1.2;
    this.noProgressThreshold = apCfg.noProgressSeconds ?? 0.8;
    this.lastWorldPos = null;
    this.noProgressTimer = 0;
  }

  setEnabled(enabled) {
    this.enabled = enabled;
  }

  /**
   * 產生格子 key
   */
  posKey(pos) {
    return `${pos.x},${pos.y}`;
  }

  /**
   * 記錄目前所在格子並清理過期記憶
   */
  recordVisit(gridPos) {
    const now = Date.now();
    const key = this.posKey(gridPos);
    this.visitedTiles.set(key, now);

    // 清掉太久沒用到的記憶，避免 map 無限長大
    const expireBefore = now - this.visitTTL;
    for (const [k, ts] of this.visitedTiles.entries()) {
      if (ts < expireBefore) {
        this.visitedTiles.delete(k);
      }
    }
  }

  resetPath() {
    this.currentPath = [];
    this.currentTarget = null;
    this.lastPlanTime = 0;
  }

  /**
   * Compute avoidance grid: mark tiles near monsters as blocked
   */
  buildAvoidanceMask() {
    const mask = new Set();
    if (!this.monsterManager) return mask;
    const monsters = this.monsterManager.getMonsterPositions();
    monsters.forEach(m => {
      for (let dy = -this.avoidDistance; dy <= this.avoidDistance; dy++) {
        for (let dx = -this.avoidDistance; dx <= this.avoidDistance; dx++) {
          const x = m.x + dx;
          const y = m.y + dy;
          mask.add(`${x},${y}`);
        }
      }
    });
    return mask;
  }

  /**
   * 探索模式：選一個「又遠又少去」的格子
   * 盡量把玩家往沒探索過的房間和遠端走廊推
   */
  pickExplorationTarget(playerGrid) {
    const now = Date.now();
    let best = null;

    // 第一次：只挑距離夠遠的
    for (let i = 0; i < this.explorationSamples; i++) {
      const tile = this.worldState.findRandomWalkableTile();
      if (!tile) continue;

      const dist = Math.abs(tile.x - playerGrid.x) + Math.abs(tile.y - playerGrid.y);
      if (dist < this.minExploreDistance) continue;

      const key = this.posKey(tile);
      const lastVisit = this.visitedTiles.get(key);

      // novelty：沒去過 = 2.0；去過但很久以前 = 1.0；剛去過 = 接近 0
      let novelty = 2.0;
      if (lastVisit) {
        const age = now - lastVisit;
        novelty = Math.max(0, Math.min(1, age / this.visitTTL));
      }

      // 簡單評分：越遠 + 越新鮮分數越高
      const score = dist * 1.0 + novelty * 20;

      if (!best || score > best.score) {
        best = { x: tile.x, y: tile.y, score };
      }
    }

    // 如果都沒找到（例如地圖很小），放寬距離限制再挑一次
    if (!best) {
      for (let i = 0; i < this.explorationSamples; i++) {
        const tile = this.worldState.findRandomWalkableTile();
        if (!tile) continue;

        const dist = Math.abs(tile.x - playerGrid.x) + Math.abs(tile.y - playerGrid.y);
        const key = this.posKey(tile);
        const lastVisit = this.visitedTiles.get(key);
        let novelty = 2.0;
        if (lastVisit) {
          const age = now - lastVisit;
          novelty = Math.max(0, Math.min(1, age / this.visitTTL));
        }
        const score = dist * 0.6 + novelty * 15;

        if (!best || score > best.score) {
          best = { x: tile.x, y: tile.y, score };
        }
      }
    }

    return best ? { x: best.x, y: best.y } : null;
  }

  /**
   * Choose next target: nearest mission (uncollected), else exit, else exploration target
   */
  pickTarget(playerGrid) {
    const missions = typeof this.missionPointsRef === 'function'
      ? this.missionPointsRef()
      : (this.missionPointsRef || []);

    const uncollected = missions.filter(mp => !mp.collected);
    if (uncollected.length > 0) {
      // pick nearest mission by manhattan distance
      uncollected.sort((a, b) => {
        const da = Math.abs(a.gridPos.x - playerGrid.x) + Math.abs(a.gridPos.y - playerGrid.y);
        const db = Math.abs(b.gridPos.x - playerGrid.x) + Math.abs(b.gridPos.y - playerGrid.y);
        return da - db;
      });
      this.targetType = 'mission';
      return { x: uncollected[0].gridPos.x, y: uncollected[0].gridPos.y };
    }

    // Otherwise go to exit
    if (this.exitPointRef && this.exitPointRef.getGridPosition) {
      const exit = this.exitPointRef.getGridPosition();
      this.targetType = 'exit';
      return { x: exit.x, y: exit.y };
    }

    // 否則啟動「探索模式」：找一個又遠又沒去過的格子
    const exploreTarget = this.pickExplorationTarget(playerGrid);
    this.targetType = 'explore';
    if (exploreTarget) {
      return exploreTarget;
    }

    // 仍然沒選到的話，就退回舊的隨機邏輯
    return this.worldState.findRandomWalkableTile();
  }

  /**
   * Plan path if needed
   */
  plan(playerGrid) {
    const now = performance.now() / 1000;

    // 如果目標已經幾乎到達，就丟掉舊路徑、強制重新規劃
    if (this.currentTarget) {
      const distToTarget =
        Math.abs(this.currentTarget.x - playerGrid.x) +
        Math.abs(this.currentTarget.y - playerGrid.y);
      if (distToTarget <= 1) {
        this.currentTarget = null;
        this.currentPath = [];
      }
    }

    // 有有效路徑而且還在規劃冷卻時間內，就不重算以避免抖動
    if (
      this.currentPath &&
      this.currentPath.length > 1 &&
      this.currentTarget &&
      now - this.lastPlanTime < this.planInterval
    ) {
      return;
    }

    this.lastPlanTime = now;

    const target = this.pickTarget(playerGrid);
    if (!target) return;

    this.currentTarget = target;

    // Use avoidance mask to block near-monster tiles
    const avoidMask = this.buildAvoidanceMask();
    let path = this.pathfinder.findPath(playerGrid, target, true, avoidMask);

    // 如果因為避怪完全找不到路，退一步允許接近怪物（總比完全不動好）
    if ((!path || path.length === 0) && avoidMask && avoidMask.size > 0) {
      path = this.pathfinder.findPath(playerGrid, target, true, null);
    }

    // ✅ 這裡做平滑
    if (path && path.length > 0 && typeof this.pathfinder.smoothPath === 'function') {
      path = this.pathfinder.smoothPath(path);
    }

    this.currentPath = path || [];
  }

  /**
   * Get control commands for this frame
   * Returns { move: {x,y}, lookYaw: number, sprint: bool }
   */
  tick(deltaTime) {
    if (!this.enabled) return null;

    const playerPos = this.playerController.getGridPosition();

    // 記錄走過的格子，給探索策略用
    this.recordVisit(playerPos);

    this.plan(playerPos);

    if (!this.currentPath || this.currentPath.length === 0) {
      return { move: { x: 0, y: 0 }, lookYaw: 0, sprint: false };
    }

    // 連續跳過過近的 waypoint，避免在邊界磨
    const tileSize = CONFIG.TILE_SIZE;
    while (this.currentPath.length > 1) {
      const wp = this.currentPath[0];
      const cx = wp.x * tileSize + tileSize / 2;
      const cz = wp.y * tileSize + tileSize / 2;
      const dist = Math.hypot(
        cx - this.playerController.position.x,
        cz - this.playerController.position.z
      );
      if (dist < tileSize * 0.35 || (wp.x === playerPos.x && wp.y === playerPos.y)) {
        this.currentPath.shift();
      } else {
        break;
      }
    }

    const target = this.currentPath[0];
    const targetWorldX = target.x * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2;
    const targetWorldZ = target.y * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2;

    // 使用「玩家世界座標 -> 目標世界座標」向量，避免因格子坐標誤差貼牆
    const dx = targetWorldX - this.playerController.position.x;
    const dz = targetWorldZ - this.playerController.position.z;
    const len = Math.hypot(dx, dz) || 1;
    // 世界座標的移動向量（只表示方向）
    const moveWorld = { x: dx / len, z: dz / len };
    
    // Look towards target（絕對 yaw）
    const yaw = Math.atan2(dx, dz);
    const lookYaw = yaw;

    // 依距離與目標類型調整是否衝刺，避免在房間內狂暴衝刺貼牆
    let distToGoal = Infinity;
    if (this.currentTarget) {
      distToGoal =
        Math.abs(this.currentTarget.x - playerPos.x) +
        Math.abs(this.currentTarget.y - playerPos.y);
    }

    let sprint = false;
    if (this.targetType === 'mission' || this.targetType === 'exit') {
      // 任務/出口：距離 > 4 格才用跑的，接近時改走路避免 overshoot
      sprint = distToGoal > 4;
    } else {
      // 探索：距離很遠才跑，避免在房間內左右橫衝
      sprint = distToGoal > 8;
    }

    // --- 簡易卡住偵測：同一格逾 1.2 秒就強制重規劃 ---
    if (this.lastGrid && this.lastGrid.x === playerPos.x && this.lastGrid.y === playerPos.y) {
      this.stuckTimer += deltaTime;
    } else {
      this.stuckTimer = 0;
      this.lastGrid = { x: playerPos.x, y: playerPos.y };
    }

    // --- 進度偵測：若世界座標移動量過小，重新規劃並將第一個 waypoint 丟棄 ---
    const currentWorld = {
      x: this.playerController.position.x,
      z: this.playerController.position.z
    };
    if (this.lastWorldPos) {
      const moved = Math.hypot(
        currentWorld.x - this.lastWorldPos.x,
        currentWorld.z - this.lastWorldPos.z
      );
      if (moved < 0.05) {
        this.noProgressTimer += deltaTime;
      } else {
        this.noProgressTimer = 0;
      }
    }
    this.lastWorldPos = currentWorld;

    const shouldResetPath =
      this.stuckTimer > this.stuckThreshold ||
      this.noProgressTimer > this.noProgressThreshold;

    if (shouldResetPath) {
      this.currentPath = [];
      this.currentTarget = null;
      this.stuckTimer = 0;
      this.noProgressTimer = 0;
      if (typeof this.pathfinder.clearCache === 'function') {
        this.pathfinder.clearCache();
      }
      this.plan(playerPos);
    }

    return { moveWorld, lookYaw, sprint };
  }
}
