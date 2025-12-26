/**
 * PBR Texture Loader for external texture files
 * Supports loading albedo/diffuse, normal, roughness, and AO maps
 */

import * as THREE from 'three';
import { ROOM_TYPES } from '../world/tileTypes.js';

export class PBRTextureLoader {
  /**
   * Create the PBR texture loader
   * @param {string} basePath - Base path for texture files
   */
  constructor(basePath = '/textures') {
    this.loader = new THREE.TextureLoader();
    this.basePath = basePath;
    this.cache = new Map();
    this.maxAnisotropy = 1;

    // Define texture sets for each room type
    this.textureMapping = this.initTextureMapping();
  }

  /**
   * Set max anisotropy (call after renderer is created)
   * @param {number} maxAnisotropy
   */
  setMaxAnisotropy(maxAnisotropy) {
    this.maxAnisotropy = maxAnisotropy;
  }

  /**
   * Initialize texture mapping for room types
   * Maps room types to texture folder names
   */
  initTextureMapping() {
    // Mapped to actual texture directories (Poly Haven 4K PBR)
    return {
      [ROOM_TYPES.CORRIDOR]: {
        wall: 'corridor_wall',      // yellow_plaster
        floor: 'corridor_floor',    // beige_wall_002
        ceiling: 'corridor_ceiling' // plastered_wall_02
      },
      [ROOM_TYPES.CLASSROOM]: {
        wall: 'classroom_wall',     // beige_wall_002
        floor: 'classroom_floor',   // interior_tiles
        ceiling: 'classroom_ceiling' // plastered_wall_02
      },
      [ROOM_TYPES.OFFICE]: {
        wall: 'office_wall',        // beige_wall_002
        floor: 'office_carpet',     // diagonal_parquet
        ceiling: 'office_ceiling'   // plastered_wall_02
      },
      [ROOM_TYPES.BATHROOM]: {
        wall: 'bathroom_tile',      // interior_tiles
        floor: 'bathroom_floor',    // interior_tiles
        ceiling: 'bathroom_ceiling' // plastered_wall_02
      },
      [ROOM_TYPES.STORAGE]: {
        wall: 'storage_wall',       // concrete_wall_006
        floor: 'storage_floor',     // damaged_concrete_floor_03
        ceiling: 'storage_ceiling'  // patterned_concrete_wall
      },
      [ROOM_TYPES.LIBRARY]: {
        wall: 'library_wall',       // wood_cabinet_worn_long
        floor: 'library_floor',     // wood_floor
        ceiling: 'library_ceiling'  // plastered_wall_02
      },
      [ROOM_TYPES.POOL]: {
        wall: 'pool_wall',          // blue_plaster_weathered
        floor: 'pool_floor',        // interior_tiles
        ceiling: 'pool_ceiling'     // plastered_wall_02
      },
      [ROOM_TYPES.GYM]: {
        wall: 'gym_wall',           // blue_metal_plate
        floor: 'gym_floor',         // damaged_concrete_floor_03
        ceiling: 'gym_ceiling'      // concrete_wall_006
      },
      [ROOM_TYPES.BEDROOM]: {
        wall: 'bedroom_wall',       // beige_wall_002
        floor: 'bedroom_floor',     // wood_floor
        ceiling: 'bedroom_ceiling'  // plastered_wall_02
      }
    };
  }

  /**
   * Get texture folder name for a room type and surface
   * @param {number} roomType
   * @param {string} surface - 'wall' | 'floor' | 'ceiling'
   * @returns {string} Texture folder name
   */
  getTextureName(roomType, surface) {
    const mapping = this.textureMapping[roomType] || this.textureMapping[ROOM_TYPES.CORRIDOR];
    return mapping[surface] || `default_${surface}`;
  }

  /**
   * Load a single texture
   * @param {string} path - Full path to texture file
   * @returns {Promise<THREE.Texture|null>}
   */
  async loadTexture(path) {
    return new Promise((resolve) => {
      this.loader.load(
        path,
        (texture) => {
          // Configure texture
          texture.wrapS = THREE.RepeatWrapping;
          texture.wrapT = THREE.RepeatWrapping;
          texture.anisotropy = this.maxAnisotropy;

          // Color space for diffuse maps
          if (path.includes('diffuse') || path.includes('albedo') || path.includes('color')) {
            texture.colorSpace = THREE.SRGBColorSpace;
          }

          resolve(texture);
        },
        undefined,
        () => {
          // Silently fail - will use procedural fallback
          resolve(null);
        }
      );
    });
  }

  /**
   * Load a complete PBR texture set
   * @param {string} materialName - Name of the material folder
   * @returns {Promise<Object>} Object with diffuse, normal, roughness, ao textures
   */
  async loadTextureSet(materialName) {
    const cacheKey = materialName;

    // Check cache first
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    const basePath = `${this.basePath}/${materialName}`;

    // Try different naming conventions
    const textureTypes = {
      diffuse: ['diffuse.jpg', 'diffuse.png', 'albedo.jpg', 'albedo.png', 'color.jpg', 'color.png'],
      normal: ['normal.jpg', 'normal.png', 'normal_gl.jpg', 'normal_gl.png'],
      roughness: ['roughness.jpg', 'roughness.png', 'rough.jpg', 'rough.png'],
      ao: ['ao.jpg', 'ao.png', 'ambient_occlusion.jpg', 'ambient_occlusion.png']
    };

    const result = {
      diffuse: null,
      normal: null,
      roughness: null,
      ao: null
    };

    // Try to load each texture type
    for (const [type, filenames] of Object.entries(textureTypes)) {
      for (const filename of filenames) {
        const texture = await this.loadTexture(`${basePath}/${filename}`);
        if (texture) {
          result[type] = texture;
          break;
        }
      }
    }

    // Cache the result
    this.cache.set(cacheKey, result);

    return result;
  }

  /**
   * Load textures for a room type and surface
   * @param {number} roomType
   * @param {string} surface - 'wall' | 'floor' | 'ceiling'
   * @returns {Promise<Object>} PBR texture set
   */
  async loadRoomTextures(roomType, surface) {
    const textureName = this.getTextureName(roomType, surface);
    return await this.loadTextureSet(textureName);
  }

  /**
   * Preload textures for all room types
   * @returns {Promise<void>}
   */
  async preloadAll() {
    const promises = [];

    for (const roomType of Object.values(ROOM_TYPES)) {
      if (typeof roomType !== 'number') continue;

      for (const surface of ['wall', 'floor', 'ceiling']) {
        promises.push(this.loadRoomTextures(roomType, surface));
      }
    }

    await Promise.all(promises);
    console.log(`✨ Preloaded ${this.cache.size} PBR texture sets`);
  }

  /**
   * Check if a texture set exists (has at least diffuse)
   * @param {string} materialName
   * @returns {boolean}
   */
  hasTextureSet(materialName) {
    const cached = this.cache.get(materialName);
    return cached && cached.diffuse !== null;
  }

  /**
   * Clear the texture cache
   */
  clearCache() {
    this.cache.forEach((textureSet) => {
      Object.values(textureSet).forEach((texture) => {
        if (texture) texture.dispose();
      });
    });
    this.cache.clear();
  }

  /**
   * Get texture repeat values based on surface type and world scale
   * @param {string} surface - 'wall' | 'floor' | 'ceiling'
   * @param {number} tileSize - Size of one tile in world units
   * @returns {{ x: number, y: number }}
   */
  getTextureRepeat(surface, tileSize = 2.0) {
    // Assuming textures are 1m x 1m in real-world scale
    // Adjust repeat to match world units
    const repeats = {
      wall: { x: tileSize / 2, y: 1.5 },    // Wall height is 3m
      floor: { x: tileSize, y: tileSize },
      ceiling: { x: tileSize, y: tileSize }
    };

    return repeats[surface] || { x: 1, y: 1 };
  }
}
