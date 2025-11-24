/**
 * Scene manager for Three.js
 * Handles scene creation, world mesh generation, and rendering
 */

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CONFIG } from '../core/config.js';
import { TILE_TYPES, ROOM_TYPES } from '../world/tileTypes.js';
import { gridToWorld } from '../utils/math.js';
import { setupLighting } from './lighting.js';
import {
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

    // ---------- Scene ----------
    this.scene = new THREE.Scene();
    const backroomsColor = 0xd4cba6;
    this.scene.background = new THREE.Color(backroomsColor);

    // Exponential fog for backrooms feel
    this.scene.fog = new THREE.FogExp2(backroomsColor, 0.08);
    console.log('✨ Added exponential fog to scene');

    // ---------- Renderer ----------
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance'
    });

    const width = container.clientWidth;
    const height = container.clientHeight;

    // 限制 pixel ratio，避免 4K 螢幕直接把 GPU 烤爆
    // 極限降載：強制 pixel ratio = 1
    const pixelRatio = 1.0;
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height);

    // PBR / 色彩 / tone mapping 設定
    this.renderer.physicallyCorrectLights = true;

    if ('outputEncoding' in this.renderer) {
      // three r150 以前
      this.renderer.outputEncoding = THREE.sRGBEncoding;
    } else if ('outputColorSpace' in this.renderer) {
      // three r152 之後
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    }

    if ('toneMapping' in this.renderer && THREE.ACESFilmicToneMapping !== undefined) {
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.0;
    }

    // 陰影：關閉可大幅降低 GPU/CPU 開銷
    this.renderer.shadowMap.enabled = false;

    container.appendChild(this.renderer.domElement);

    // 儲存可用的 anisotropy（給貼圖使用）
    this.maxAnisotropy = this.renderer.capabilities.getMaxAnisotropy
      ? this.renderer.capabilities.getMaxAnisotropy()
      : 1;

    // ---------- Environment Map（假「光追」反射） ----------
    this.environmentMap = null;
    this._setupEnvironmentMap();

    // ---------- Lighting ----------
    this.lights = setupLighting(this.scene);

    // ---------- World / Camera ----------
    this.worldMeshes = [];
    this.camera = null;

    // 方便存牆體做 raycast
    this.wallMeshes = [];

    // Resize handler
    window.addEventListener('resize', () => this.onWindowResize());
  }

  /**
   * Create a simple room-style environment map for reflections
   */
  _setupEnvironmentMap() {
    if (!this.renderer) return;

    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    pmremGenerator.compileEquirectangularShader?.();

    // 用 three 官方的 RoomEnvironment 當假光源環境
    const envScene = new RoomEnvironment();
    const envRT = pmremGenerator.fromScene(envScene);
    this.environmentMap = envRT.texture;

    // 讓 PBR 材質自動使用這個環境
    this.scene.environment = this.environmentMap;

    pmremGenerator.dispose();
  }
  
  /**
   * PBR material parameters per room type
   * 控制 roughness/metalness 來決定反光程度
   */
  getMaterialPropsForRoom(roomType) {
    // corridor 基本值
    const base = {
      wall:  { roughness: 0.9,  metalness: 0.05, envMapIntensity: 0.25 },
      floor: { roughness: 0.85, metalness: 0.08, envMapIntensity: 0.4 },
      ceiling: { roughness: 0.95, metalness: 0.0, envMapIntensity: 0.2 }
    };

    switch (roomType) {
      case ROOM_TYPES.CLASSROOM:
        base.floor.roughness = 0.45;
        base.floor.metalness = 0.18;
        base.floor.envMapIntensity = 0.7; // 磨得亮亮的教室地板
        break;

      case ROOM_TYPES.OFFICE:
        base.floor.roughness = 0.5;
        base.floor.metalness = 0.25;      // 木地板有點反光
        base.floor.envMapIntensity = 0.8;
        base.wall.roughness = 0.85;
        break;

      case ROOM_TYPES.BATHROOM:
        // 洗手間：牆 + 地都很亮
        base.wall.roughness = 0.35;
        base.wall.metalness = 0.2;
        base.wall.envMapIntensity = 0.9;

        base.floor.roughness = 0.15;
        base.floor.metalness = 0.4;
        base.floor.envMapIntensity = 1.3; // 超級亮的磁磚地
        base.ceiling.roughness = 0.6;
        base.ceiling.envMapIntensity = 0.9;
        break;

      case ROOM_TYPES.STORAGE:
        // 倉庫：幾乎全是粗糙混凝土
        base.wall.roughness = 1.0;
        base.wall.metalness = 0.0;
        base.wall.envMapIntensity = 0.1;

        base.floor.roughness = 1.0;
        base.floor.metalness = 0.0;
        base.floor.envMapIntensity = 0.1;
        break;

      case ROOM_TYPES.LIBRARY:
        // 木牆 + 木地板，有一點油亮
        base.wall.roughness = 0.8;
        base.wall.metalness = 0.15;
        base.wall.envMapIntensity = 0.6;

        base.floor.roughness = 0.55;
        base.floor.metalness = 0.25;
        base.floor.envMapIntensity = 0.9;
        break;

      default:
        // corridor 使用 base
        break;
    }

    return base;
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
    const roomMaterials = {};

    // Create materials for all room types
    Object.values(ROOM_TYPES).forEach(roomType => {
      if (typeof roomType !== 'number') return;

      const wallTexture = createRoomWallTexture(roomType);
      const floorTexture = createRoomFloorTexture(roomType);
      const ceilingTexture = createRoomCeilingTexture(roomType);

      // 重複與各向異性設定
      wallTexture.repeat.set(2, 2);
      floorTexture.repeat.set(4, 4);
      ceilingTexture.repeat.set(3, 3);

      const textures = [wallTexture, floorTexture, ceilingTexture];
      const maxAniso = this.maxAnisotropy || 1;

      textures.forEach(tex => {
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.anisotropy = maxAniso;

        if ('encoding' in tex) {
          tex.encoding = THREE.sRGBEncoding;
        } else if ('colorSpace' in tex) {
          tex.colorSpace = THREE.SRGBColorSpace;
        }
      });

      const pbr = this.getMaterialPropsForRoom(roomType);

      roomMaterials[roomType] = {
        wall: new THREE.MeshStandardMaterial({
          map: wallTexture,
          roughness: pbr.wall.roughness,
          metalness: pbr.wall.metalness,
          envMap: this.environmentMap,
          envMapIntensity: pbr.wall.envMapIntensity
        }),
        floor: new THREE.MeshStandardMaterial({
          map: floorTexture,
          roughness: pbr.floor.roughness,
          metalness: pbr.floor.metalness,
          envMap: this.environmentMap,
          envMapIntensity: pbr.floor.envMapIntensity
        }),
        ceiling: new THREE.MeshStandardMaterial({
          map: ceilingTexture,
          roughness: pbr.ceiling.roughness,
          metalness: pbr.ceiling.metalness,
          envMap: this.environmentMap,
          envMapIntensity: pbr.ceiling.envMapIntensity
        })
      };
    });

    console.log(`✨ Created PBR materials for ${Object.keys(roomMaterials).length} room types`);
    
    this.wallMeshes = [];
    
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
          this.wallMeshes.push(wall);
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
    return this.wallMeshes || [];
  }

  /**
   * Cleanup resources
   */
  dispose() {
    this.clearWorld();
    this.renderer.dispose();
  }
}
