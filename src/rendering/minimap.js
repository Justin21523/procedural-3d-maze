/**
 * Minimap renderer for debugging and navigation
 * Displays a 2D top-down view of the maze
 */

import { TILE_TYPES, ROOM_TYPES, ROOM_CONFIGS } from '../world/tileTypes.js';
import { CONFIG } from '../core/config.js';

export class Minimap {
  /**
   * Create a minimap renderer
   * @param {HTMLCanvasElement} canvas - Canvas element for minimap
   * @param {WorldState} worldState - Reference to world state
   */
  constructor(canvas, worldState) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.worldState = worldState;
    this.zoom = 1.1;
    this.showObstacles = false;
    this.baseCanvas = null;
    this.baseCtx = null;
    this.baseKey = '';
    this._lastGridRef = null;
    this._lastRoomMapRef = null;
    this._lastObstacleMapRef = null;

    // Colors
    this.colors = {
      wall: '#1a1a1a',
      floor: '#e0e0e0',
      player: '#32cd32',
      monster: '#ff1493',
      exit: '#00ff00',  // Bright green for exit
      mission: '#ffa726', // 任務點顏色（橙色）
      pickupAmmo: '#66aaff',
      pickupHealth: '#66ff99',
      pickupLure: '#ff7043',
      pickupTrap: '#42a5f5',
      pickupJammer: '#ba68c8',
      pickupDecoy: '#ff5252',
      pickupSmoke: '#b0bec5',
      pickupFlash: '#fff59d',
      pickupSensor: '#4dd0e1',
      pickupMine: '#ff1744',
      device: '#ffffff',
      background: '#000000',
    };

    // Room colors for minimap - vivid colors for easy distinction
    this.roomColors = {
      [ROOM_TYPES.CORRIDOR]: '#ffeb3b',   // Bright yellow
      [ROOM_TYPES.CLASSROOM]: '#2196f3',  // Bright blue
      [ROOM_TYPES.OFFICE]: '#ff5722',     // Deep orange
      [ROOM_TYPES.BATHROOM]: '#00bcd4',   // Cyan
      [ROOM_TYPES.STORAGE]: '#9e9e9e',    // Gray
      [ROOM_TYPES.LIBRARY]: '#9c27b0',    // Purple
      [ROOM_TYPES.POOL]: '#00acc1',       // Teal
      [ROOM_TYPES.GYM]: '#4caf50',        // Green
      [ROOM_TYPES.BEDROOM]: '#bcaaa4',    // Beige
      [ROOM_TYPES.CLASSROOMS_BLOCK]: '#64b5f6', // Light blue
      [ROOM_TYPES.LAB]: '#80deea',              // Light cyan
      [ROOM_TYPES.CAFETERIA]: '#ffcc80',        // Light orange
      [ROOM_TYPES.MEDICAL]: '#90caf9',          // Medical blue
      [ROOM_TYPES.ARMORY]: '#ffb300',           // Armory amber
      [ROOM_TYPES.CONTROL]: '#4dd0e1',          // Control cyan
    };

    // Calculate scale to fit maze in canvas
    this.updateScale();
  }

  invalidateBase() {
    this.baseKey = '';
  }

  /**
   * Toggle obstacleMap overlay rendering.
   * @param {boolean} enabled
   */
  setShowObstacles(enabled) {
    this.showObstacles = !!enabled;
    this.invalidateBase();
  }

  /**
   * Resize canvas and recalc scale.
   * @param {number} width
   * @param {number} height
   */
  resize(width, height = width) {
    const w = Math.max(1, Math.round(Number(width) || 0));
    const h = Math.max(1, Math.round(Number(height) || 0));
    this.canvas.width = w;
    this.canvas.height = h;
    this.updateScale();
    this.invalidateBase();
  }

  /**
   * Set zoom multiplier for tile size.
   * @param {number} zoom
   */
  setZoom(zoom) {
    this.zoom = Math.max(0.5, zoom);
    this.updateScale();
  }

  /**
   * Update scale based on maze size
   */
  updateScale() {
    const grid = this.worldState.getGrid();
    if (!grid) return;

    const width = grid[0].length;
    const height = grid.length;

    // Always fit the entire maze in the minimap canvas.
    // Zoom is handled as marker scaling so we never crop the full map thumbnail.
    const base = Math.min(this.canvas.width / width, this.canvas.height / height);
    if (!Number.isFinite(base) || base <= 0) return;
    this.tileSize = base;

    // Calculate offsets to center the maze
    this.offsetX = (this.canvas.width - width * this.tileSize) / 2;
    this.offsetY = (this.canvas.height - height * this.tileSize) / 2;
  }

  ensureBase(grid, roomMap) {
    if (!grid || !this.canvas) return;

    const gridW = grid[0]?.length || 0;
    const gridH = grid.length || 0;
    if (gridW <= 0 || gridH <= 0) return;

    if (!this.baseCanvas) {
      this.baseCanvas = document.createElement('canvas');
      this.baseCtx = this.baseCanvas.getContext('2d');
    }
    if (!this.baseCtx || !this.baseCanvas) return;

    const obstacleMap = this.worldState?.obstacleMap || null;
    const key = `${gridW}x${gridH}:${this.canvas.width}x${this.canvas.height}:obs${this.showObstacles ? 1 : 0}:rm${roomMap ? 1 : 0}`;

    const needsRebuild =
      key !== this.baseKey ||
      this._lastGridRef !== grid ||
      this._lastRoomMapRef !== roomMap ||
      this._lastObstacleMapRef !== obstacleMap ||
      this.baseCanvas.width !== this.canvas.width ||
      this.baseCanvas.height !== this.canvas.height;

    if (!needsRebuild) return;

    this.baseKey = key;
    this._lastGridRef = grid;
    this._lastRoomMapRef = roomMap;
    this._lastObstacleMapRef = obstacleMap;

    this.baseCanvas.width = this.canvas.width;
    this.baseCanvas.height = this.canvas.height;

    const ctx = this.baseCtx;
    ctx.fillStyle = this.colors.background;
    ctx.fillRect(0, 0, this.baseCanvas.width, this.baseCanvas.height);

    for (let y = 0; y < gridH; y++) {
      for (let x = 0; x < gridW; x++) {
        const px = this.offsetX + x * this.tileSize;
        const py = this.offsetY + y * this.tileSize;

        if (grid[y][x] === TILE_TYPES.WALL) {
          ctx.fillStyle = this.colors.wall;
        } else if (roomMap && roomMap[y] && roomMap[y][x] !== undefined) {
          const roomType = roomMap[y][x];
          ctx.fillStyle = this.roomColors[roomType] || this.colors.floor;
        } else {
          ctx.fillStyle = this.colors.floor;
        }

        ctx.fillRect(px, py, this.tileSize, this.tileSize);

        if (this.showObstacles && obstacleMap?.[y]?.[x] && grid[y][x] !== TILE_TYPES.WALL) {
          ctx.fillStyle = 'rgba(255, 0, 0, 0.32)';
          ctx.fillRect(px, py, this.tileSize, this.tileSize);

          if (this.tileSize >= 8) {
            ctx.strokeStyle = 'rgba(255, 0, 0, 0.55)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(px + 1, py + 1);
            ctx.lineTo(px + this.tileSize - 1, py + this.tileSize - 1);
            ctx.moveTo(px + this.tileSize - 1, py + 1);
            ctx.lineTo(px + 1, py + this.tileSize - 1);
            ctx.stroke();
          }
        }

        if (this.tileSize > 4) {
          ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
          ctx.strokeRect(px, py, this.tileSize, this.tileSize);
        }
      }
    }
  }

  /**
   * Render the minimap
   * @param {Array} monsters - Array of monster positions (optional)
   * @param {Object} exitPosition - Exit grid position {x, y} (optional)
   * @param {Array} missionPositions - Array of mission grid positions (optional)
   * @param {Object} options
   * @param {Array} options.pickupPositions - Array of pickup grid positions (optional)
   * @param {Array} options.devicePositions - Array of deployed device grid positions (optional)
   */
  render(playerPosition, monsters = [], exitPosition = null, missionPositions = [], options = {}) {
    // Recompute scale each draw to reflect any size/zoom changes
    this.updateScale();

    // 確保 context 在最前面檢查
    const ctx = this.ctx;
    if (!ctx) {
      console.error('Minimap: Canvas context is null!');
      return;
    }

    const grid = this.worldState.getGrid();
    if (!grid) {
      console.warn('Minimap: Grid is null, cannot render');
      return;
    }

    const roomMap = this.worldState.getRoomMap();
    if (!roomMap) {
      console.error('⚠️ MINIMAP: RoomMap is NULL! Colors will not work!');
    }

    const width = grid[0].length;
    const height = grid.length;

    // Debug: Log first render
    if (!this.hasRendered) {
      console.log('✅ Minimap rendering for the first time');
      console.log(`Grid size: ${width}x${height}`);
      console.log(`Canvas size: ${this.canvas.width}x${this.canvas.height}`);
      console.log(`Tile size: ${this.tileSize}px`);
      console.log('RoomMap exists:', !!roomMap);
      if (roomMap) {
        // Count room types in minimap
        const counts = {};
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            if (grid[y][x] !== TILE_TYPES.WALL) {
              const type = roomMap[y][x];
              counts[type] = (counts[type] || 0) + 1;
            }
          }
        }
        console.log('🎨 Room type counts in minimap:', counts);
        console.log('Color mapping:', this.roomColors);
      }
      this.hasRendered = true;
    }

    this.ensureBase(grid, roomMap);
    if (this.baseCanvas) {
      ctx.drawImage(this.baseCanvas, 0, 0);
    } else {
      ctx.fillStyle = this.colors.background;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    // Debug: navigation/path heatmap (monster/player tile visits).
    const navHeat = Array.isArray(options?.navHeat) ? options.navHeat : null;
    if ((CONFIG.DEBUG_NAV_HEATMAP_ENABLED ?? false) && navHeat && navHeat.length === height) {
      let max = 0;
      for (let y = 0; y < height; y++) {
        const row = navHeat[y];
        if (!row) continue;
        for (let x = 0; x < width; x++) {
          const v = Number(row[x]) || 0;
          if (v > max) max = v;
        }
      }
      if (max > 0) {
        const baseAlpha = Math.max(0.05, Math.min(0.95, Number(CONFIG.DEBUG_NAV_HEATMAP_ALPHA) || 0.55));
        for (let y = 0; y < height; y++) {
          const row = navHeat[y];
          if (!row) continue;
          for (let x = 0; x < width; x++) {
            const v = Number(row[x]) || 0;
            if (v <= 0) continue;
            // Non-linear scale keeps hotspots readable.
            const t = Math.sqrt(v / max);
            const a = baseAlpha * Math.max(0.1, Math.min(1.0, t));
            ctx.fillStyle = `rgba(255, 0, 0, ${a.toFixed(3)})`;
            ctx.fillRect(this.offsetX + x * this.tileSize, this.offsetY + y * this.tileSize, this.tileSize, this.tileSize);
          }
        }
      }
    }

    const clampPx = (v, minPx, maxPx) => Math.max(minPx, Math.min(maxPx, v));
    const unit = Number(this.tileSize) || 1;
    const markerScale = clampPx(Number(this.zoom) || 1, 0.75, 3.0);

    const playerRadius = clampPx(unit * 0.42 * markerScale, 1.2, 7);
    const playerIndicator = clampPx(unit * 0.55 * markerScale, 1.8, 10);
    const monsterRadius = clampPx(unit * 0.38 * markerScale, 1.2, 6.5);
    const missionRadius = clampPx(unit * 0.28 * markerScale, 1.0, 5);
    const pickupRadius = clampPx(unit * 0.25 * markerScale, 0.9, 4);
    const deviceRadius = clampPx(unit * 0.3 * markerScale, 1.1, 6);
    const exitOuterRadius = clampPx(unit * 0.55 * markerScale, 2.0, 10);
    const exitInnerRadius = clampPx(exitOuterRadius * 0.5, 1.1, 6);

    // Draw monsters
    if (!this.monstersLoggedOnce && monsters.length > 0) {
      console.log('👹 Minimap drawing monsters:', monsters.length, monsters);
      this.monstersLoggedOnce = true;
    }

    monsters.forEach(monster => {
      if (monster && monster.x !== undefined && monster.y !== undefined) {
        const px = this.offsetX + monster.x * this.tileSize;
        const py = this.offsetY + monster.y * this.tileSize;

        // Draw larger monster dot for visibility
        ctx.fillStyle = this.colors.monster;
        ctx.beginPath();
        ctx.arc(
          px + this.tileSize / 2,
          py + this.tileSize / 2,
          monsterRadius,
          0,
          Math.PI * 2
        );
        ctx.fill();

        // Add white border for better visibility
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = clampPx(monsterRadius * 0.35, 0.75, 2);
        ctx.stroke();
      }
    });

    // AI debug markers (targets / last-known / noises)
    const aiMarkers = Array.isArray(options?.aiMarkers) ? options.aiMarkers : null;
    if (aiMarkers && aiMarkers.length > 0) {
      const baseR = clampPx(unit * 0.22 * markerScale, 0.9, 4.5);
      const ringR = clampPx(baseR * 1.35, 1.2, 6);
      for (const m of aiMarkers) {
        if (!m || !Number.isFinite(m.x) || !Number.isFinite(m.y)) continue;
        const px = this.offsetX + m.x * this.tileSize + this.tileSize / 2;
        const py = this.offsetY + m.y * this.tileSize + this.tileSize / 2;

        const kind = String(m.kind || '');
        const color = typeof m.color === 'string' ? m.color : 'rgba(0,220,255,0.9)';

        if (kind === 'ai_noise' || kind === 'ai_scent') {
          ctx.strokeStyle = color;
          ctx.lineWidth = clampPx(baseR * 0.35, 0.75, 2);
          ctx.beginPath();
          ctx.arc(px, py, ringR, 0, Math.PI * 2);
          ctx.stroke();
          continue;
        }

        if (kind === 'ai_lastKnown') {
          ctx.fillStyle = color;
          const s = clampPx(baseR * 1.5, 1.5, 7);
          ctx.fillRect(px - s / 2, py - s / 2, s, s);
          ctx.strokeStyle = 'rgba(0,0,0,0.45)';
          ctx.lineWidth = 1;
          ctx.strokeRect(px - s / 2, py - s / 2, s, s);
          continue;
        }

        // default: target dot
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(px, py, baseR, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Draw exit point (glowing green star)
    if (exitPosition && exitPosition.x !== undefined && exitPosition.y !== undefined) {
      const px = this.offsetX + exitPosition.x * this.tileSize;
      const py = this.offsetY + exitPosition.y * this.tileSize;

      // Draw pulsing glow
      const pulseTime = Date.now() / 500;
      const pulseSize = exitOuterRadius * (1.0 + Math.sin(pulseTime) * 0.15);

      // Outer glow
      const gradient = ctx.createRadialGradient(
        px + this.tileSize / 2,
        py + this.tileSize / 2,
        0,
        px + this.tileSize / 2,
        py + this.tileSize / 2,
        pulseSize
      );
      gradient.addColorStop(0, 'rgba(0, 255, 0, 0.8)');
      gradient.addColorStop(0.5, 'rgba(0, 255, 0, 0.4)');
      gradient.addColorStop(1, 'rgba(0, 255, 0, 0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(
        px + this.tileSize / 2,
        py + this.tileSize / 2,
        pulseSize,
        0,
        Math.PI * 2
      );
      ctx.fill();

      // Draw star shape
      ctx.fillStyle = this.colors.exit;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = clampPx(exitOuterRadius * 0.22, 0.8, 2);
      ctx.beginPath();
      const starPoints = 5;
      const outerRadius = exitOuterRadius;
      const innerRadius = exitInnerRadius;
      const centerX = px + this.tileSize / 2;
      const centerY = py + this.tileSize / 2;

      for (let i = 0; i < starPoints * 2; i++) {
        const angle = (i * Math.PI) / starPoints - Math.PI / 2;
        const radius = i % 2 === 0 ? outerRadius : innerRadius;
        const x = centerX + Math.cos(angle) * radius;
        const y = centerY + Math.sin(angle) * radius;
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }


    // Draw mission points（未收集）
    if (missionPositions && missionPositions.length > 0) {
      missionPositions.forEach(mp => {
        if (!mp || mp.x === undefined || mp.y === undefined) return;
        const px = this.offsetX + mp.x * this.tileSize;
        const py = this.offsetY + mp.y * this.tileSize;

        ctx.fillStyle = this.colors.mission;
        ctx.beginPath();
        ctx.arc(
          px + this.tileSize / 2,
          py + this.tileSize / 2,
          missionRadius,
          0,
          Math.PI * 2
        );
        ctx.fill();

        // 白色邊框讓顏色更明顯
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = clampPx(missionRadius * 0.35, 0.6, 1.2);
        ctx.stroke();
      });
    }

    const pickupPositions = Array.isArray(options?.pickupPositions) ? options.pickupPositions : [];
    if (pickupPositions.length > 0) {
      const colorForPickup = (kind) => {
        const k = String(kind || '').toLowerCase();
        if (k === 'health') return this.colors.pickupHealth;
        if (k === 'ammo') return this.colors.pickupAmmo;
        if (k === 'lure') return this.colors.pickupLure;
        if (k === 'lure_sticky') return this.colors.pickupLure;
        if (k === 'trap') return this.colors.pickupTrap;
        if (k === 'jammer') return this.colors.pickupJammer;
        if (k === 'decoy') return this.colors.pickupDecoy;
        if (k === 'decoy_delay') return this.colors.pickupDecoy;
        if (k === 'smoke') return this.colors.pickupSmoke;
        if (k === 'smoke_weak') return this.colors.pickupSmoke;
        if (k === 'smoke_strong') return this.colors.pickupSmoke;
        if (k === 'flash') return this.colors.pickupFlash;
        if (k === 'sensor') return this.colors.pickupSensor;
        if (k === 'mine') return this.colors.pickupMine;
        if (k === 'scent_spray') return this.colors.pickupJammer;
        if (k === 'door_wedge') return this.colors.pickupTrap;
        if (k === 'glowstick') return this.colors.pickupHealth;
        if (k === 'sonar_pulse') return this.colors.pickupSensor;
        if (k === 'emp_charge') return this.colors.pickupAmmo;
        if (k === 'fake_hack') return this.colors.pickupSensor;
        return '#ffffff';
      };

      pickupPositions.forEach(p => {
        if (!p || p.x === undefined || p.y === undefined) return;
        const px = this.offsetX + p.x * this.tileSize;
        const py = this.offsetY + p.y * this.tileSize;
        const cx = px + this.tileSize / 2;
        const cy = py + this.tileSize / 2;

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = colorForPickup(p.kind);
        ctx.fillRect(-pickupRadius, -pickupRadius, pickupRadius * 2, pickupRadius * 2);
        ctx.restore();
      });
    }

    const devicePositions = Array.isArray(options?.devicePositions) ? options.devicePositions : [];
    if (devicePositions.length > 0) {
      const colorForDevice = (kind) => {
        const k = String(kind || '').toLowerCase();
        if (k === 'lure') return this.colors.pickupLure;
        if (k === 'lure_sticky') return this.colors.pickupLure;
        if (k === 'trap') return this.colors.pickupTrap;
        if (k === 'jammer') return this.colors.pickupJammer;
        if (k === 'sensor') return this.colors.pickupSensor;
        if (k === 'mine') return this.colors.pickupMine;
        if (k === 'glowstick') return this.colors.pickupHealth;
        if (k === 'faketerminal') return this.colors.pickupSensor;
        if (k === 'doorwedge') return this.colors.pickupTrap;
        return this.colors.device;
      };

      devicePositions.forEach(d => {
        if (!d || d.x === undefined || d.y === undefined) return;
        const px = this.offsetX + d.x * this.tileSize;
        const py = this.offsetY + d.y * this.tileSize;

        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = clampPx(deviceRadius * 0.35, 0.75, 2);
        ctx.fillStyle = colorForDevice(d.kind);
        ctx.beginPath();
        ctx.arc(
          px + this.tileSize / 2,
          py + this.tileSize / 2,
          deviceRadius,
          0,
          Math.PI * 2
        );
        ctx.fill();
        ctx.stroke();
      });
    }

    // Draw player (on top)
    if (playerPosition) {
      const px = this.offsetX + playerPosition.x * this.tileSize;
      const py = this.offsetY + playerPosition.y * this.tileSize;

      // Player dot
      ctx.fillStyle = this.colors.player;
      ctx.beginPath();
      ctx.arc(
        px + this.tileSize / 2,
        py + this.tileSize / 2,
        playerRadius,
        0,
        Math.PI * 2
      );
      ctx.fill();

      // Player direction indicator (small line)
      ctx.strokeStyle = this.colors.player;
      ctx.lineWidth = clampPx(playerRadius * 0.35, 0.8, 2);
      ctx.beginPath();
      ctx.moveTo(px + this.tileSize / 2, py + this.tileSize / 2);
      ctx.lineTo(
        px + this.tileSize / 2,
        py + this.tileSize / 2 - playerIndicator
      );
      ctx.stroke();
    }
  }
}
