/**
 * Frontier-based Exploration System
 *
 * Implements systematic autonomous exploration by identifying "frontiers" -
 * boundaries between known (explored) and unknown (unexplored) space.
 *
 * Algorithm:
 * 1. Maintain map of explored cells
 * 2. Find frontier cells (walkable cells adjacent to unexplored areas)
 * 3. Score frontiers by information gain (how many new cells they reveal)
 * 4. Select best frontier and navigate to it
 * 5. Repeat
 *
 * This replaces the if-else logic with a proper exploration algorithm
 * used in robotics and autonomous navigation research.
 */

import * as THREE from 'three';

export class FrontierExplorer {
  /**
   * @param {WorldState} worldState - Reference to world grid
   * @param {Object} config - Configuration options
   */
  constructor(worldState, config = {}) {
    this.worldState = worldState;

    // Configuration
    this.scanRadius = config.scanRadius || 30; // How far to look for frontiers
    this.explorationRadius = config.explorationRadius || 3; // Cells within this are "explored"
    this.memoryDuration = config.memoryDuration || 600000; // 10 minutes (same as before)
    this.minFrontierClusters = config.minFrontierClusters || 3; // Minimum cells to form a frontier

    // Exploration memory: Map<"x,y", timestamp>
    this.exploredCells = new Map();

    // Debug
    this.debug = config.debug || false;
  }

  /**
   * Mark a cell and its neighbors as explored
   * @param {number} gridX - Grid X coordinate
   * @param {number} gridY - Grid Y coordinate
   */
  markExplored(gridX, gridY) {
    const now = Date.now();
    const radius = this.explorationRadius;

    // Mark current cell and surrounding area as explored
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const x = gridX + dx;
        const y = gridY + dy;

        // Only mark walkable cells as explored
        if (this.worldState.isWalkable(x, y)) {
          const key = `${x},${y}`;
          this.exploredCells.set(key, now);
        }
      }
    }

    // Clean old memories (older than memoryDuration)
    this.cleanOldMemories();
  }

  /**
   * Check if a cell has been explored recently
   * @param {number} gridX - Grid X coordinate
   * @param {number} gridY - Grid Y coordinate
   * @returns {boolean} True if explored recently
   */
  isExplored(gridX, gridY) {
    const key = `${gridX},${gridY}`;
    const timestamp = this.exploredCells.get(key);

    if (!timestamp) return false;

    const age = Date.now() - timestamp;
    return age < this.memoryDuration;
  }

  /**
   * Get exploration age (0 = just explored, 1 = fully forgotten)
   * @param {number} gridX - Grid X coordinate
   * @param {number} gridY - Grid Y coordinate
   * @returns {number} 0-1 where 0=recently explored, 1=not explored
   */
  getExplorationAge(gridX, gridY) {
    const key = `${gridX},${gridY}`;
    const timestamp = this.exploredCells.get(key);

    if (!timestamp) return 1.0; // Never explored

    const age = Date.now() - timestamp;
    return Math.min(1.0, age / this.memoryDuration);
  }

  /**
   * Clean memories older than memoryDuration
   */
  cleanOldMemories() {
    const now = Date.now();
    const keysToDelete = [];

    for (const [key, timestamp] of this.exploredCells.entries()) {
      if (now - timestamp > this.memoryDuration) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach(key => this.exploredCells.delete(key));

    if (this.debug && keysToDelete.length > 0) {
      console.log(`🧹 Cleaned ${keysToDelete.length} old memories`);
    }
  }

  /**
   * Check if a cell is a frontier (boundary between known and unknown)
   * A frontier cell must be:
   * 1. Walkable
   * 2. Not recently explored
   * 3. Adjacent to at least one explored cell
   * 4. Adjacent to at least one unexplored walkable cell
   *
   * @param {number} gridX - Grid X coordinate
   * @param {number} gridY - Grid Y coordinate
   * @returns {boolean} True if this is a frontier cell
   */
  isFrontier(gridX, gridY) {
    // Must be walkable
    if (!this.worldState.isWalkable(gridX, gridY)) {
      return false;
    }

    // Must not be recently explored
    if (this.isExplored(gridX, gridY)) {
      return false;
    }

    // Check 4-connected neighbors
    const neighbors = [
      {dx: 0, dy: -1}, // North
      {dx: 1, dy: 0},  // East
      {dx: 0, dy: 1},  // South
      {dx: -1, dy: 0}  // West
    ];

    let hasExploredNeighbor = false;
    let hasUnexploredNeighbor = false;

    for (const {dx, dy} of neighbors) {
      const nx = gridX + dx;
      const ny = gridY + dy;

      if (!this.worldState.isWalkable(nx, ny)) {
        continue; // Walls don't count
      }

      if (this.isExplored(nx, ny)) {
        hasExploredNeighbor = true;
      } else {
        hasUnexploredNeighbor = true;
      }
    }

    // Frontier = borders both explored and unexplored space
    return hasExploredNeighbor && hasUnexploredNeighbor;
  }

  /**
   * Calculate information gain for a frontier cell
   * (How many new unexplored cells would we discover?)
   *
   * @param {number} gridX - Grid X coordinate
   * @param {number} gridY - Grid Y coordinate
   * @returns {number} Information gain score (higher = better)
   */
  calculateInfoGain(gridX, gridY) {
    let unexploredCount = 0;
    const checkRadius = 5; // Look 5 cells around the frontier

    for (let dy = -checkRadius; dy <= checkRadius; dy++) {
      for (let dx = -checkRadius; dx <= checkRadius; dx++) {
        const x = gridX + dx;
        const y = gridY + dy;

        // Count walkable unexplored cells
        if (this.worldState.isWalkable(x, y) && !this.isExplored(x, y)) {
          unexploredCount++;
        }
      }
    }

    return unexploredCount;
  }

  /**
   * Find all frontier cells within scanRadius of current position
   * @param {number} currentX - Current grid X position
   * @param {number} currentY - Current grid Y position
   * @returns {Array<Object>} Array of frontier objects with {x, y, infoGain}
   */
  findFrontiers(currentX, currentY) {
    const frontiers = [];
    const radius = this.scanRadius;

    // Scan area around current position
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const x = currentX + dx;
        const y = currentY + dy;

        if (this.isFrontier(x, y)) {
          const infoGain = this.calculateInfoGain(x, y);

          frontiers.push({
            x,
            y,
            infoGain,
            distance: Math.sqrt(dx * dx + dy * dy)
          });
        }
      }
    }

    if (this.debug) {
      console.log(`🔍 Found ${frontiers.length} frontiers within radius ${radius}`);
    }

    return frontiers;
  }

  /**
   * Cluster frontiers (group nearby frontiers together)
   * This helps identify major unexplored regions
   *
   * @param {Array<Object>} frontiers - Array of frontier cells
   * @returns {Array<Array<Object>>} Array of frontier clusters
   */
  clusterFrontiers(frontiers) {
    const clusters = [];
    const visited = new Set();

    const getNeighbors = (frontier, allFrontiers) => {
      return allFrontiers.filter(f => {
        if (f === frontier) return false;
        const dx = Math.abs(f.x - frontier.x);
        const dy = Math.abs(f.y - frontier.y);
        return dx <= 2 && dy <= 2; // Neighbors within 2 cells
      });
    };

    // Simple clustering using connected components
    for (const frontier of frontiers) {
      const key = `${frontier.x},${frontier.y}`;
      if (visited.has(key)) continue;

      // Start new cluster
      const cluster = [];
      const queue = [frontier];
      visited.add(key);

      while (queue.length > 0) {
        const current = queue.shift();
        cluster.push(current);

        const neighbors = getNeighbors(current, frontiers);
        for (const neighbor of neighbors) {
          const nKey = `${neighbor.x},${neighbor.y}`;
          if (!visited.has(nKey)) {
            visited.add(nKey);
            queue.push(neighbor);
          }
        }
      }

      clusters.push(cluster);
    }

    return clusters;
  }

  /**
   * Select the best frontier to explore
   * Scoring considers:
   * 1. Information gain (how much new area will be revealed)
   * 2. Distance (prefer closer frontiers with similar info gain)
   * 3. Exploration age (prefer areas not visited in a long time)
   *
   * @param {number} currentX - Current grid X position
   * @param {number} currentY - Current grid Y position
   * @param {Vector3|null} currentDirection - Current movement direction (optional)
   * @returns {Object|null} Best frontier {x, y, score} or null if none found
   */
  selectBestFrontier(currentX, currentY, currentDirection = null) {
    const frontiers = this.findFrontiers(currentX, currentY);

    if (frontiers.length === 0) {
      if (this.debug) {
        console.log('⚠️ No frontiers found');
      }
      return null;
    }

    // Cluster frontiers to find major unexplored regions
    const clusters = this.clusterFrontiers(frontiers);

    if (this.debug) {
      console.log(`📊 Found ${clusters.length} frontier clusters`);
    }

    // Filter out tiny clusters (noise)
    const significantClusters = clusters.filter(c => c.length >= this.minFrontierClusters);

    if (significantClusters.length === 0) {
      if (this.debug) {
        console.log('⚠️ No significant clusters found');
      }
      return null;
    }

    // For each cluster, pick the best representative frontier
    const clusterRepresentatives = significantClusters.map(cluster => {
      // Calculate cluster centroid
      const centroidX = cluster.reduce((sum, f) => sum + f.x, 0) / cluster.length;
      const centroidY = cluster.reduce((sum, f) => sum + f.y, 0) / cluster.length;

      // Total information gain of cluster
      const totalInfoGain = cluster.reduce((sum, f) => sum + f.infoGain, 0);

      // Find frontier closest to centroid (best entry point)
      let bestEntry = cluster[0];
      let minDistToCentroid = Infinity;

      for (const frontier of cluster) {
        const dx = frontier.x - centroidX;
        const dy = frontier.y - centroidY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < minDistToCentroid) {
          minDistToCentroid = dist;
          bestEntry = frontier;
        }
      }

      return {
        ...bestEntry,
        clusterSize: cluster.length,
        totalInfoGain
      };
    });

    // Score each cluster representative
    const maxDistance = this.scanRadius;

    const scored = clusterRepresentatives.map(frontier => {
      // Distance reward: closer is better (0-100)
      const distanceReward = (1 - frontier.distance / maxDistance) * 100;

      // Information gain reward: more unexplored area = better (0-200)
      const infoGainReward = frontier.totalInfoGain * 2;

      // Cluster size reward: bigger unexplored region = better (0-50)
      const clusterReward = Math.min(50, frontier.clusterSize * 5);

      // Exploration age reward: prefer areas not visited recently (0-100)
      const ageReward = this.getExplorationAge(frontier.x, frontier.y) * 100;

      // Direction consistency (if we have current direction)
      let directionReward = 0;
      if (currentDirection) {
        const dx = frontier.x - currentX;
        const dy = frontier.y - currentY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > 0) {
          const targetDir = {x: dx / dist, y: dy / dist};
          const dotProduct = currentDirection.x * targetDir.x + currentDirection.y * targetDir.y;
          directionReward = dotProduct * 50; // +50 for same direction
        }
      }

      // HIGHER SCORE = BETTER TARGET
      const score = distanceReward + infoGainReward + clusterReward + ageReward + directionReward;

      return {
        ...frontier,
        score,
        breakdown: {distanceReward, infoGainReward, clusterReward, ageReward, directionReward}
      };
    });

    // Sort by score (highest first)
    scored.sort((a, b) => b.score - a.score);

    const best = scored[0];

    if (this.debug) {
      console.log(`🎯 Best frontier: (${best.x}, ${best.y}) score=${best.score.toFixed(1)}`, best.breakdown);
    }

    return best;
  }
}
