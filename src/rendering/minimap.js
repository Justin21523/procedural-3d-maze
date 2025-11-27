/**
 * Minimap renderer for debugging and navigation
 * Displays a 2D top-down view of the maze
 */

import { TILE_TYPES, ROOM_TYPES, ROOM_CONFIGS } from '../world/tileTypes.js';

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

    // Colors
    this.colors = {
      wall: '#1a1a1a',
      floor: '#e0e0e0',
      player: '#32cd32',
      monster: '#ff1493',
      exit: '#00ff00',  // Bright green for exit
      mission: '#ffa726', // 任務點顏色（橙色）
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
    };

    // Calculate scale to fit maze in canvas
    this.updateScale();
  }

  /**
   * Resize canvas and recalc scale.
   * @param {number} size
   */
  resize(size) {
    this.canvas.width = size;
    this.canvas.height = size;
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

    // Calculate pixel size for each tile
    this.tileSize = Math.floor(Math.min(
      this.canvas.width / width,
      this.canvas.height / height
    ));

    // Calculate offsets to center the maze
    this.offsetX = (this.canvas.width - width * this.tileSize) / 2;
    this.offsetY = (this.canvas.height - height * this.tileSize) / 2;
  }

  /**
   * Render the minimap
   * @param {Array} monsters - Array of monster positions (optional)
   * @param {Object} exitPosition - Exit grid position {x, y} (optional)
   * @param {Array} missionPositions - Array of mission grid positions (optional)
   */
  render(playerPosition, monsters = [], exitPosition = null, missionPositions = []) {
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

    // Clear canvas
    ctx.fillStyle = this.colors.background;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Draw grid
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const px = this.offsetX + x * this.tileSize;
        const py = this.offsetY + y * this.tileSize;

        // Draw tile
        if (grid[y][x] === TILE_TYPES.WALL) {
          ctx.fillStyle = this.colors.wall;
        } else {
          // Use room color if available
          if (roomMap && roomMap[y] && roomMap[y][x] !== undefined) {
            const roomType = roomMap[y][x];
            const color = this.roomColors[roomType];
            if (color) {
              ctx.fillStyle = color;
            } else {
              console.warn(`No color for room type ${roomType} at (${x},${y})`);
              ctx.fillStyle = this.colors.floor;
            }
          } else {
            // No room map - use default floor color
            ctx.fillStyle = this.colors.floor;
          }
        }

        ctx.fillRect(px, py, this.tileSize, this.tileSize);

        // Draw grid lines (optional, for better visibility)
        if (this.tileSize > 4) {
          ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
          ctx.strokeRect(px, py, this.tileSize, this.tileSize);
        }
      }
    }

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
          this.tileSize / 2,  // Full size
          0,
          Math.PI * 2
        );
        ctx.fill();

        // Add white border for better visibility
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    });

    // Draw exit point (glowing green star)
    if (exitPosition && exitPosition.x !== undefined && exitPosition.y !== undefined) {
      const px = this.offsetX + exitPosition.x * this.tileSize;
      const py = this.offsetY + exitPosition.y * this.tileSize;

      // Draw pulsing glow
      const pulseTime = Date.now() / 500;
      const pulseSize = this.tileSize * (0.6 + Math.sin(pulseTime) * 0.2);

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
      ctx.lineWidth = 2;
      ctx.beginPath();
      const starPoints = 5;
      const outerRadius = this.tileSize * 0.4;
      const innerRadius = this.tileSize * 0.2;
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
          Math.max(2, this.tileSize * 0.25),
          0,
          Math.PI * 2
        );
        ctx.fill();

        // 白色邊框讓顏色更明顯
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
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
        this.tileSize / 2,
        0,
        Math.PI * 2
      );
      ctx.fill();

      // Player direction indicator (small line)
      ctx.strokeStyle = this.colors.player;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px + this.tileSize / 2, py + this.tileSize / 2);
      ctx.lineTo(
        px + this.tileSize / 2,
        py + this.tileSize / 2 - this.tileSize / 2
      );
      ctx.stroke();
    }
  }

  /**
   * Update canvas size
   * @param {number} width - New width
   * @param {number} height - New height
   */
  resize(width, height) {
    this.canvas.width = width;
    this.canvas.height = height;
    this.updateScale();
  }
}
