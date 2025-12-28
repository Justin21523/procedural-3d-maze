import * as THREE from 'three';
import { Pathfinding } from './pathfinding.js';
import { CONFIG } from '../core/config.js';
import { TaskRunner } from './tasks/taskRunner.js';
import { InteractTask } from './tasks/interactTask.js';
import { MoveToTask } from './tasks/moveToTask.js';
import { SearchTask } from './tasks/searchTask.js';

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
    this.gun = null;

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

    // Oscillation / nudge handling
    this.recentTiles = [];
    this.nudgeTimer = 0;
    this.nudgeDir = null;
    this.nudgeDuration = 0.4;
    this.lastWorldPos = null;
    this.noProgressTimer = 0;
    this.noProgressThreshold = apCfg.noProgressSeconds ?? 0.8;

    // Combat (AI player aiming/firing)
    this.combatTargetId = null;
    this.combatRetargetTimer = 0;
    this.lastCombatTargetIdForRhythm = null;
    this.combatFireCooldown = 0;
    this.combatBurstShotsRemaining = 0;
    this.combatBurstRestTimer = 0;

    // Interaction (mission objects use the same InteractableSystem as the player)
    this.interactCooldown = 0;

    // Mission-solver tasks (Search -> MoveTo -> Interact)
    this.taskRunner = new TaskRunner();
    this.taskGoalKey = '';
    this.taskTarget = null;
    this.taskTargetType = null;
    this.taskWantsInteract = false;
    this.taskInteractId = null;
    this._missionState = null;
  }

  setEnabled(enabled) {
    this.enabled = enabled;
  }

  setGun(gun) {
    this.gun = gun || null;
  }

  resetCombatRhythm() {
    this.combatFireCooldown = 0;
    this.combatBurstShotsRemaining = 0;
    this.combatBurstRestTimer = 0;
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

  readMissionState() {
    const raw = typeof this.missionPointsRef === 'function'
      ? this.missionPointsRef()
      : (this.missionPointsRef || []);

    if (Array.isArray(raw)) {
      return { targets: raw, objective: null, exitUnlocked: null };
    }

    const obj = raw && typeof raw === 'object' ? raw : {};
    return {
      targets: Array.isArray(obj.targets) ? obj.targets : [],
      objective: obj.objective || null,
      exitUnlocked: obj.exitUnlocked ?? null
    };
  }

  getMissionState() {
    return this._missionState || this.readMissionState();
  }

  getMissionTargets() {
    const state = this.getMissionState();
    return Array.isArray(state?.targets) ? state.targets : [];
  }

  buildTaskGoalKey(missionState) {
    const state = missionState || {};
    const exitUnlocked = state.exitUnlocked;
    const objective = state.objective || null;

    const targets = Array.isArray(state.targets) ? state.targets : [];
    const pending = targets
      .filter((t) => t && !t.collected && t.gridPos)
      .map((t) => t.id || `${t.gridPos.x},${t.gridPos.y}`)
      .sort()
      .join('|');

    const objectiveKey = objective
      ? `${String(objective.id || '')}:${String(objective.template || '')}`
      : '';

    const template = String(objective?.template || '').trim();
    const extra =
      template === 'hideForSeconds'
        ? `:H${objective?.progress?.hidden ? '1' : '0'}`
        : (template === 'escort' ? `:S${objective?.progress?.started ? '1' : '0'}` : '');

    return `${exitUnlocked === false ? '0' : '1'}:${objectiveKey}${extra}:${pending}`;
  }

  ensureTaskQueue(playerGrid, missionState) {
    const state = missionState || {};
    const key = this.buildTaskGoalKey(state);

    if (key !== this.taskGoalKey) {
      this.taskGoalKey = key;
      this.taskRunner.clear();
      this.taskTarget = null;
      this.taskWantsInteract = false;
      this.taskInteractId = null;
      this.resetPath();
    }

    const hasTasks = !!this.taskRunner.current || (this.taskRunner.queue && this.taskRunner.queue.length > 0);
    if (hasTasks) return;

    const targets = Array.isArray(state.targets) ? state.targets : [];
    const pending = targets.filter((t) => t && !t.collected && t.gridPos);
    const exitUnlocked = state.exitUnlocked;
    const objective = state.objective || null;
    const objectiveId = String(objective?.id || '').trim();
    const objectiveTemplate = String(objective?.template || '').trim();
    const objectiveNextId = String(objective?.nextInteractId || '').trim();
    const objectiveGoalGrid = objective?.progress?.goalGridPos || null;

    if (objectiveTemplate === 'escort') {
      const started = !!objective?.progress?.started;
      const completed = !!objective?.progress?.completed;
      if (!completed && started && objectiveGoalGrid && Number.isFinite(objectiveGoalGrid.x) && Number.isFinite(objectiveGoalGrid.y)) {
        this.taskTargetType = 'exit';
        this.taskRunner.setTasks([
          new MoveToTask(objectiveGoalGrid, { threshold: 0 })
        ]);
        return;
      }
    }

    if (objectiveTemplate === 'holdToScan') {
      const nextGridPos = objective?.nextInteractGridPos || objective?.progress?.nextTargetGridPos || null;
      if (nextGridPos && Number.isFinite(nextGridPos.x) && Number.isFinite(nextGridPos.y)) {
        this.taskTargetType = 'mission';
        this.taskRunner.setTasks([
          new MoveToTask(nextGridPos, { threshold: 0 })
        ]);
        return;
      }
    }

    // Interactable objectives: go to the closest target and interact.
    const wantsInteractTargets =
      objectiveTemplate === 'findKeycard' ||
      objectiveTemplate === 'collectEvidence' ||
      objectiveTemplate === 'restorePower' ||
      objectiveTemplate === 'reroutePower' ||
      objectiveTemplate === 'activateShrines' ||
      objectiveTemplate === 'restorePowerFuses' ||
      objectiveTemplate === 'uploadEvidence' ||
      objectiveTemplate === 'codeLock' ||
      objectiveTemplate === 'lockedDoor' ||
      objectiveTemplate === 'placeItemsAtAltars' ||
      objectiveTemplate === 'searchRoomTypeN' ||
      objectiveTemplate === 'photographEvidence' ||
      objectiveTemplate === 'deliverItemToTerminal' ||
      objectiveTemplate === 'switchSequence' ||
      objectiveTemplate === 'switchSequenceWithClues' ||
      objectiveTemplate === 'hideForSeconds' ||
      objectiveTemplate === 'escort';

    if (wantsInteractTargets) {
      const objectiveTargets = (objectiveId && objectiveTemplate !== 'exit')
        ? pending.filter((t) => String(t?.missionId || '').trim() === objectiveId)
        : [];

      const pool = objectiveTargets.length > 0 ? objectiveTargets : pending;
      if (pool.length > 0) {
        if (objectiveNextId) {
          const nextTarget = pool.find((t) => String(t?.id || '').trim() === objectiveNextId);
          const nextGridPos = objective?.nextInteractGridPos || null;
          if (nextTarget?.gridPos && nextTarget.id) {
            this.taskTargetType = 'mission';
            this.taskRunner.setTasks([
              new InteractTask(nextTarget.id || '', nextTarget.gridPos, { threshold: 1 })
            ]);
            return;
          }
          if (nextGridPos && Number.isFinite(nextGridPos.x) && Number.isFinite(nextGridPos.y)) {
            this.taskTargetType = 'mission';
            this.taskRunner.setTasks([
              new InteractTask(objectiveNextId, nextGridPos, { threshold: 1 })
            ]);
            return;
          }
        }

        pool.sort((a, b) => {
          const da = Math.abs(a.gridPos.x - playerGrid.x) + Math.abs(a.gridPos.y - playerGrid.y);
          const db = Math.abs(b.gridPos.x - playerGrid.x) + Math.abs(b.gridPos.y - playerGrid.y);
          return da - db;
        });

        const next = pool[0];
        this.taskTargetType = 'mission';
        this.taskRunner.setTasks([
          new InteractTask(next.id || '', next.gridPos, { threshold: 1 })
        ]);
        return;
      }
    }

    // Exit unlocked: go to exit and interact to finish.
    if (exitUnlocked !== false && this.exitPointRef?.getGridPosition) {
      const exit = this.exitPointRef.getGridPosition();
      this.taskTargetType = 'exit';
      this.taskRunner.setTasks([
        new InteractTask('exit', exit, { threshold: 1 })
      ]);
      return;
    }

    // Exit locked but objective is to unlock it: go to exit and interact.
    if (objectiveTemplate === 'unlockExit' && this.exitPointRef?.getGridPosition) {
      const exit = this.exitPointRef.getGridPosition();
      this.taskTargetType = 'exit';
      this.taskRunner.setTasks([
        new InteractTask('exit', exit, { threshold: 1 })
      ]);
      return;
    }

    // Exit locked but no interactable targets: explore/search until the objective updates.
    const roomTypes = objective?.params?.roomTypes ?? null;
    this.taskTargetType = 'explore';
    this.taskRunner.setTasks([
      new SearchTask({ roomTypes, waypoints: 4, margin: 1, minDist: 6 })
    ]);
  }

  tickTasks(deltaTime, playerGrid, missionState) {
    this.taskWantsInteract = false;
    this.taskInteractId = null;

    this.ensureTaskQueue(playerGrid, missionState);

    const res = this.taskRunner.tick(deltaTime ?? 0, {
      worldState: this.worldState,
      gridPos: playerGrid,
      getGridPos: () => playerGrid
    });

    const intent = res?.intent || null;
    if (intent?.type === 'moveTo' && intent.target) {
      this.taskTarget = intent.target;
    } else if (intent?.type === 'interact') {
      this.taskWantsInteract = true;
      this.taskInteractId = intent.id || null;
      // Stabilize target for the interaction frame (avoid re-planning away).
      this.taskTarget = { x: playerGrid.x, y: playerGrid.y };
    } else if (res?.status === 'success') {
      // No immediate intent; allow fallback planning next tick.
      this.taskTarget = null;
    }

    return res;
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
    if (this.taskTarget && Number.isFinite(this.taskTarget.x) && Number.isFinite(this.taskTarget.y)) {
      this.targetType = this.taskTargetType || 'mission';
      return { x: this.taskTarget.x, y: this.taskTarget.y };
    }

    const missions = this.getMissionTargets();

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
      if (this.targetType === 'mission') {
        const missions = this.getMissionTargets();
        const stillValid = missions.some(mp =>
          mp &&
          !mp.collected &&
          mp.gridPos &&
          mp.gridPos.x === this.currentTarget.x &&
          mp.gridPos.y === this.currentTarget.y
        );
        if (!stillValid) {
          this.currentTarget = null;
          this.currentPath = [];
        }
      } else {
        if (distToTarget <= 1) {
          this.currentTarget = null;
          this.currentPath = [];
        }
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
    this._missionState = this.readMissionState();
    this.tickTasks(deltaTime, playerPos, this._missionState);

    const threat = this.getThreatInfo(playerPos);
    const block = threat.nearestDist <= 2;
    const panicSprint = threat.nearestDist <= 4;
    const combat = this.computeCombatDirective(playerPos, deltaTime, { panic: block });
    this.interactCooldown = Math.max(0, (this.interactCooldown || 0) - (deltaTime ?? 0));
    if (combat && this._missionState?.objective?.template === 'stealthNoise') {
      combat.fire = false;
    }

    const objective = this._missionState?.objective || null;
    if (objective?.template === 'stealthNoise') {
      const completed = !!objective?.progress?.completed;
      const failed = !!objective?.progress?.failed;
      const remaining = Number(objective?.progress?.remaining);
      if (!completed && !failed && Number.isFinite(remaining) && remaining > 0) {
        return {
          move: { x: 0, y: 0 },
          lookYaw: Number.isFinite(combat?.lookYaw) ? combat.lookYaw : 0,
          lookPitch: Number.isFinite(combat?.lookPitch) ? combat.lookPitch : null,
          sprint: false,
          block,
          interact: false,
          fire: false
        };
      }
    }

    if (objective?.template === 'hideForSeconds') {
      const completed = !!objective?.progress?.completed;
      const remaining = Number(objective?.progress?.remaining);
      const hidden = !!objective?.progress?.hidden;
      if (!completed && hidden && Number.isFinite(remaining) && remaining > 0) {
        return {
          move: { x: 0, y: 0 },
          lookYaw: Number.isFinite(combat?.lookYaw) ? combat.lookYaw : 0,
          lookPitch: Number.isFinite(combat?.lookPitch) ? combat.lookPitch : null,
          sprint: false,
          block,
          interact: false,
          fire: false
        };
      }

      if (completed && hidden) {
        const forcedId = this.playerController?.getForcedInteractId?.() || null;
        if (forcedId) {
          return {
            move: { x: 0, y: 0 },
            lookYaw: Number.isFinite(combat?.lookYaw) ? combat.lookYaw : 0,
            lookPitch: Number.isFinite(combat?.lookPitch) ? combat.lookPitch : null,
            sprint: false,
            block,
            interact: forcedId,
            fire: false
          };
        }
      }
    }

    if (objective?.template === 'escort') {
      const started = !!objective?.progress?.started;
      const completed = !!objective?.progress?.completed;
      const goal = objective?.progress?.goalGridPos || null;
      if (!completed && started && goal && goal.x === playerPos.x && goal.y === playerPos.y) {
        return {
          move: { x: 0, y: 0 },
          lookYaw: Number.isFinite(combat?.lookYaw) ? combat.lookYaw : 0,
          lookPitch: Number.isFinite(combat?.lookPitch) ? combat.lookPitch : null,
          sprint: false,
          block,
          interact: false,
          fire: false
        };
      }
    }

    if (objective?.template === 'holdToScan') {
      const completed = !!objective?.progress?.completed;
      const nextGridPos = objective?.nextInteractGridPos || objective?.progress?.nextTargetGridPos || null;
      if (!completed && nextGridPos && Number.isFinite(nextGridPos.x) && Number.isFinite(nextGridPos.y)) {
        const dist = Math.abs(nextGridPos.x - playerPos.x) + Math.abs(nextGridPos.y - playerPos.y);
        if (dist <= 1) {
          const cam = this.playerController?.camera || null;
          const camObj = cam?.getCamera ? cam.getCamera() : null;
          const playerWorld = camObj?.position || this.playerController?.position || null;
          if (playerWorld) {
            const tileSize = CONFIG.TILE_SIZE || 1;
            const targetWorldX = nextGridPos.x * tileSize + tileSize / 2;
            const targetWorldZ = nextGridPos.y * tileSize + tileSize / 2;
            const aimOffsetYRaw = Number(objective?.params?.aimOffsetY);
            const targetWorldY = Number.isFinite(aimOffsetYRaw) ? aimOffsetYRaw : 0.9;

            const dx = targetWorldX - playerWorld.x;
            const dy = targetWorldY - playerWorld.y;
            const dz = targetWorldZ - playerWorld.z;

            const aimYaw = Math.atan2(-dx, -dz);
            const aimPitch = Math.atan2(dy, Math.hypot(dx, dz));

            return {
              move: { x: 0, y: 0 },
              lookYaw: aimYaw,
              lookPitch: aimPitch,
              sprint: false,
              block,
              interact: false,
              fire: false
            };
          }
        }
      }
    }

    // Track oscillation
    this.recordRecentTile(playerPos);
    this.handleNudgeTimer(deltaTime);

    // 記錄走過的格子，給探索策略用
    this.recordVisit(playerPos);

    if (this.shouldNudge()) {
      this.triggerNudge();
    }

    if (this.nudgeTimer > 0 && this.nudgeDir) {
      const cmd = {
        moveWorld: { x: this.nudgeDir.x, z: this.nudgeDir.y },
        lookYaw: Number.isFinite(combat?.lookYaw)
          ? combat.lookYaw
          : Math.atan2(-this.nudgeDir.x, -this.nudgeDir.y),
        lookPitch: Number.isFinite(combat?.lookPitch) ? combat.lookPitch : null,
        sprint: false,
        block,
        fire: !!combat?.fire,
      };
      return cmd;
    }

    this.updateNoProgress(deltaTime);

    this.plan(playerPos);

    let distToGoal = Infinity;
    if (this.currentTarget) {
      distToGoal =
        Math.abs(this.currentTarget.x - playerPos.x) +
        Math.abs(this.currentTarget.y - playerPos.y);
    }

    const wantsInteract =
      (this.taskWantsInteract || (this.targetType === 'mission' && distToGoal <= 0)) &&
      (this.interactCooldown || 0) <= 0;

    let interact = false;
    if (wantsInteract) {
      interact = typeof this.taskInteractId === 'string' && this.taskInteractId.trim()
        ? this.taskInteractId.trim()
        : true;
    }

    let interactLook = null;
    if (objective?.template === 'photographEvidence' && (this.taskWantsInteract || wantsInteract)) {
      const wantsId =
        (typeof this.taskInteractId === 'string' && this.taskInteractId.trim())
          ? this.taskInteractId.trim()
          : (typeof interact === 'string' ? interact.trim() : String(objective?.nextInteractId || '').trim());
      const nextId = String(objective?.nextInteractId || '').trim();
      const nextGridPos = objective?.nextInteractGridPos || null;
      let targetGridPos = wantsId && wantsId === nextId ? nextGridPos : null;

      if (!targetGridPos && wantsId) {
        const targets = Array.isArray(this._missionState?.targets) ? this._missionState.targets : [];
        const hit = targets.find((t) => String(t?.id || '').trim() === wantsId);
        targetGridPos = hit?.gridPos || null;
      }

      if (targetGridPos && Number.isFinite(targetGridPos.x) && Number.isFinite(targetGridPos.y)) {
        const cam = this.playerController?.camera || null;
        const camObj = cam?.getCamera ? cam.getCamera() : null;
        const playerWorld = camObj?.position || this.playerController?.position || null;
        if (playerWorld) {
          const tileSize = CONFIG.TILE_SIZE || 1;
          const targetWorldX = targetGridPos.x * tileSize + tileSize / 2;
          const targetWorldZ = targetGridPos.y * tileSize + tileSize / 2;
          const aimOffsetYRaw = Number(objective?.params?.aimOffsetY);
          const targetWorldY = Number.isFinite(aimOffsetYRaw) ? aimOffsetYRaw : 0.7;

          const dx = targetWorldX - playerWorld.x;
          const dy = targetWorldY - playerWorld.y;
          const dz = targetWorldZ - playerWorld.z;

          const aimYaw = Math.atan2(-dx, -dz);
          const aimPitch = Math.atan2(dy, Math.hypot(dx, dz));

          const currentYaw = this.getCurrentYaw();
          const deltaYaw = this.wrapAngle(aimYaw - currentYaw);
          const currentPitch = this.getCurrentPitch();
          const deltaPitch = aimPitch - currentPitch;

          const alignYawRad = (12 * Math.PI) / 180;
          const alignPitchRad = (14 * Math.PI) / 180;
          const aligned = Math.abs(deltaYaw) <= alignYawRad && Math.abs(deltaPitch) <= alignPitchRad;

          interactLook = { lookYaw: aimYaw, lookPitch: aimPitch, aligned };
          if (interact && !aligned) {
            interact = false;
          }
        }
      }
    }

    if (interact) {
      this.interactCooldown = 0.65;
    }

    if (!this.currentPath || this.currentPath.length === 0) {
      return {
        move: { x: 0, y: 0 },
        lookYaw: Number.isFinite(interactLook?.lookYaw) ? interactLook.lookYaw : (Number.isFinite(combat?.lookYaw) ? combat.lookYaw : 0),
        lookPitch: Number.isFinite(interactLook?.lookPitch) ? interactLook.lookPitch : (Number.isFinite(combat?.lookPitch) ? combat.lookPitch : null),
        sprint: false,
        block,
        interact,
        fire: objective?.template === 'photographEvidence' && wantsInteract ? false : !!combat?.fire
      };
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
    
    // Look towards target (absolute yaw, aligned with FirstPersonCamera where yaw=0 faces -Z)
    const yaw = Math.atan2(-dx, -dz);
    const lookYaw = Number.isFinite(interactLook?.lookYaw)
      ? interactLook.lookYaw
      : (Number.isFinite(combat?.lookYaw) ? combat.lookYaw : yaw);
    const lookPitch = Number.isFinite(interactLook?.lookPitch)
      ? interactLook.lookPitch
      : (Number.isFinite(combat?.lookPitch) ? combat.lookPitch : null);

    // 依距離與目標類型調整是否衝刺，避免在房間內狂暴衝刺貼牆
    let sprint = false;
    if (this.targetType === 'mission' || this.targetType === 'exit') {
      // 任務/出口：距離 > 4 格才用跑的，接近時改走路避免 overshoot
      sprint = distToGoal > 4;
    } else {
      // 探索：距離很遠才跑，避免在房間內左右橫衝
      sprint = distToGoal > 8;
    }
    if (panicSprint) sprint = true;

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

    const fire = objective?.template === 'photographEvidence' && wantsInteract ? false : !!combat?.fire;
    return { moveWorld, lookYaw, lookPitch, sprint, block, interact, fire };
  }

  computeCombatDirective(playerGrid, deltaTime, options = {}) {
    const enabled = CONFIG.AUTOPILOT_COMBAT_ENABLED ?? true;
    if (!enabled) return null;
    if (!CONFIG.AI_RANGED_GLOBAL_ENABLED) return null;
    if (!playerGrid) return null;

    const dt = deltaTime ?? 0;
    this.combatRetargetTimer = Math.max(0, (this.combatRetargetTimer || 0) - dt);
    this.combatFireCooldown = Math.max(0, (this.combatFireCooldown || 0) - dt);
    this.combatBurstRestTimer = Math.max(0, (this.combatBurstRestTimer || 0) - dt);

    const monsters = this.monsterManager?.getMonsters
      ? this.monsterManager.getMonsters()
      : [];
    if (!Array.isArray(monsters) || monsters.length === 0) {
      this.combatTargetId = null;
      this.lastCombatTargetIdForRhythm = null;
      this.resetCombatRhythm();
      return null;
    }

    const maxRange = CONFIG.AUTOPILOT_COMBAT_MAX_RANGE_TILES ?? 16;
    const fireRange = CONFIG.AUTOPILOT_COMBAT_FIRE_RANGE_TILES ?? 12;
    const requireLOS = CONFIG.AUTOPILOT_COMBAT_REQUIRE_LOS ?? true;
    const fovDeg = CONFIG.AUTOPILOT_COMBAT_FOV_DEG ?? 110;
    const fovRad = (Math.max(10, Math.min(180, fovDeg)) * Math.PI) / 180;

    const getMonsterById = (id) => {
      for (const m of monsters) {
        if (!m || m.isDead || m.isDying) continue;
        if (m.id === id) return m;
      }
      return null;
    };

    let target = this.combatTargetId ? getMonsterById(this.combatTargetId) : null;
    if (!target || this.combatRetargetTimer <= 0) {
      target = this.pickBestCombatTarget(playerGrid, monsters, {
        maxRange,
        requireLOS
      });
      this.combatTargetId = target?.id ?? null;
      this.combatRetargetTimer = CONFIG.AUTOPILOT_COMBAT_RETARGET_SECONDS ?? 0.35;
    }

    if (!target) return null;
    if (this.lastCombatTargetIdForRhythm !== target.id) {
      this.lastCombatTargetIdForRhythm = target.id;
      this.resetCombatRhythm();
    }

    const monsterGrid = target.getGridPosition ? target.getGridPosition() : null;
    if (!monsterGrid) return null;

    const distTiles = Math.abs(monsterGrid.x - playerGrid.x) + Math.abs(monsterGrid.y - playerGrid.y);
    if (distTiles > maxRange) return null;

    if (requireLOS && this.worldState?.hasLineOfSight) {
      if (!this.worldState.hasLineOfSight(playerGrid, monsterGrid)) return null;
    }

    const cam = this.playerController?.camera || null;
    const camObj = cam?.getCamera ? cam.getCamera() : null;
    const playerWorld = camObj?.position || this.playerController?.position || null;
    const monsterWorld = target.getWorldPosition ? target.getWorldPosition() : null;
    if (!playerWorld || !monsterWorld) return null;

    // Aim at a slightly elevated "center mass" so we don't shoot at the floor.
    const baseHeight = CONFIG.MONSTER_BASE_HEIGHT ?? 1.6;
    const scale = target?.scale || target?.typeConfig?.stats?.scale || 1;
    const targetHeight = baseHeight * scale;

    const aimPoint = monsterWorld.clone();
    aimPoint.y += Math.max(0.2, targetHeight * 0.55);

    const dx = aimPoint.x - playerWorld.x;
    const dy = aimPoint.y - playerWorld.y;
    const dz = aimPoint.z - playerWorld.z;

    // FirstPersonCamera convention: yaw=0 faces -Z, pitch>0 looks up.
    const aimYaw = Math.atan2(-dx, -dz);
    const aimPitch = Math.atan2(dy, Math.hypot(dx, dz));

    const currentYaw = this.getCurrentYaw();
    const deltaYaw = this.wrapAngle(aimYaw - currentYaw);
    const withinFov = Math.abs(deltaYaw) <= fovRad * 0.5;

    const alignYawDeg = CONFIG.AUTOPILOT_COMBAT_FIRE_ALIGN_DEG ?? 8;
    const alignYawRad = (Math.max(1, Math.min(45, alignYawDeg)) * Math.PI) / 180;
    const alignedYaw = Math.abs(deltaYaw) <= alignYawRad;

    const currentPitch = this.getCurrentPitch();
    const deltaPitch = aimPitch - currentPitch;
    const alignPitchDeg = CONFIG.AUTOPILOT_COMBAT_FIRE_ALIGN_PITCH_DEG ?? 10;
    const alignPitchRad = (Math.max(1, Math.min(60, alignPitchDeg)) * Math.PI) / 180;
    const alignedPitch = Math.abs(deltaPitch) <= alignPitchRad;

    const shouldShoot = !options.panic && distTiles <= fireRange && withinFov && alignedYaw && alignedPitch;
    const fire = this.computeCombatFire(shouldShoot);
    return { lookYaw: aimYaw, lookPitch: aimPitch, fire };
  }

  computeCombatFire(shouldShoot) {
    if (!shouldShoot) return false;

    const gun = this.gun || null;
    const hud = gun?.getHudState ? gun.getHudState() : null;
    const def = gun?.getActiveWeaponDef ? gun.getActiveWeaponDef() : null;

    const weaponInterval = Math.max(
      0.04,
      Number(def?.fireInterval ?? CONFIG.PLAYER_FIRE_INTERVAL ?? 0.08) || 0.08
    );

    if (hud?.isReloading) return false;

    // Trigger auto-reload via the existing Gun logic (wantsFire when empty => tryStartReload()).
    if ((hud?.ammoInMag || 0) <= 0 && (hud?.ammoReserve || 0) > 0) {
      if ((this.combatFireCooldown || 0) > 0) return false;
      this.combatFireCooldown = Math.max(0.25, weaponInterval);
      return true;
    }

    const burstEnabled = CONFIG.AUTOPILOT_COMBAT_BURST_ENABLED ?? true;
    if (!burstEnabled) {
      if ((this.combatFireCooldown || 0) > 0) return false;
      this.combatFireCooldown = weaponInterval;
      return true;
    }

    const burstMin = Math.max(1, Math.round(CONFIG.AUTOPILOT_COMBAT_BURST_MIN_SHOTS ?? 3));
    const burstMax = Math.max(burstMin, Math.round(CONFIG.AUTOPILOT_COMBAT_BURST_MAX_SHOTS ?? 6));
    const restMin = Math.max(0, Number(CONFIG.AUTOPILOT_COMBAT_BURST_REST_MIN_SECONDS ?? 0.35) || 0.35);
    const restMax = Math.max(restMin, Number(CONFIG.AUTOPILOT_COMBAT_BURST_REST_MAX_SECONDS ?? 0.75) || 0.75);

    if ((this.combatBurstRestTimer || 0) > 0) return false;

    if ((this.combatBurstShotsRemaining || 0) <= 0) {
      const span = burstMax - burstMin + 1;
      this.combatBurstShotsRemaining = burstMin + Math.floor(Math.random() * span);
    }

    if ((this.combatFireCooldown || 0) > 0) return false;

    this.combatFireCooldown = weaponInterval;
    this.combatBurstShotsRemaining = Math.max(0, (this.combatBurstShotsRemaining || 0) - 1);

    if ((this.combatBurstShotsRemaining || 0) <= 0) {
      this.combatBurstRestTimer = restMin + Math.random() * (restMax - restMin);
    }

    return true;
  }

  pickBestCombatTarget(playerGrid, monsters, options = {}) {
    const maxRange = Number.isFinite(options.maxRange) ? options.maxRange : 16;
    const requireLOS = options.requireLOS ?? true;

    let best = null;
    for (const m of monsters) {
      if (!m || m.isDead || m.isDying) continue;
      const mg = m.getGridPosition ? m.getGridPosition() : null;
      if (!mg) continue;

      const dist = Math.abs(mg.x - playerGrid.x) + Math.abs(mg.y - playerGrid.y);
      if (dist > maxRange) continue;

      if (requireLOS && this.worldState?.hasLineOfSight) {
        if (!this.worldState.hasLineOfSight(playerGrid, mg)) continue;
      }

      // Prefer nearer targets; add a tiny bias to reduce flicker.
      const score = dist + Math.random() * 0.2;
      if (!best || score < best.score) {
        best = { monster: m, score };
      }
    }

    return best ? best.monster : null;
  }

  wrapAngle(a) {
    const twoPi = Math.PI * 2;
    let v = a;
    v = ((v + Math.PI) % twoPi + twoPi) % twoPi - Math.PI;
    return v;
  }

  getCurrentYaw() {
    const cam = this.playerController?.camera || null;
    if (cam && typeof cam.getYaw === 'function') return cam.getYaw();
    if (cam && typeof cam.yaw === 'number') return cam.yaw;
    return 0;
  }

  getCurrentPitch() {
    const cam = this.playerController?.camera || null;
    if (cam && typeof cam.getPitch === 'function') return cam.getPitch();
    if (cam && typeof cam.pitch === 'number') return cam.pitch;
    return 0;
  }

  getThreatInfo(playerGrid) {
    const monsters = this.monsterManager?.getMonsterPositions
      ? this.monsterManager.getMonsterPositions()
      : [];

    let nearestDist = Infinity;
    let nearestGrid = null;
    for (const m of monsters) {
      if (!m) continue;
      const d = Math.abs(m.x - playerGrid.x) + Math.abs(m.y - playerGrid.y);
      if (d < nearestDist) {
        nearestDist = d;
        nearestGrid = m;
      }
    }

    return { nearestDist, nearestGrid };
  }

  recordRecentTile(gridPos) {
    const key = this.posKey(gridPos);
    this.recentTiles.push(key);
    if (this.recentTiles.length > 10) {
      this.recentTiles.shift();
    }
  }

  shouldNudge() {
    if (this.recentTiles.length < 6) return false;
    const last = this.recentTiles.slice(-4);
    const unique = Array.from(new Set(last));
    if (unique.length === 2 && last[0] === last[2] && last[1] === last[3]) {
      return true;
    }
    return false;
  }

  triggerNudge() {
    const angle = Math.random() * Math.PI * 2;
    this.nudgeDir = { x: Math.cos(angle), y: Math.sin(angle) };
    this.nudgeTimer = this.nudgeDuration * 1.5;
    this.resetPath();
  }

  handleNudgeTimer(dt) {
    if (this.nudgeTimer > 0) {
      this.nudgeTimer -= dt;
      if (this.nudgeTimer <= 0) {
        this.nudgeDir = null;
        this.nudgeTimer = 0;
      }
    }
  }

  updateNoProgress(deltaTime) {
    const world = {
      x: this.playerController.position.x,
      z: this.playerController.position.z
    };
    if (!this.lastWorldPos) {
      this.lastWorldPos = { ...world };
      return;
    }
    const moved = Math.hypot(world.x - this.lastWorldPos.x, world.z - this.lastWorldPos.z);
    this.lastWorldPos = { ...world };

    if (moved < 0.05) {
      this.noProgressTimer += deltaTime;
      if (this.noProgressTimer > this.noProgressThreshold) {
        this.triggerNudge();
        this.noProgressTimer = 0;
      }
    } else {
      this.noProgressTimer = 0;
    }
  }
}
