/**
 * A* Pathfinding Algorithm
 * For grid-based navigation in the maze
 */

export class Pathfinding {
  constructor(worldState) {
    this.worldState = worldState;
    this.pathCache = new Map(); // Cache computed paths
    this.cacheMaxAge = 5000; // 5 seconds
  }

  /**
   * Find path from start to goal using A* algorithm
   * @param {Object} start - Grid position {x, y}
   * @param {Object} goal - Grid position {x, y}
   * @param {boolean} useCache - Whether to use cached paths
   * @returns {Array<Object>} Array of grid positions forming the path
   */
  findPath(start, goal, useCache = true, avoidMask = null) {
    // Check cache first
    if (useCache) {
      const cachedPath = this.getFromCache(start, goal);
      if (cachedPath) {
        return cachedPath;
      }
    }

    // Validate start and goal
    if (!this.worldState.isWalkable(start.x, start.y)) {
      console.warn('⚠️ Start position not walkable:', start);
      return [];
    }

    if (!this.worldState.isWalkable(goal.x, goal.y)) {
      console.warn('⚠️ Goal position not walkable:', goal);
      return [];
    }

    // A* implementation
    const openSet = [start];
    const cameFrom = new Map();
    const gScore = new Map();
    const fScore = new Map();

    const startKey = this.posKey(start);
    const goalKey = this.posKey(goal);

    gScore.set(startKey, 0);
    fScore.set(startKey, this.heuristic(start, goal));

    let iterations = 0;
    // 放寬迭代上限，避免大地圖/房間導致 A* 早退
    const maxIterations = Math.max(
      1000,
      (this.worldState?.width || 0) * (this.worldState?.height || 0) * 2
    );

    while (openSet.length > 0 && iterations < maxIterations) {
      iterations++;

      // Find node in openSet with lowest fScore
      let current = openSet[0];
      let currentKey = this.posKey(current);
      let lowestF = fScore.get(currentKey) ?? Infinity;

      for (let i = 1; i < openSet.length; i++) {
        const nodeKey = this.posKey(openSet[i]);
        const nodeF = fScore.get(nodeKey) ?? Infinity;
        if (nodeF < lowestF) {
          current = openSet[i];
          currentKey = nodeKey;
          lowestF = nodeF;
        }
      }

      // Goal reached
      if (currentKey === goalKey) {
        const path = this.reconstructPath(cameFrom, current);

        // Cache the path
        if (useCache) {
          this.addToCache(start, goal, path);
        }

        return path;
      }

      // Remove current from openSet
      const currentIndex = openSet.findIndex(node => this.posKey(node) === currentKey);
      openSet.splice(currentIndex, 1);

      // Check neighbors
      const neighbors = this.getNeighbors(current);
      for (const neighbor of neighbors) {
        if (avoidMask && avoidMask.has(this.posKey(neighbor))) {
          continue;
        }
        const neighborKey = this.posKey(neighbor);
        const tentativeGScore = (gScore.get(currentKey) ?? Infinity) + 1;

        if (tentativeGScore < (gScore.get(neighborKey) ?? Infinity)) {
          cameFrom.set(neighborKey, current);
          gScore.set(neighborKey, tentativeGScore);
          fScore.set(neighborKey, tentativeGScore + this.heuristic(neighbor, goal));

          if (!openSet.some(node => this.posKey(node) === neighborKey)) {
            openSet.push(neighbor);
          }
        }
      }
    }

    if (iterations >= maxIterations) {
      console.warn('⚠️ A* max iterations reached');
    }

    // No path found
    return [];
  }

  /**
   * Heuristic function (Manhattan distance)
   * @param {Object} a - Position {x, y}
   * @param {Object} b - Position {x, y}
   * @returns {number} Estimated distance
   */
  heuristic(a, b) {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }

  /**
   * Get walkable neighbors of a position
   * @param {Object} pos - Position {x, y}
   * @returns {Array<Object>} Array of neighboring positions
   */
  getNeighbors(pos) {
    const neighbors = [];
    const directions = [
      { x: 1, y: 0 },   // East
      { x: -1, y: 0 },  // West
      { x: 0, y: 1 },   // South
      { x: 0, y: -1 },  // North
    ];

    for (const dir of directions) {
      const neighbor = {
        x: pos.x + dir.x,
        y: pos.y + dir.y
      };

      // Check if neighbor is walkable
      if (this.worldState.isWalkable(neighbor.x, neighbor.y)) {
        neighbors.push(neighbor);
      }
    }

    return neighbors;
  }

  /**
   * Reconstruct path from A* result
   * @param {Map} cameFrom - Map of node predecessors
   * @param {Object} current - Final position
   * @returns {Array<Object>} Path from start to goal
   */
  reconstructPath(cameFrom, current) {
    const path = [current];
    let currentKey = this.posKey(current);

    while (cameFrom.has(currentKey)) {
      current = cameFrom.get(currentKey);
      currentKey = this.posKey(current);
      path.unshift(current);
    }

    return path;
  }

  /**
   * Create unique key for position
   * @param {Object} pos - Position {x, y}
   * @returns {string} Unique key
   */
  posKey(pos) {
    return `${pos.x},${pos.y}`;
  }

  /**
   * Get cached path if available and not expired
   * @param {Object} start - Start position
   * @param {Object} goal - Goal position
   * @returns {Array<Object>|null} Cached path or null
   */
  getFromCache(start, goal) {
    const key = `${this.posKey(start)}->${this.posKey(goal)}`;
    const cached = this.pathCache.get(key);

    if (cached) {
      const age = Date.now() - cached.timestamp;
      if (age < this.cacheMaxAge) {
        return cached.path;
      } else {
        this.pathCache.delete(key);
      }
    }

    return null;
  }

  /**
   * Add path to cache
   * @param {Object} start - Start position
   * @param {Object} goal - Goal position
   * @param {Array<Object>} path - Computed path
   */
  addToCache(start, goal, path) {
    const key = `${this.posKey(start)}->${this.posKey(goal)}`;
    this.pathCache.set(key, {
      path: path,
      timestamp: Date.now()
    });

    // Limit cache size
    if (this.pathCache.size > 100) {
      const oldestKey = this.pathCache.keys().next().value;
      this.pathCache.delete(oldestKey);
    }
  }

  /**
   * Clear the path cache
   */
  clearCache() {
    this.pathCache.clear();
  }

  /**
   * Smooth path by removing unnecessary waypoints
   * @param {Array<Object>} path - Original path
   * @returns {Array<Object>} Smoothed path
   */
  smoothPath(path) {
    if (path.length <= 2) {
      return path;
    }

    const smoothed = [path[0]];
    let current = 0;

    while (current < path.length - 1) {
      // Try to find the furthest visible point
      let furthest = current + 1;

      for (let i = path.length - 1; i > current + 1; i--) {
        if (this.hasLineOfSight(path[current], path[i])) {
          furthest = i;
          break;
        }
      }

      smoothed.push(path[furthest]);
      current = furthest;
    }

    return smoothed;
  }

  /**
   * Check if there's line of sight between two positions
   * @param {Object} a - Position {x, y}
   * @param {Object} b - Position {x, y}
   * @returns {boolean} True if line of sight exists
   */
  hasLineOfSight(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.ceil(distance);

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = Math.round(a.x + dx * t);
      const y = Math.round(a.y + dy * t);

      if (!this.worldState.isWalkable(x, y)) {
        return false;
      }
    }

    return true;
  }
}
