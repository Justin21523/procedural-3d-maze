/**
 * Scene manager for Three.js
 * Handles scene creation, world mesh generation, and rendering
 */

import * as THREE from 'three';
import { CONFIG } from '../core/config.js';
import { TILE_TYPES, ROOM_TYPES } from '../world/tileTypes.js';
import { gridToWorld } from '../utils/math.js';
import { setupLighting } from './lighting.js';
import {
  createWallTexture,
  createFloorTexture,
  createCeilingTexture,
  createRoomWallTexture,
  createRoomFloorTexture,
  createRoomCeilingTexture
} from './textures.js';
import { generateRoomProps } from './props.js';

export class SceneManager {
  /**
   * Create the scene manager
   * @param {HTMLElement} container - DOM container for the canvas
   */
  constructor(container) {
    this.container = container;

    // Create scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xd4cba6); // Backrooms beige

    // Add fog for Backrooms atmosphere
    // Exponential fog creates a more eerie effect than linear fog
    const fogColor = 0xd4cba6; // Match background color
    this.scene.fog = new THREE.FogExp2(fogColor, 0.08); // Density: 0.08
    console.log('✨ Added exponential fog to scene');

    // Create renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(this.renderer.domElement);

    // Setup lighting
    this.lights = setupLighting(this.scene);

    // Store references to world meshes
    this.worldMeshes = [];

    // Camera will be set from outside
    this.camera = null;

    // Handle window resize
    window.addEventListener('resize', () => this.onWindowResize());
  }

  /**
   * Set the camera for rendering
   * @param {FirstPersonCamera} cameraController - The camera controller
   */
  setCamera(cameraController) {
    this.camera = cameraController.getCamera();
  }

  /**
   * Build the 3D world from a 2D grid
   * @param {WorldState} worldState - World state containing grid and room map
   */
  buildWorldFromGrid(worldState) {
    // Clear existing world meshes
    this.clearWorld();

    const grid = worldState.getGrid();
    const roomMap = worldState.getRoomMap();
    const height = grid.length;
    const width = grid[0].length;

    // Create textures for each room type
    const roomTextures = {};
    const roomMaterials = {};

    // Create materials for all room types
    Object.values(ROOM_TYPES).forEach(roomType => {
      if (typeof roomType === 'number') {
        const wallTexture = createRoomWallTexture(roomType);
        const floorTexture = createRoomFloorTexture(roomType);
        const ceilingTexture = createRoomCeilingTexture(roomType);

        wallTexture.repeat.set(2, 2);
        floorTexture.repeat.set(4, 4);
        ceilingTexture.repeat.set(3, 3);

        roomMaterials[roomType] = {
          wall: new THREE.MeshStandardMaterial({
            map: wallTexture,
            roughness: 0.9,
            metalness: 0.05,
          }),
          floor: new THREE.MeshStandardMaterial({
            map: floorTexture,
            roughness: 0.95,
            metalness: 0,
          }),
          ceiling: new THREE.MeshStandardMaterial({
            map: ceilingTexture,
            roughness: 0.85,
            metalness: 0,
          }),
        };
      }
    });

    console.log(`✨ Created materials for ${Object.keys(roomMaterials).length} room types`);

    // Geometry for walls (reuse for efficiency)
    const wallGeometry = new THREE.BoxGeometry(
      CONFIG.TILE_SIZE,
      CONFIG.WALL_HEIGHT,
      CONFIG.TILE_SIZE
    );

    // Geometries for floor and ceiling tiles
    const floorGeometry = new THREE.PlaneGeometry(CONFIG.TILE_SIZE, CONFIG.TILE_SIZE);
    const ceilingGeometry = new THREE.PlaneGeometry(CONFIG.TILE_SIZE, CONFIG.TILE_SIZE);

    // Build walls, floors, and ceilings
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const worldPos = gridToWorld(x, y, CONFIG.TILE_SIZE);
        const roomType = roomMap[y][x];
        const materials = roomMaterials[roomType] || roomMaterials[ROOM_TYPES.CORRIDOR];

        if (grid[y][x] === TILE_TYPES.WALL) {
          // Create wall
          const wall = new THREE.Mesh(wallGeometry, materials.wall);
          wall.position.set(
            worldPos.x,
            CONFIG.WALL_HEIGHT / 2,
            worldPos.z
          );
          wall.castShadow = true;
          wall.receiveShadow = true;
          this.scene.add(wall);
          this.worldMeshes.push(wall);
        } else if (grid[y][x] === TILE_TYPES.FLOOR) {
          // Create floor tile
          const floor = new THREE.Mesh(floorGeometry, materials.floor);
          floor.rotation.x = -Math.PI / 2; // Rotate to be horizontal
          floor.position.set(worldPos.x, 0, worldPos.z);
          floor.receiveShadow = true;
          this.scene.add(floor);
          this.worldMeshes.push(floor);

          // Create ceiling tile
          const ceiling = new THREE.Mesh(ceilingGeometry, materials.ceiling);
          ceiling.rotation.x = Math.PI / 2; // Rotate to face down
          ceiling.position.set(worldPos.x, CONFIG.WALL_HEIGHT, worldPos.z);
          this.scene.add(ceiling);
          this.worldMeshes.push(ceiling);

          // Generate room props (furniture, decorations)
          const props = generateRoomProps(roomType, x, y, grid);
          props.forEach(prop => {
            this.scene.add(prop);
            this.worldMeshes.push(prop);
          });
        }
      }
    }

    console.log(`Built world: ${this.worldMeshes.length} meshes created (including props)`);
  }

  /**
   * Clear all world meshes from the scene
   */
  clearWorld() {
    this.worldMeshes.forEach(mesh => {
      this.scene.remove(mesh);
      mesh.geometry?.dispose();
      mesh.material?.dispose();
    });
    this.worldMeshes = [];
  }

  /**
   * Render the scene
   */
  render() {
    if (this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  /**
   * Handle window resize
   */
  onWindowResize() {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;

    if (this.camera) {
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    }

    this.renderer.setSize(width, height);
  }

  /**
   * Get the Three.js scene
   * @returns {THREE.Scene} The scene
   */
  getScene() {
    return this.scene;
  }

  /**
   * Get the lights object
   * @returns {Object} Lights object with flickering data
   */
  getLights() {
    return this.lights;
  }

  /**
   * Get all wall meshes (useful for raycasting)
   * @returns {Array<THREE.Mesh>} Array of wall meshes
   */
  getWallMeshes() {
    // Filter meshes that are at wall height (walls vs floors/ceilings)
    return this.worldMeshes.filter(mesh =>
      mesh.position.y > 0.5 && mesh.position.y < CONFIG.WALL_HEIGHT - 0.5
    );
  }

  /**
   * Cleanup resources
   */
  dispose() {
    this.clearWorld();
    this.renderer.dispose();
  }
}
