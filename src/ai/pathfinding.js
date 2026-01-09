/**
 * A* Pathfinding Algorithm
 * For grid-based navigation in the maze
 */

class MinHeap {
  constructor() {
    this.idx = [];
    this.f = [];
    this.g = [];
  }

  get size() {
    return this.idx.length;
  }

  push(idx, f, g) {
    const i = this.idx.length;
    this.idx.push(idx);
    this.f.push(f);
    this.g.push(g);
    this.bubbleUp(i);
  }

  bubbleUp(i) {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.f[i] >= this.f[parent]) break;

      let tmp = this.idx[i];
      this.idx[i] = this.idx[parent];
      this.idx[parent] = tmp;

      tmp = this.f[i];
      this.f[i] = this.f[parent];
      this.f[parent] = tmp;

      tmp = this.g[i];
      this.g[i] = this.g[parent];
      this.g[parent] = tmp;

      i = parent;
    }
  }

  pop() {
    const n = this.idx.length;
    if (n === 0) return null;

    const outIdx = this.idx[0];
    const outG = this.g[0];

    if (n === 1) {
      this.idx.pop();
      this.f.pop();
      this.g.pop();
      return { idx: outIdx, g: outG };
    }

    this.idx[0] = this.idx[n - 1];
    this.f[0] = this.f[n - 1];
    this.g[0] = this.g[n - 1];
    this.idx.pop();
    this.f.pop();
    this.g.pop();

    this.sinkDown(0);
    return { idx: outIdx, g: outG };
  }

  sinkDown(i) {
    const n = this.idx.length;
    while (true) {
      const left = i * 2 + 1;
      const right = left + 1;
      let smallest = i;

      if (left < n && this.f[left] < this.f[smallest]) smallest = left;
      if (right < n && this.f[right] < this.f[smallest]) smallest = right;

      if (smallest === i) break;

      let tmp = this.idx[i];
      this.idx[i] = this.idx[smallest];
      this.idx[smallest] = tmp;

      tmp = this.f[i];
      this.f[i] = this.f[smallest];
      this.f[smallest] = tmp;

      tmp = this.g[i];
      this.g[i] = this.g[smallest];
      this.g[smallest] = tmp;

      i = smallest;
    }
  }
}

export class Pathfinding {
  constructor(worldState) {
    this.worldState = worldState;
    this.pathCache = new Map(); // Cache computed paths
    this.cacheMaxAge = 5000; // 5 seconds
    this._dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];

    this._scratch = {
      width: 0,
      height: 0,
      size: 0,
      stamp: 1,
      gScore: null,
      gStamp: null,
      cameFrom: null,
      closedStamp: null
    };
  }

  ensureScratch(width, height) {
    const w = Number(width) || 0;
    const h = Number(height) || 0;
    const size = w > 0 && h > 0 ? w * h : 0;
    const s = this._scratch;

    if (!size) {
      s.width = 0;
      s.height = 0;
      s.size = 0;
      s.gScore = null;
      s.gStamp = null;
      s.cameFrom = null;
      s.closedStamp = null;
      s.stamp = 1;
      return s;
    }

    const needNew =
      s.width !== w ||
      s.height !== h ||
      s.size !== size ||
      !s.gScore ||
      s.gScore.length !== size;

    if (needNew) {
      s.width = w;
      s.height = h;
      s.size = size;
      s.stamp = 1;
      s.gScore = new Int32Array(size);
      s.gStamp = new Uint32Array(size);
      s.cameFrom = new Int32Array(size);
      s.closedStamp = new Uint32Array(size);
      return s;
    }

    // Move to a new stamp (avoid clearing large arrays every run).
    s.stamp = (s.stamp + 1) >>> 0;
    if (s.stamp === 0) {
      // Extremely unlikely wrap: reset stamps.
      s.gStamp.fill(0);
      s.closedStamp.fill(0);
      s.stamp = 1;
    }
    return s;
  }

  /**
   * Find path from start to goal using A* algorithm
   * @param {Object} start - Grid position {x, y}
   * @param {Object} goal - Grid position {x, y}
   * @param {boolean} useCache - Whether to use cached paths
   * @returns {Array<Object>} Array of grid positions forming the path
   */
  findPath(start, goal, useCache = true, avoidMask = null) {
    const hasAvoid = !!(avoidMask && typeof avoidMask.has === 'function' && avoidMask.size > 0);
    const allowCache = !!useCache && !hasAvoid;

    // Check cache first
    if (allowCache) {
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

    // Prefer WorldState width/height; fall back to grid dimensions if needed.
    const width = this.worldState?.width || this.worldState?.grid?.[0]?.length || 0;
    const height = this.worldState?.height || this.worldState?.grid?.length || 0;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return [];
    }

    const scratch = this.ensureScratch(width, height);
    const stamp = scratch.stamp;
    const gScore = scratch.gScore;
    const gStamp = scratch.gStamp;
    const cameFrom = scratch.cameFrom;
    const closedStamp = scratch.closedStamp;

    const startIdx = start.y * width + start.x;
    const goalIdx = goal.y * width + goal.x;

    if (startIdx === goalIdx) {
      return [{ x: start.x, y: start.y }];
    }

    const heap = new MinHeap();

    const maxIterations = Math.max(1000, width * height * 2);
    const useBudget = width * height > 5000;
    const budgetMs = 12;
    const startMs = useBudget
      ? (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now())
      : 0;

    const goalX = goal.x;
    const goalY = goal.y;

    // AvoidMask: support Set<string> ("x,y") and Set<number> (idx).
    let avoidUsesNumbers = false;
    if (hasAvoid && typeof avoidMask?.[Symbol.iterator] === 'function') {
      for (const k of avoidMask) {
        avoidUsesNumbers = typeof k === 'number';
        break;
      }
    }

    const isAvoided = (x, y, idx) => {
      if (!hasAvoid) return false;
      if (avoidUsesNumbers) return avoidMask.has(idx);
      return avoidMask.has(`${x},${y}`);
    };

    gScore[startIdx] = 0;
    gStamp[startIdx] = stamp;
    cameFrom[startIdx] = -1;
    heap.push(startIdx, this.heuristic(start, goal), 0);

    let iterations = 0;
    while (heap.size > 0 && iterations < maxIterations) {
      iterations++;

      if (useBudget && (iterations & 0xff) === 0) {
        const nowMs = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
        if (nowMs - startMs > budgetMs) {
          console.warn('⚠️ A* pathfinding budget exceeded');
          break;
        }
      }

      const node = heap.pop();
      if (!node) break;
      const idx = node.idx;
      const g = node.g;

      if (gStamp[idx] !== stamp) continue;
      if (g !== gScore[idx]) continue; // stale queue entry
      if (closedStamp[idx] === stamp) continue;
      closedStamp[idx] = stamp;

      if (idx === goalIdx) {
        const path = this.reconstructPathFromIndex(cameFrom, startIdx, goalIdx, width, stamp, gStamp);
        if (allowCache && path.length > 0) {
          this.addToCache(start, goal, path);
        }
        return path;
      }

      const x = idx % width;
      const y = (idx / width) | 0;

      // Explore 4-neighborhood.
      for (let i = 0; i < this._dirs.length; i++) {
        const nx = x + this._dirs[i][0];
        const ny = y + this._dirs[i][1];
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (!this.worldState.isWalkable(nx, ny)) continue;

        const nIdx = ny * width + nx;
        if (closedStamp[nIdx] === stamp) continue;
        if (isAvoided(nx, ny, nIdx)) continue;

        const tentativeG = g + 1;
        const known = gStamp[nIdx] === stamp ? gScore[nIdx] : 2147483647;
        if (tentativeG >= known) continue;

        cameFrom[nIdx] = idx;
        gScore[nIdx] = tentativeG;
        gStamp[nIdx] = stamp;

        const f = tentativeG + (Math.abs(nx - goalX) + Math.abs(ny - goalY));
        heap.push(nIdx, f, tentativeG);
      }
    }

    if (iterations >= maxIterations) {
      console.warn('⚠️ A* max iterations reached');
    }
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

  reconstructPathFromIndex(cameFrom, startIdx, goalIdx, width, stamp, gStamp) {
    if (startIdx === goalIdx) {
      const x = startIdx % width;
      const y = (startIdx / width) | 0;
      return [{ x, y }];
    }

    if (gStamp[goalIdx] !== stamp) return [];
    if (cameFrom[goalIdx] === -1) return [];

    const out = [];
    let cur = goalIdx;
    let guard = 0;
    const max = (gStamp?.length || 0) + 10;

    while (cur !== -1 && guard < max) {
      const x = cur % width;
      const y = (cur / width) | 0;
      out.push({ x, y });
      if (cur === startIdx) break;
      cur = cameFrom[cur];
      guard++;
    }

    if (out.length === 0 || out[out.length - 1].x !== (startIdx % width) || out[out.length - 1].y !== ((startIdx / width) | 0)) {
      return [];
    }

    out.reverse();
    return out;
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
        // Return a copy so callers can shift/splice without corrupting the cache.
        return Array.isArray(cached.path) ? cached.path.slice() : null;
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
      path: Array.isArray(path) ? path.slice() : [],
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
    if (!Array.isArray(path) || path.length <= 2) {
      return path || [];
    }

    // NOTE: Keep smoothing axis-aligned only.
    // Line-of-sight smoothing can create diagonal "shortcuts" that cut corners,
    // causing agents to attempt moving through walls/obstacles in tight mazes.
    const smoothed = [path[0]];

    let prev = path[0];
    let prevDir = null;

    for (let i = 1; i < path.length; i++) {
      const cur = path[i];
      const dx = Math.sign(cur.x - prev.x);
      const dy = Math.sign(cur.y - prev.y);

      // Skip duplicates / zero-length steps defensively.
      if (dx === 0 && dy === 0) {
        prev = cur;
        continue;
      }

      const dir = `${dx},${dy}`;
      if (prevDir === null) {
        prevDir = dir;
      } else if (dir !== prevDir) {
        smoothed.push(prev);
        prevDir = dir;
      }

      prev = cur;
    }

    smoothed.push(path[path.length - 1]);

    // Deduplicate consecutive identical points (defensive)
    const out = [];
    for (const p of smoothed) {
      const last = out[out.length - 1];
      if (last && last.x === p.x && last.y === p.y) continue;
      out.push(p);
    }
    return out;
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
