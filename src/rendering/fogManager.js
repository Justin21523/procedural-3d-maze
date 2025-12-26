/**
 * Fog Manager for dynamic room-based fog effects
 * Smoothly transitions fog color and density based on player's current room
 */

import * as THREE from 'three';
import { ROOM_TYPES } from '../world/tileTypes.js';

export class FogManager {
  /**
   * Create the fog manager
   * @param {THREE.Scene} scene - The Three.js scene
   */
  constructor(scene) {
    this.scene = scene;
    this.presets = new Map();
    this.currentFog = null;
    this.targetFog = null;
    this.transitionSpeed = 2.0; // How fast fog transitions (higher = faster)

    this.initPresets();
    this.saveCurrentFog();
  }

  /**
   * Initialize fog presets for each room type
   * Reduced density overall to prevent dark distant walls
   */
  initPresets() {
    // Corridor: Classic Backrooms yellow fog
    this.presets.set(ROOM_TYPES.CORRIDOR, {
      density: 0.05,
      color: new THREE.Color(0xd4cba6)
    });

    // Classroom: Bright, clean atmosphere
    this.presets.set(ROOM_TYPES.CLASSROOM, {
      density: 0.04,
      color: new THREE.Color(0xf0f0f0)
    });

    // Office: Warm, slightly hazy
    this.presets.set(ROOM_TYPES.OFFICE, {
      density: 0.045,
      color: new THREE.Color(0xe8d8c0)
    });

    // Bathroom: Humid, cold blue-white fog
    this.presets.set(ROOM_TYPES.BATHROOM, {
      density: 0.06,
      color: new THREE.Color(0xe0f0ff)
    });

    // Storage: Industrial, less oppressive
    this.presets.set(ROOM_TYPES.STORAGE, {
      density: 0.06,
      color: new THREE.Color(0x808070)  // Lighter gray-green
    });

    // Library: Warm, dusty atmosphere
    this.presets.set(ROOM_TYPES.LIBRARY, {
      density: 0.04,
      color: new THREE.Color(0xc8b090)
    });

    // Pool: Light blue, humid mist
    this.presets.set(ROOM_TYPES.POOL, {
      density: 0.045,
      color: new THREE.Color(0xb8e9ff)
    });

    // Gym: Industrial but visible
    this.presets.set(ROOM_TYPES.GYM, {
      density: 0.055,
      color: new THREE.Color(0x606060)  // Lighter gray
    });

    // Bedroom: Soft, cozy atmosphere
    this.presets.set(ROOM_TYPES.BEDROOM, {
      density: 0.04,
      color: new THREE.Color(0xe8dcc8)
    });

    // Classroom block: very bright, clean air
    this.presets.set(ROOM_TYPES.CLASSROOMS_BLOCK, {
      density: 0.035,
      color: new THREE.Color(0xf5f7ff)
    });

    // Lab: slightly colder
    this.presets.set(ROOM_TYPES.LAB, {
      density: 0.045,
      color: new THREE.Color(0xe6fbff)
    });

    // Cafeteria: warm haze
    this.presets.set(ROOM_TYPES.CAFETERIA, {
      density: 0.045,
      color: new THREE.Color(0xfff0dd)
    });
  }

  /**
   * Save current fog state
   */
  saveCurrentFog() {
    if (this.scene.fog) {
      this.currentFog = {
        density: this.scene.fog.density,
        color: this.scene.fog.color.clone()
      };
      this.targetFog = { ...this.currentFog, color: this.currentFog.color.clone() };
    }
  }

  /**
   * Set target fog based on room type
   * @param {number} roomType - The room type constant
   */
  setRoomType(roomType) {
    const preset = this.presets.get(roomType);
    if (!preset) {
      // Default to corridor fog
      this.targetFog = this.presets.get(ROOM_TYPES.CORRIDOR);
    } else {
      this.targetFog = preset;
    }
  }

  /**
   * Update fog (call every frame for smooth transitions)
   * @param {number} deltaTime - Time since last frame in seconds
   */
  update(deltaTime) {
    if (!this.scene.fog || !this.targetFog || !this.currentFog) return;

    const t = Math.min(1, deltaTime * this.transitionSpeed);

    // Interpolate density
    this.currentFog.density += (this.targetFog.density - this.currentFog.density) * t;
    this.scene.fog.density = this.currentFog.density;

    // Interpolate color
    this.currentFog.color.lerp(this.targetFog.color, t);
    this.scene.fog.color.copy(this.currentFog.color);

    // Also update scene background to match fog color
    if (this.scene.background instanceof THREE.Color) {
      this.scene.background.lerp(this.targetFog.color, t);
    }
  }

  /**
   * Force immediate fog change (no transition)
   * @param {number} roomType - The room type constant
   */
  setImmediate(roomType) {
    const preset = this.presets.get(roomType) || this.presets.get(ROOM_TYPES.CORRIDOR);

    if (this.scene.fog) {
      this.scene.fog.density = preset.density;
      this.scene.fog.color.copy(preset.color);
    }

    if (this.scene.background instanceof THREE.Color) {
      this.scene.background.copy(preset.color);
    }

    this.currentFog = {
      density: preset.density,
      color: preset.color.clone()
    };
    this.targetFog = { ...this.currentFog, color: this.currentFog.color.clone() };
  }

  /**
   * Get fog preset for a room type
   * @param {number} roomType - The room type constant
   * @returns {Object} Fog preset { density, color }
   */
  getPreset(roomType) {
    return this.presets.get(roomType) || this.presets.get(ROOM_TYPES.CORRIDOR);
  }

  /**
   * Set transition speed
   * @param {number} speed - Transition speed (higher = faster)
   */
  setTransitionSpeed(speed) {
    this.transitionSpeed = Math.max(0.1, speed);
  }
}
