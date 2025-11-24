/**
 * Behavior Tree Profiles
 * Creates specific behavior trees for different monster types
 *
 * v4.0.0: Now uses Frontier-based Exploration algorithm
 * instead of if-else heuristics for intelligent autonomous exploration
 */

import * as THREE from 'three';
import { CONFIG } from '../core/config.js';
import {
  BehaviorTree,
  Selector,
  Sequence,
  Condition,
  Action,
  NodeStatus
} from './behaviorTree.js';
import { FrontierExplorer } from './frontierExploration.js';

/**
 * Create a behavior tree for a monster based on its type configuration
 * @param {Monster} monster - The monster instance
 * @param {Object} typeConfig - Monster type configuration
 * @returns {BehaviorTree} Configured behavior tree
 */
export function createMonsterBehaviorTree(monster, typeConfig) {
  const behaviorConfig = typeConfig.behavior;

  // Root selector (tries behaviors in priority order)
  const root = new Selector('Root', [
    // PRIORITY 1: Chase if player is very close (within 8 units)
    createCloseRangeChase(monster, behaviorConfig),

    // PRIORITY 2: Explore autonomously (default behavior)
    createExplorationBehavior(monster, behaviorConfig),

    // PRIORITY 3: Idle (fallback)
    createIdleBehavior(monster)
  ]);

  return new BehaviorTree(`${typeConfig.name}_BT`, root);
}

/**
 * Create close-range chase behavior (only chase if very close)
 */
function createCloseRangeChase(monster, config) {
  return new Sequence('ChaseOnSight', [
    // 只要看得到玩家就追，距離限制交給 monster.stats.visionRange
    new Condition('CanSeePlayer', (ctx) => {
      return monster.canSeePlayer(ctx.playerPosition);
    }),

    new Action('ChasePlayerOnSight', (ctx) => {
      monster.state = 'CHASE';
      // 跑步動畫，沒有就用走路
      monster.playAnimation('run') || monster.playAnimation('walk');

      // 這邊先用你原本的 moveTowards，之後要再接 A* 追擊也可以
      monster.moveTowards(ctx.playerPosition, ctx.deltaTime);
      return NodeStatus.RUNNING;
    })
  ]);
}


function createExplorationBehavior(monster, config) {
  // 初始化 Frontier explorer（只建一次）
  if (!monster.frontierExplorer) {
    monster.frontierExplorer = new FrontierExplorer(monster.worldState, {
      scanRadius: 60,      // 降低掃描半徑以減少運算
      explorationRadius: 0,
      memoryDuration: 60000,
      minFrontierClusters: 1,
      debug: false
    });
  }

  const tileSize = CONFIG.TILE_SIZE;
  const MAX_TARGET_AGE = 10000; // 10 秒後強制換目標

  return new Action('Frontier+DFS_Exploration', (ctx) => {
    const now = Date.now();

    monster.state = 'EXPLORE';
    monster.playAnimation('walk');

    // 記錄拜訪（你原本的記憶系統）
    if (monster.recordVisit) {
      monster.recordVisit();
    }

    // 把當前格子標記成已探索（Frontier 用）
    monster.frontierExplorer.markExplored(monster.gridX, monster.gridY);

    // 決定要不要換新目標
    const hasTarget = !!monster.explorationTarget;
    const targetIsClose =
      hasTarget && monster.position.distanceTo(monster.explorationTarget) < 3;
    const targetTooOld =
      hasTarget &&
      monster.explorationTargetSetTime &&
      now - monster.explorationTargetSetTime > MAX_TARGET_AGE;

    const needNewTarget = !hasTarget || targetIsClose || targetTooOld;

    if (needNewTarget) {
      // 先清掉現有路徑與目標
      monster.currentPath = [];
      monster.explorationTarget = null;

      // 盡量沿著目前移動方向延伸探索（給 Frontier 用）
      const currentDir = monster.actualMovementDirection
        ? new THREE.Vector2(monster.actualMovementDirection.dx, monster.actualMovementDirection.dy)
        : null;

      // =====================
      // 0) 先問 stack DFS 要去哪
      // =====================
      let dfsTarget = null;
      if (monster.getNextStackTarget) {
        dfsTarget = monster.getNextStackTarget();
      }

      if (dfsTarget) {
        // 用 A* 去這個 DFS 目標
        let path = monster.pathfinding.findPath(
          { x: monster.gridX, y: monster.gridY },
          { x: dfsTarget.x, y: dfsTarget.y }
        );

        if (path && path.length > 0) {
          path = monster.pathfinding.smoothPath(path);
          monster.currentPath = path;
          monster.explorationTarget = new THREE.Vector3(
            dfsTarget.x * tileSize + tileSize / 2,
            monster.position.y,
            dfsTarget.y * tileSize + tileSize / 2
          );
          monster.explorationTargetSetTime = now;

          console.log(
            `🧱 DFS target: (${dfsTarget.x}, ${dfsTarget.y}) pathLen=${path.length}`
          );
        } else {
          // 去不了這個 DFS 目標，標成 stuck，讓 DFS 下次不要再選到
          if (monster.recordStuckPosition) {
            monster.recordStuckPosition(dfsTarget.x, dfsTarget.y);
          }
          dfsTarget = null;
        }
      }

      // =====================
      // 1) DFS 沒給出目標 → 再用 Frontier 找新的區域
      // =====================
      if (!monster.explorationTarget) {
        const frontier = monster.frontierExplorer.selectBestFrontier(
          monster.gridX,
          monster.gridY,
          currentDir
        );

        if (frontier) {
          let path = monster.pathfinding.findPath(
            { x: monster.gridX, y: monster.gridY },
            { x: frontier.x, y: frontier.y }
          );

          if (path && path.length > 0) {
            path = monster.pathfinding.smoothPath(path);

            monster.currentPath = path;
            monster.explorationTarget = new THREE.Vector3(
              frontier.x * tileSize + tileSize / 2,
              monster.position.y,
              frontier.y * tileSize + tileSize / 2
            );
            monster.explorationTargetSetTime = now;

            console.log(
              `🎯 Frontier target: (${frontier.x}, ${frontier.y}) pathLen=${path.length} score=${frontier.score.toFixed(1)}`
            );
          } else {
            // 這個 frontier 到不了，直接當作已探索，避免下次又選到
            monster.frontierExplorer.markExplored(frontier.x, frontier.y);
          }
        }
      }

      // =====================
      // 2) Frontier 也沒東西 → random reachable
      // =====================
      if (!monster.explorationTarget) {
        console.log('⚠️ No usable DFS/Frontiers, falling back to random reachable target');

        const randomTile = monster.worldState.findRandomWalkableTile();
        if (randomTile) {
          let randomPath = monster.pathfinding.findPath(
            { x: monster.gridX, y: monster.gridY },
            { x: randomTile.x, y: randomTile.y }
          );

          if (randomPath && randomPath.length > 0) {
            randomPath = monster.pathfinding.smoothPath(randomPath);

            monster.currentPath = randomPath;
            monster.explorationTarget = new THREE.Vector3(
              randomTile.x * tileSize + tileSize / 2,
              monster.position.y,
              randomTile.y * tileSize + tileSize / 2
            );
            monster.explorationTargetSetTime = now;

            console.log(
              `🎲 Random exploration target: (${randomTile.x}, ${randomTile.y}) pathLen=${randomPath.length}`
            );
          }
        }
      }

      // =====================
      // 3) 再不行 → 就近遊走
      // =====================
      if (!monster.explorationTarget) {
        const tryDirs = [
          { dx: 1, dy: 0 },
          { dx: -1, dy: 0 },
          { dx: 0, dy: 1 },
          { dx: 0, dy: -1 },
          { dx: 1, dy: 1 },
          { dx: -1, dy: 1 },
          { dx: 1, dy: -1 },
          { dx: -1, dy: -1 },
        ];

        for (const dir of tryDirs) {
          const tx = monster.gridX + dir.dx * 3;
          const ty = monster.gridY + dir.dy * 3;
          if (monster.worldState.isWalkableWithMargin?.(tx, ty, 1) || monster.worldState.isWalkable(tx, ty)) {
            monster.explorationTarget = new THREE.Vector3(
              tx * tileSize + tileSize / 2,
              monster.position.y,
              ty * tileSize + tileSize / 2
            );
            monster.explorationTargetSetTime = now;
            console.log(`🚶 Fallback short-walk target: (${tx}, ${ty})`);
            break;
          }
        }
      }

      // =====================
      // 4) 最後手段：強迫去很遠的地方
      // =====================
      if (!monster.explorationTarget) {
        const farTarget = pickFarWalkable(monster);
        if (farTarget) {
          const path = monster.pathfinding.findPath(
            { x: monster.gridX, y: monster.gridY },
            { x: farTarget.x, y: farTarget.y }
          );

          if (path && path.length > 0) {
            monster.currentPath = monster.pathfinding.smoothPath(path);
            monster.explorationTarget = new THREE.Vector3(
              farTarget.x * tileSize + tileSize / 2,
              monster.position.y,
              farTarget.y * tileSize + tileSize / 2
            );
            monster.explorationTargetSetTime = now;
            console.log(`🧭 Forced far target: (${farTarget.x}, ${farTarget.y}) pathLen=${path.length}`);
          }
        }
      }
    }

    // 真正做移動的地方
    if (monster.currentPath && monster.currentPath.length > 0) {
      monster.followPath(ctx.deltaTime);
    } else if (monster.explorationTarget) {
      // 理論上很少會走到這裡，但保留 direct move 作為最後 fallback
      monster.moveTowards(monster.explorationTarget, ctx.deltaTime);
    }

    return NodeStatus.RUNNING;
  });
}



/**
 * Pick a far walkable tile (farthest of random samples) to force long-range exploration
 */
function pickFarWalkable(monster) {
  const candidates = [];
  const width = monster.worldState.width;
  const height = monster.worldState.height;

  // Sample 100 random walkable tiles and pick the farthest from current
  for (let i = 0; i < 100; i++) {
    const tile = monster.worldState.findRandomWalkableTile();
    if (!tile) continue;
    // Skip recent stuck positions
    if (monster.isStuckPosition && monster.isStuckPosition(tile.x, tile.y)) continue;

    const dx = tile.x - monster.gridX;
    const dy = tile.y - monster.gridY;
    const distSq = dx * dx + dy * dy;
    candidates.push({ ...tile, distSq });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.distSq - a.distSq);
  return candidates[0];
}


/**
 * Create idle behavior
 */
function createIdleBehavior(monster) {
  return new Action('Idle', (ctx) => {
    monster.state = 'IDLE';
    monster.playAnimation('idle');
    return NodeStatus.RUNNING;
  });
}

/**
 * OLD: Create chase behavior sequence (keeping for reference)
 */
function createChaseBehavior_OLD(monster, config) {
  return new Sequence('Chase', [
    // Check if can see player
    new Condition('CanSeePlayer', (ctx) => {
      return monster.canSeePlayer(ctx.playerPosition);
    }),

    // Update chase target
    new Action('UpdateChaseTarget', (ctx) => {
      monster.chaseTarget = ctx.playerPosition.clone();
      monster.lastSeenPosition = ctx.playerPosition.clone();
      monster.lastSeenTime = Date.now();
      monster.state = 'CHASE';
      return NodeStatus.SUCCESS;
    }),

    // Play run animation
    new Action('PlayRunAnimation', (ctx) => {
      monster.playAnimation('run') || monster.playAnimation('walk');
      return NodeStatus.SUCCESS;
    }),

    // Chase player (returns RUNNING to keep chasing)
    new Action('ChasePlayer', (ctx) => {
      // Use A* pathfinding if enabled
      if (monster.pathfinding && monster.currentPath && monster.currentPath.length > 0) {
        monster.followPath(ctx.deltaTime);
      } else {
        monster.moveTowards(ctx.playerPosition, ctx.deltaTime);
      }
      return NodeStatus.RUNNING;
    })
  ]);
}

/**
 * Create search behavior sequence
 */
function createSearchBehavior(monster, config) {
  return new Sequence('Search', [
    // Check if has recent sighting
    new Condition('HasRecentSighting', (ctx) => {
      if (!monster.lastSeenTime) return false;
      const timeSinceSeen = Date.now() - monster.lastSeenTime;
      return timeSinceSeen < config.chaseMemory;
    }),

    // Execute search pattern
    new Action('SearchArea', (ctx) => {
      monster.state = 'SEARCH';

      // Generate search points if needed
      if (!monster.searchPoints || monster.searchPoints.length === 0) {
        if (monster.lastSeenPosition) {
          monster.generateSearchPoints(monster.lastSeenPosition, config.searchRadius);
        } else {
          return NodeStatus.FAILURE;
        }
      }

      // Play walk animation
      monster.playAnimation('walk') || monster.playAnimation('idle');

      // Move to next search point
      if (monster.searchPoints.length > 0) {
        const target = monster.searchPoints[0];
        const tileSize = 2; // CONFIG.TILE_SIZE
        const targetWorld = new THREE.Vector3(
          target.x * tileSize,
          monster.position.y,
          target.y * tileSize
        );

        monster.moveTowards(targetWorld, ctx.deltaTime);

        // Check if reached target
        const distance = monster.position.distanceTo(targetWorld);
        if (distance < 1) {
          monster.searchPoints.shift(); // Remove completed point
        }

        return NodeStatus.RUNNING;
      }

      // Search complete
      monster.searchPoints = [];
      return NodeStatus.SUCCESS;
    })
  ]);
}

/**
 * Create patrol behavior
 */
function createPatrolBehavior(monster, config) {
  if (config.preferredMode === 'wander') {
    return createWanderBehavior(monster, config);
  }

  return new Sequence('Patrol', [
    // Play walk animation
    new Action('PlayWalkAnimation', (ctx) => {
      monster.playAnimation('walk') || monster.playAnimation('idle');
      return NodeStatus.SUCCESS;
    }),

    // Patrol movement
    new Action('PatrolMove', (ctx) => {
      monster.state = 'PATROL';
      monster.updatePatrol(ctx.deltaTime);
      return NodeStatus.RUNNING;
    })
  ]);
}

/**
 * Create wander behavior (for autonomous monsters)
 */
function createWanderBehavior(monster, config) {
  return new Action('Wander', (ctx) => {
    monster.state = 'WANDER';

    // Play walk or idle animation
    if (Math.random() < config.pauseChance) {
      monster.playAnimation('idle');
      return NodeStatus.RUNNING;
    }

    monster.playAnimation('walk');

    // Change direction periodically
    if (!monster.wanderTarget || Math.random() < 0.02) { // 2% chance per frame
      const randomTile = monster.worldState.findRandomWalkableTile();
      if (randomTile) {
        const tileSize = 2; // CONFIG.TILE_SIZE
        monster.wanderTarget = new THREE.Vector3(
          randomTile.x * tileSize,
          monster.position.y,
          randomTile.y * tileSize
        );
      }
    }

    // Move towards wander target
    if (monster.wanderTarget) {
      monster.moveTowards(monster.wanderTarget, ctx.deltaTime);

      // Check if reached
      const distance = monster.position.distanceTo(monster.wanderTarget);
      if (distance < 1) {
        monster.wanderTarget = null;
      }
    }

    return NodeStatus.RUNNING;
  });
}
