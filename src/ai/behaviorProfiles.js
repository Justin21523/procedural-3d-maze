/**
 * Behavior Tree Profiles
 * Creates specific behavior trees for different monster types
 *
 * v4.0.0: Now uses Frontier-based Exploration algorithm
 * instead of if-else heuristics for intelligent autonomous exploration
 */

import * as THREE from 'three';
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
  return new Sequence('CloseRangeChase', [
    // Check if player is very close
    new Condition('IsPlayerVeryClose', (ctx) => {
      const distance = monster.position.distanceTo(ctx.playerPosition);
      return distance < 8; // Only chase if within 8 units
    }),

    // Check if can see player
    new Condition('CanSeePlayer', (ctx) => {
      return monster.canSeePlayer(ctx.playerPosition);
    }),

    // Chase player
    new Action('ChaseNearbyPlayer', (ctx) => {
      monster.state = 'CHASE';
      monster.playAnimation('run') || monster.playAnimation('walk');
      monster.moveTowards(ctx.playerPosition, ctx.deltaTime);
      return NodeStatus.RUNNING;
    })
  ]);
}

/**
 * Create Frontier-based Exploration Behavior
 *
 * v4.0.0: Complete rewrite using Frontier-based Exploration algorithm
 * - Systematically finds boundaries between known/unknown space
 * - No more if-else logic for corridors/rooms/junctions
 * - Intelligent target selection based on information gain
 * - Proper algorithm used in robotics research
 */
function createExplorationBehavior(monster, config) {
  // Initialize frontier explorer if not exists
  if (!monster.frontierExplorer) {
    monster.frontierExplorer = new FrontierExplorer(monster.worldState, {
      scanRadius: 30,
      explorationRadius: 3,
      memoryDuration: 600000, // 10 minutes
      minFrontierClusters: 3,
      debug: false
    });
  }

  return new Action('FrontierExploration', (ctx) => {
    monster.state = 'EXPLORE';
    monster.playAnimation('walk');

    const tileSize = 2;

    // Mark current position as explored
    monster.frontierExplorer.markExplored(monster.gridX, monster.gridY);

    // Check if we need a new target
    const needNewTarget = !monster.explorationTarget ||
                          monster.position.distanceTo(monster.explorationTarget) < 3;

    if (needNewTarget) {
      // Get current movement direction for consistency
      const currentDir = monster.actualMovementDirection ?
        new THREE.Vector2(monster.actualMovementDirection.dx, monster.actualMovementDirection.dy) :
        null;

      // Use Frontier Explorer to find best target
      const frontier = monster.frontierExplorer.selectBestFrontier(
        monster.gridX,
        monster.gridY,
        currentDir
      );

      if (frontier) {
        // Use A* to find path to frontier
        const path = monster.pathfinding.findPath(
          {x: monster.gridX, y: monster.gridY},
          {x: frontier.x, y: frontier.y},
          monster.worldState
        );

        if (path && path.length > 0) {
          // Set path directly
          monster.currentPath = path;

          // Set exploration target to frontier
          monster.explorationTarget = new THREE.Vector3(
            frontier.x * tileSize,
            monster.position.y,
            frontier.y * tileSize
          );

          console.log(`🎯 Frontier target: (${frontier.x}, ${frontier.y}) score=${frontier.score.toFixed(1)}`);
        } else {
          // Can't reach frontier - mark as explored and try again next frame
          monster.frontierExplorer.markExplored(frontier.x, frontier.y);
          monster.explorationTarget = null;
        }
      } else {
        // No frontiers found - explore randomly
        console.log('⚠️ No frontiers, random exploration');
        const randomAngle = Math.random() * Math.PI * 2;
        monster.explorationTarget = new THREE.Vector3(
          monster.position.x + Math.cos(randomAngle) * tileSize * 20,
          monster.position.y,
          monster.position.z + Math.sin(randomAngle) * tileSize * 20
        );
      }
    }

    // Follow A* path if available
    if (monster.currentPath && monster.currentPath.length > 0) {
      monster.followPath(ctx.deltaTime);
    }
    // Otherwise move directly to target
    else if (monster.explorationTarget) {
      monster.moveTowards(monster.explorationTarget, ctx.deltaTime);
    }

    return NodeStatus.RUNNING;
  });
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
