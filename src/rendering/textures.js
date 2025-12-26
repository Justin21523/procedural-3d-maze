/**
 * Procedural texture generation for various room types
 * Creates textures programmatically without needing image files
 */

import * as THREE from 'three';
import { ROOM_TYPES, getRoomConfig } from '../world/tileTypes.js';

export function createNormalMap(scale = 2) {
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // Simple tiling noise to fake bumps
      const nx = Math.sin((x + Math.random() * 2) * 0.15) * 0.5;
      const ny = Math.cos((y + Math.random() * 2) * 0.15) * 0.5;
      // Convert to tangent-space normal color
      data[i] = Math.floor((nx * 0.5 + 0.5) * 255);
      data[i + 1] = Math.floor((ny * 0.5 + 0.5) * 255);
      data[i + 2] = 255;
      data[i + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(scale, scale);
  texture.needsUpdate = true;
  return texture;
}

/**
 * Create a simple noise pattern
 * @param {number} size - Texture size (power of 2)
 * @param {number} intensity - Noise intensity (0-1)
 * @returns {Uint8Array} Texture data
 */
function createNoise(size, intensity) {
  const data = new Uint8Array(size * size * 4);

  for (let i = 0; i < size * size; i++) {
    const noise = Math.random() * intensity;
    const base = 220; // Light base color
    const value = Math.floor(base + noise * 35);

    data[i * 4] = value;     // R
    data[i * 4 + 1] = value; // G
    data[i * 4 + 2] = value; // B
    data[i * 4 + 3] = 255;   // A
  }

  return data;
}

/**
 * Create a dirty wall texture with stains and variations
 * Backrooms aesthetic: yellowed, slightly dirty walls
 * @returns {THREE.DataTexture} Wall texture
 */
export function createWallTexture() {
  const size = 256;
  const data = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;

      // Base yellowed color
      let r = 232;
      let g = 220;
      let b = 192;

      // Add some variation and "dirt"
      const noise = Math.random();
      const stain = Math.random() < 0.02 ? -20 : 0; // Random stains

      r += Math.floor(noise * 15 - 7) + stain;
      g += Math.floor(noise * 15 - 7) + stain;
      b += Math.floor(noise * 15 - 7) + stain;

      // Subtle grid pattern (wallpaper seams)
      if (x % 64 === 0 || y % 64 === 0) {
        r -= 5;
        g -= 5;
        b -= 5;
      }

      data[i] = Math.max(0, Math.min(255, r));
      data[i + 1] = Math.max(0, Math.min(255, g));
      data[i + 2] = Math.max(0, Math.min(255, b));
      data[i + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(data, size, size);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;

  console.log('✨ Created procedural wall texture');
  return texture;
}

/**
 * Create a carpet/floor texture
 * Backrooms aesthetic: worn, yellowish carpet
 * @returns {THREE.DataTexture} Floor texture
 */
export function createFloorTexture() {
  const size = 256;
  const data = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;

      // Base carpet color (darker than walls)
      let r = 201;
      let g = 185;
      let b = 152;

      // Add carpet texture (more noise than walls)
      const noise = Math.random();
      r += Math.floor(noise * 25 - 12);
      g += Math.floor(noise * 25 - 12);
      b += Math.floor(noise * 25 - 12);

      // Random worn spots
      if (Math.random() < 0.05) {
        r -= 15;
        g -= 15;
        b -= 15;
      }

      // Carpet fiber pattern (small grid)
      if ((x + y) % 2 === 0) {
        r += 2;
        g += 2;
        b += 2;
      }

      data[i] = Math.max(0, Math.min(255, r));
      data[i + 1] = Math.max(0, Math.min(255, g));
      data[i + 2] = Math.max(0, Math.min(255, b));
      data[i + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(data, size, size);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;

  console.log('✨ Created procedural floor texture');
  return texture;
}

/**
 * Create a ceiling tile texture
 * Backrooms aesthetic: acoustic ceiling tiles
 * @returns {THREE.DataTexture} Ceiling texture
 */
export function createCeilingTexture() {
  const size = 256;
  const data = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;

      // Base ceiling color (lighter than walls)
      let r = 240;
      let g = 232;
      let b = 208;

      // Acoustic tile pattern (grid of tiles)
      const tileSize = 64;
      const gridX = x % tileSize;
      const gridY = y % tileSize;

      // Tile borders (dark lines)
      if (gridX < 2 || gridY < 2) {
        r -= 40;
        g -= 40;
        b -= 40;
      } else {
        // Tile holes pattern (acoustic texture)
        if (gridX % 8 < 4 && gridY % 8 < 4) {
          r -= 10;
          g -= 10;
          b -= 10;
        }
      }

      // Add slight noise
      const noise = Math.random() * 10 - 5;
      r += noise;
      g += noise;
      b += noise;

      data[i] = Math.max(0, Math.min(255, r));
      data[i + 1] = Math.max(0, Math.min(255, g));
      data[i + 2] = Math.max(0, Math.min(255, b));
      data[i + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(data, size, size);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;

  console.log('✨ Created procedural ceiling texture');
  return texture;
}

/**
 * Perlin-style noise function for smoother patterns
 */
function smoothNoise(x, y, seed = 0) {
  const n = x + y * 57 + seed * 131;
  return (Math.sin(n * 12.9898) * Math.sin(n * 78.233)) * 0.5 + 0.5;
}

/**
 * Create a room-specific wall texture based on room type
 * @param {number} roomType - Room type from ROOM_TYPES
 * @returns {THREE.DataTexture} Wall texture
 */
export function createRoomWallTexture(roomType) {
  const config = getRoomConfig(roomType);
  const size = 512; // Higher resolution for better quality
  const data = new Uint8Array(size * size * 4);

  // Extract RGB from hex color
  const r_base = (config.wallColor >> 16) & 255;
  const g_base = (config.wallColor >> 8) & 255;
  const b_base = config.wallColor & 255;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;

      let r = r_base;
      let g = g_base;
      let b = b_base;

      // Room-specific patterns with enhanced detail
      switch (roomType) {
        case ROOM_TYPES.CLASSROOM:
          // Clean painted wall with whiteboard grid
          const boardGrid = 256;
          if (x % boardGrid < 3 || y % (boardGrid/2) < 3) {
            r -= 12; g -= 12; b -= 12;
          }
          // Smooth subtle paint texture
          const paintVariation = smoothNoise(Math.floor(x/4), Math.floor(y/4), 1) * 10 - 5;
          r += paintVariation; g += paintVariation; b += paintVariation;
          // Very occasional small marks
          if (Math.random() < 0.0005) {
            r -= 30; g -= 30; b -= 30;
          }
          break;

        case ROOM_TYPES.OFFICE:
          // Professional wallpaper with pattern
          const stripeSize = 48;
          const stripeVariation = Math.sin(x / stripeSize) * 8;
          r += stripeVariation; g += stripeVariation; b += stripeVariation;
          // Subtle damask-like pattern
          if ((Math.floor(x/24) + Math.floor(y/24)) % 2 === 0) {
            r -= 8; g -= 8; b -= 8;
          }
          // Smooth texture
          const wallpaperNoise = smoothNoise(Math.floor(x/3), Math.floor(y/3), 2) * 12 - 6;
          r += wallpaperNoise; g += wallpaperNoise * 0.9; b += wallpaperNoise * 0.85;
          break;

        case ROOM_TYPES.BATHROOM:
          // Ceramic tile pattern with grout
          const tileSize = 64;
          const groutWidth = 3;
          const tx = x % tileSize;
          const ty = y % tileSize;

          if (tx < groutWidth || ty < groutWidth) {
            // Dark grout
            r -= 35; g -= 35; b -= 35;
          } else {
            // Glossy tile with subtle reflections
            const glossiness = smoothNoise(Math.floor(x/tileSize), Math.floor(y/tileSize), 3) * 25;
            r += glossiness; g += glossiness; b += glossiness;
            // Tile surface variation
            const tileVar = smoothNoise(x, y, 4) * 12 - 6;
            r += tileVar; g += tileVar; b += tileVar;
          }
          break;

        case ROOM_TYPES.STORAGE:
          // Rough concrete with cracks and stains
          const concreteBase = smoothNoise(Math.floor(x/8), Math.floor(y/8), 5) * 40 - 20;
          r += concreteBase; g += concreteBase; b += concreteBase;
          // Fine concrete texture
          const fineTexture = Math.random() * 20 - 10;
          r += fineTexture; g += fineTexture; b += fineTexture;
          // Cracks (using sine patterns)
          if (Math.abs(Math.sin(x * 0.05 + y * 0.03) * Math.sin(y * 0.04)) > 0.98) {
            r -= 50; g -= 50; b -= 50;
          }
          // Water stains
          if (smoothNoise(Math.floor(x/20), Math.floor(y/20), 6) < 0.15) {
            r -= 25; g -= 20; b -= 15;
          }
          break;

        case ROOM_TYPES.LIBRARY:
          // Rich wood paneling with grain
          const panelSize = 128;
          const panelY = y % panelSize;
          // Horizontal wood grain
          const grainPattern = Math.sin(panelY * 0.5) * 15;
          r += grainPattern; g += grainPattern * 0.85; b += grainPattern * 0.7;
          // Panel borders
          if (panelY < 4 || panelY > panelSize - 4) {
            r -= 40; g -= 35; b -= 30;
          }
          // Wood knots and variation
          const woodVariation = smoothNoise(Math.floor(x/10), Math.floor(y/10), 7) * 30 - 15;
          r += woodVariation; g += woodVariation * 0.8; b += woodVariation * 0.6;
          // Occasional knots
          if (smoothNoise(Math.floor(x/50), Math.floor(y/50), 8) < 0.1) {
            r -= 35; g -= 30; b -= 25;
          }
          break;

        default: // CORRIDOR - Backrooms style
          // Yellowed, dirty walls
          const baseNoise = smoothNoise(Math.floor(x/10), Math.floor(y/10), 9) * 20 - 10;
          r += baseNoise; g += baseNoise; b += baseNoise;
          // Wallpaper seams
          if (x % 128 === 0 || y % 128 === 0) {
            r -= 8; g -= 8; b -= 8;
          }
          // Dirt and stains
          if (smoothNoise(Math.floor(x/30), Math.floor(y/30), 10) < 0.2) {
            r -= 30; g -= 25; b -= 20;
          }
          // Fine texture
          r += Math.random() * 10 - 5;
          g += Math.random() * 10 - 5;
          b += Math.random() * 10 - 5;
      }

      data[i] = Math.max(0, Math.min(255, r));
      data[i + 1] = Math.max(0, Math.min(255, g));
      data[i + 2] = Math.max(0, Math.min(255, b));
      data[i + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(data, size, size);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;

  return texture;
}

/**
 * Create a room-specific floor texture based on room type
 * @param {number} roomType - Room type from ROOM_TYPES
 * @returns {THREE.DataTexture} Floor texture
 */
export function createRoomFloorTexture(roomType) {
  const config = getRoomConfig(roomType);
  const size = 512; // Higher resolution
  const data = new Uint8Array(size * size * 4);

  const r_base = (config.floorColor >> 16) & 255;
  const g_base = (config.floorColor >> 8) & 255;
  const b_base = config.floorColor & 255;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;

      let r = r_base;
      let g = g_base;
      let b = b_base;

      switch (roomType) {
        case ROOM_TYPES.CLASSROOM:
          // Large linoleum tiles with subtle shine
          const linoleumSize = 128;
          const lx = x % linoleumSize;
          const ly = y % linoleumSize;
          if (lx < 3 || ly < 3) {
            r -= 18; g -= 18; b -= 18; // Seams
          } else {
            // Smooth linoleum variation
            const linoleumVar = smoothNoise(Math.floor(x/linoleumSize), Math.floor(y/linoleumSize), 11) * 15;
            r += linoleumVar; g += linoleumVar; b += linoleumVar;
            // Fine texture
            const fineNoise = smoothNoise(x, y, 12) * 8 - 4;
            r += fineNoise; g += fineNoise; b += fineNoise;
          }
          // Scuff marks
          if (smoothNoise(Math.floor(x/40), Math.floor(y/40), 13) < 0.1) {
            r -= 20; g -= 20; b -= 20;
          }
          break;

        case ROOM_TYPES.OFFICE:
          // Hardwood floor planks with grain
          const plankWidth = 24;
          const plankLength = 256;
          const px = x % plankWidth;
          const py = y % plankLength;

          // Plank borders
          if (px < 2 || py < 3) {
            r -= 30; g -= 25; b -= 18;
          } else {
            // Wood grain pattern
            const grain = Math.sin(x * 0.3) * Math.sin(py * 0.2) * 12;
            r += grain; g += grain * 0.85; b += grain * 0.65;
            // Plank variation
            const plankVar = smoothNoise(Math.floor(x/plankWidth), Math.floor(y/plankLength), 14) * 25 - 12;
            r += plankVar; g += plankVar * 0.9; b += plankVar * 0.75;
          }
          // Occasional wear marks
          if (smoothNoise(Math.floor(x/30), Math.floor(y/30), 15) < 0.08) {
            r -= 15; g -= 12; b -= 8;
          }
          break;

        case ROOM_TYPES.BATHROOM:
          // Glossy ceramic tiles
          const ceramicSize = 64;
          const cx = x % ceramicSize;
          const cy = y % ceramicSize;
          if (cx < 3 || cy < 3) {
            r -= 30; g -= 30; b -= 30; // Grout
          } else {
            // Glossy ceramic shine
            const shine = smoothNoise(Math.floor(x/ceramicSize), Math.floor(y/ceramicSize), 16) * 30;
            r += shine; g += shine; b += shine;
            // Subtle tile pattern
            if ((cx + cy) % 16 < 8) {
              r += 5; g += 5; b += 5;
            }
          }
          break;

        case ROOM_TYPES.STORAGE:
          // Rough damaged concrete
          const concreteVariation = smoothNoise(Math.floor(x/12), Math.floor(y/12), 17) * 45 - 22;
          r += concreteVariation; g += concreteVariation; b += concreteVariation;
          // Fine aggregate texture
          const aggregate = Math.random() * 25 - 12;
          r += aggregate; g += aggregate; b += aggregate;
          // Cracks and damage
          if (Math.abs(Math.sin(x * 0.04) * Math.sin(y * 0.03)) > 0.97) {
            r -= 55; g -= 55; b -= 55;
          }
          // Oil stains and dirt
          if (smoothNoise(Math.floor(x/35), Math.floor(y/35), 18) < 0.15) {
            r -= 40; g -= 35; b -= 30;
          }
          break;

        case ROOM_TYPES.LIBRARY:
          // Rich carpet with pattern
          const carpetPattern = (Math.floor(x/16) + Math.floor(y/16)) % 2;
          if (carpetPattern === 0) {
            r += 8; g += 6; b += 4;
          } else {
            r -= 8; g -= 6; b -= 4;
          }
          // Carpet pile texture
          const pileNoise = smoothNoise(x, y, 19) * 15 - 7;
          r += pileNoise; g += pileNoise * 0.85; b += pileNoise * 0.65;
          // Subtle wear patterns
          if (smoothNoise(Math.floor(x/50), Math.floor(y/50), 20) < 0.2) {
            r -= 12; g -= 10; b -= 8;
          }
          break;

        default: // CORRIDOR - Backrooms carpet
          // Worn carpet with stains
          const carpetBase = smoothNoise(Math.floor(x/15), Math.floor(y/15), 21) * 30 - 15;
          r += carpetBase; g += carpetBase; b += carpetBase;
          // Carpet fiber texture
          const fiberPattern = (x + y) % 3;
          r += fiberPattern; g += fiberPattern; b += fiberPattern;
          // Heavy stains and damage
          if (smoothNoise(Math.floor(x/25), Math.floor(y/25), 22) < 0.25) {
            r -= 35; g -= 30; b -= 25;
          }
          // Random variations
          r += Math.random() * 12 - 6;
          g += Math.random() * 12 - 6;
          b += Math.random() * 12 - 6;
      }

      data[i] = Math.max(0, Math.min(255, r));
      data[i + 1] = Math.max(0, Math.min(255, g));
      data[i + 2] = Math.max(0, Math.min(255, b));
      data[i + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(data, size, size);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;

  return texture;
}

/**
 * Create a room-specific ceiling texture based on room type
 * @param {number} roomType - Room type from ROOM_TYPES
 * @returns {THREE.DataTexture} Ceiling texture
 */
export function createRoomCeilingTexture(roomType) {
  const config = getRoomConfig(roomType);
  const size = 512; // Higher resolution
  const data = new Uint8Array(size * size * 4);

  const r_base = (config.ceilingColor >> 16) & 255;
  const g_base = (config.ceilingColor >> 8) & 255;
  const b_base = config.ceilingColor & 255;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;

      let r = r_base;
      let g = g_base;
      let b = b_base;

      switch (roomType) {
        case ROOM_TYPES.CLASSROOM:
          // Clean smooth ceiling with fluorescent light panels
          const panelSizeX = 128;
          const panelSizeY = 256;
          const panelX = x % panelSizeX;
          const panelY = y % panelSizeY;
          if (panelX < 2 || panelY < 2) {
            r -= 15; g -= 15; b -= 15; // Panel borders
          } else if (panelX > 10 && panelX < panelSizeX - 10 && panelY > 10 && panelY < panelSizeY - 10) {
            // Light panel area
            const brightness = smoothNoise(Math.floor(x/panelSizeX), Math.floor(y/panelSizeY), 23) * 15;
            r += brightness; g += brightness; b += brightness;
          }
          // Smooth texture
          const smoothVar = smoothNoise(x, y, 24) * 6 - 3;
          r += smoothVar; g += smoothVar; b += smoothVar;
          break;

        case ROOM_TYPES.OFFICE:
          // Professional acoustic tiles
          const acousticSize = 128;
          const ax = x % acousticSize;
          const ay = y % acousticSize;
          if (ax < 3 || ay < 3) {
            r -= 35; g -= 35; b -= 35; // Grid lines
          } else {
            // Acoustic holes pattern
            if ((ax % 12 < 6) && (ay % 12 < 6)) {
              r -= 8; g -= 8; b -= 8;
            }
            // Tile variation
            const tileVar = smoothNoise(Math.floor(x/acousticSize), Math.floor(y/acousticSize), 25) * 12 - 6;
            r += tileVar; g += tileVar; b += tileVar;
          }
          break;

        case ROOM_TYPES.BATHROOM:
          // Smooth painted ceiling with moisture stains
          const ceilingVar = smoothNoise(Math.floor(x/20), Math.floor(y/20), 26) * 15 - 7;
          r += ceilingVar; g += ceilingVar; b += ceilingVar;
          // Water stains (darker spots)
          if (smoothNoise(Math.floor(x/60), Math.floor(y/60), 27) < 0.15) {
            r -= 35; g -= 30; b -= 25;
          }
          // Smooth surface
          const smooth = smoothNoise(x, y, 28) * 8 - 4;
          r += smooth; g += smooth; b += smooth;
          break;

        case ROOM_TYPES.STORAGE:
          // Bare concrete or metal ceiling
          const roughCeiling = smoothNoise(Math.floor(x/10), Math.floor(y/10), 29) * 35 - 17;
          r += roughCeiling; g += roughCeiling; b += roughCeiling;
          // Exposed pipes/beams pattern
          if (y % 256 < 16) {
            r -= 40; g -= 40; b -= 40;
          }
          // Rust stains
          if (smoothNoise(Math.floor(x/40), Math.floor(y/40), 30) < 0.2) {
            r -= 20; g -= 30; b -= 35;
          }
          // Rough texture
          r += Math.random() * 20 - 10;
          g += Math.random() * 20 - 10;
          b += Math.random() * 20 - 10;
          break;

        case ROOM_TYPES.LIBRARY:
          // Wood beams and panels
          const beamSpacing = 192;
          if (y % beamSpacing < 24) {
            // Dark wood beam
            r -= 60; g -= 50; b -= 40;
          } else {
            // Light wood panels
            const woodGrain = Math.sin(y * 0.1) * 10;
            r += woodGrain; g += woodGrain * 0.85; b += woodGrain * 0.7;
            const panelVar = smoothNoise(Math.floor(x/30), Math.floor(y/beamSpacing), 31) * 20 - 10;
            r += panelVar; g += panelVar * 0.9; b += panelVar * 0.75;
          }
          break;

        default: // CORRIDOR - Backrooms acoustic tiles
          const tileSize = 128;
          const gx = x % tileSize;
          const gy = y % tileSize;

          if (gx < 3 || gy < 3) {
            r -= 45; g -= 45; b -= 45; // Dark grid
          } else {
            // Acoustic texture (small holes)
            if ((gx % 10 < 5) && (gy % 10 < 5)) {
              r -= 12; g -= 12; b -= 12;
            }
            // Yellowing and water damage
            const damage = smoothNoise(Math.floor(x/tileSize), Math.floor(y/tileSize), 32);
            if (damage < 0.3) {
              r -= 25; g -= 30; b -= 35; // Water stains
            } else if (damage > 0.7) {
              r += 10; g += 5; b -= 5; // Yellowing
            }
          }
          // Random variation
          r += Math.random() * 8 - 4;
          g += Math.random() * 8 - 4;
          b += Math.random() * 8 - 4;
      }

      data[i] = Math.max(0, Math.min(255, r));
      data[i + 1] = Math.max(0, Math.min(255, g));
      data[i + 2] = Math.max(0, Math.min(255, b));
      data[i + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(data, size, size);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;

  return texture;
}
