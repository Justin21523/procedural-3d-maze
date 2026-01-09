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
  createRoomCeilingTexture,
  createNormalMap
} from './textures.js';
import { createRoomPropsFromPlan } from './props.js';
import { createObstacleOverlayMesh } from './obstacleOverlay.js';

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

    // ---------- Model loader (environment props) ----------
    this.modelManager = new THREE.LoadingManager();
    this.modelManager.setURLModifier((url) => {
      if (typeof url !== 'string') return url;
      if (url.startsWith('data:') || url.startsWith('blob:')) return url;
      return encodeURI(url);
    });
    this.gltfLoader = null;
    this.gltfLoaderPromise = null;
    this.modelCache = new Map(); // url -> THREE.Object3D prototype
    this.modelPromises = new Map();
    this.worldBuildToken = 0;

    // ---------- Environment Map（假「光追」反射） ----------
    this.environmentMap = null;
    this._setupEnvironmentMap();

    // ---------- Lighting ----------
    this.lights = setupLighting(this.scene);

    // ---------- World / Camera ----------
    this.worldMeshes = [];
    this.tickables = [];
    this.camera = null;

    // 方便存牆體做 raycast
    this.wallMeshes = [];
    this.obstacleOverlay = null;

    // Resize handler
    window.addEventListener('resize', () => this.onWindowResize());
  }

  addWorldObject(obj) {
    if (!obj) return;
    this.scene.add(obj);
    this.worldMeshes.push(obj);
    if (obj?.userData?.tick) {
      this.tickables.push(obj);
    }
  }

  /**
   * Create a simple room-style environment map for reflections
   */
  _setupEnvironmentMap() {
    if (!this.renderer) return;

    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    pmremGenerator.compileEquirectangularShader?.();

    const applyEnv = (texture) => {
      this.environmentMap = texture;
      this.scene.environment = this.environmentMap;
    };

    const useFallback = () => {
      const envScene = new RoomEnvironment();
      const envRT = pmremGenerator.fromScene(envScene);
      applyEnv(envRT.texture);
      pmremGenerator.dispose();
    };

    const hdrPath = CONFIG.ENVIRONMENT_HDR_ENABLED ? CONFIG.ENVIRONMENT_HDR_PATH : null;
    if (hdrPath) {
      import('three/examples/jsm/loaders/RGBELoader.js')
        .then(({ RGBELoader }) => {
          const loader = new RGBELoader(this.modelManager);
          loader.load(
            hdrPath,
            (hdr) => {
              const envRT = pmremGenerator.fromEquirectangular(hdr);
              hdr.dispose?.();
              applyEnv(envRT.texture);
              pmremGenerator.dispose();
            },
            undefined,
            () => useFallback()
          );
        })
        .catch(() => useFallback());
      return;
    }

    useFallback();
  }

  async getGltfLoader() {
    if (this.gltfLoader) return this.gltfLoader;
    if (this.gltfLoaderPromise) return this.gltfLoaderPromise;

    this.gltfLoaderPromise = import('three/examples/jsm/loaders/GLTFLoader.js')
      .then(({ GLTFLoader }) => {
        this.gltfLoader = new GLTFLoader(this.modelManager);
        return this.gltfLoader;
      })
      .finally(() => {
        this.gltfLoaderPromise = null;
      });

    return this.gltfLoaderPromise;
  }
  
  /**
   * PBR material parameters per room type
   * 控制 roughness/metalness 來決定反光程度
   */
  getMaterialPropsForRoom(roomType) {
    // corridor 基本值
    const base = {
      wall:  { roughness: 0.5, metalness: 0.18, envMapIntensity: 1.0 },
      floor: { roughness: 0.35, metalness: 0.2, envMapIntensity: 1.4 },
      ceiling: { roughness: 0.6, metalness: 0.08, envMapIntensity: 0.9 }
    };

    switch (roomType) {
      case ROOM_TYPES.CLASSROOM:
        base.floor.roughness = 0.35;
        base.floor.metalness = 0.22;
        base.floor.envMapIntensity = 1.1; // 光滑亮面地板
        base.wall.roughness = 0.55;
        break;

      case ROOM_TYPES.OFFICE:
        base.floor.roughness = 0.5;
        base.floor.metalness = 0.25;
        base.floor.envMapIntensity = 1.0;
        base.wall.roughness = 0.6;
        break;

      case ROOM_TYPES.BATHROOM:
        // 洗手間：牆 + 地都很亮
        base.wall.roughness = 0.28;
        base.wall.metalness = 0.2;
        base.wall.envMapIntensity = 1.2;

        base.floor.roughness = 0.1;
        base.floor.metalness = 0.5;
        base.floor.envMapIntensity = 1.6; // 超級亮的磁磚地
        base.ceiling.roughness = 0.45;
        base.ceiling.envMapIntensity = 1.0;
        break;

      case ROOM_TYPES.STORAGE:
        // 倉庫：幾乎全是粗糙混凝土
        base.wall.roughness = 0.95;
        base.wall.metalness = 0.02;
        base.wall.envMapIntensity = 0.2;

        base.floor.roughness = 0.9;
        base.floor.metalness = 0.05;
        base.floor.envMapIntensity = 0.25;
        break;

      case ROOM_TYPES.LIBRARY:
        // 木牆 + 木地板，有一點油亮
        base.wall.roughness = 0.55;
        base.wall.metalness = 0.2;
        base.wall.envMapIntensity = 1.0;

        base.floor.roughness = 0.4;
        base.floor.metalness = 0.35;
        base.floor.envMapIntensity = 1.2;
        break;

      case ROOM_TYPES.POOL:
        base.wall.roughness = 0.35;
        base.wall.metalness = 0.2;
        base.wall.envMapIntensity = 1.2;
        base.floor.roughness = 0.25;
        base.floor.metalness = 0.4;
        base.floor.envMapIntensity = 1.4;
        base.ceiling.roughness = 0.5;
        base.ceiling.envMapIntensity = 1.0;
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
    this.worldBuildToken += 1;
    const buildToken = this.worldBuildToken;

    const grid = worldState.getGrid();
    const roomMap = worldState.getRoomMap();
    const height = grid.length;
    const width = grid[0].length;
    const tileSize = CONFIG.TILE_SIZE || 1;

    // Create textures for each room type
    const roomMaterials = {};
    const sharedNormal = createNormalMap(6);

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
        wall: new THREE.MeshPhysicalMaterial({
          map: wallTexture,
          normalMap: sharedNormal,
          roughness: pbr.wall.roughness,
          metalness: pbr.wall.metalness,
          clearcoat: 0.25,
          clearcoatRoughness: 0.18,
          envMap: this.environmentMap,
          envMapIntensity: pbr.wall.envMapIntensity
        }),
        floor: new THREE.MeshPhysicalMaterial({
          map: floorTexture,
          normalMap: sharedNormal,
          roughness: pbr.floor.roughness,
          metalness: pbr.floor.metalness,
          clearcoat: 0.35,
          clearcoatRoughness: 0.12,
          envMap: this.environmentMap,
          envMapIntensity: pbr.floor.envMapIntensity
        }),
        ceiling: new THREE.MeshPhysicalMaterial({
          map: ceilingTexture,
          normalMap: sharedNormal,
          roughness: pbr.ceiling.roughness,
          metalness: pbr.ceiling.metalness,
          clearcoat: 0.2,
          clearcoatRoughness: 0.2,
          envMap: this.environmentMap,
          envMapIntensity: pbr.ceiling.envMapIntensity
        })
      };
    });

    console.log(`✨ Created PBR materials for ${Object.keys(roomMaterials).length} room types`);
    
    this.wallMeshes = [];
    
    // Geometry for walls (reuse for efficiency)
    const wallGeometry = new THREE.BoxGeometry(
      tileSize,
      CONFIG.WALL_HEIGHT,
      tileSize
    );

    // Geometries for floor and ceiling tiles
    const floorGeometry = new THREE.PlaneGeometry(tileSize, tileSize);
    const ceilingGeometry = new THREE.PlaneGeometry(tileSize, tileSize);

    // Instanced tiles: drastically reduce draw calls (walls + floor + ceiling).
    // NOTE: Instanced meshes are still compatible with resource disposal in clearWorld().
    const wallInstances = new Map();   // roomType -> [cx0, cz0, cx1, cz1, ...]
    const floorInstances = new Map();  // roomType -> [...]
    const ceilingInstances = new Map();// roomType -> [...]

    const pushInstance = (map, roomType, cx, cz) => {
      const rt = Number.isFinite(roomType) ? roomType : ROOM_TYPES.CORRIDOR;
      let list = map.get(rt);
      if (!list) {
        list = [];
        map.set(rt, list);
      }
      list.push(cx, cz);
    };

    // Build instance lists and spawn per-tile props.
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const worldPos = gridToWorld(x, y, tileSize);
        // All gameplay collision uses worldToGrid=floor(world/tileSize), meaning a tile spans:
        // [x*tileSize, (x+1)*tileSize) with its center at (x+0.5)*tileSize.
        // Keep visuals aligned to that convention to avoid apparent "clipping through walls".
        const centerX = worldPos.x + tileSize / 2;
        const centerZ = worldPos.z + tileSize / 2;
        const roomType = roomMap?.[y]?.[x] ?? ROOM_TYPES.CORRIDOR;

        const tile = grid[y][x];
        if (tile === TILE_TYPES.WALL) {
          pushInstance(wallInstances, roomType, centerX, centerZ);
          continue;
        }

        // FLOOR/DOOR are walkable: render floor + ceiling.
        pushInstance(floorInstances, roomType, centerX, centerZ);
        pushInstance(ceilingInstances, roomType, centerX, centerZ);

        // Spawn planned props (visuals match WorldState obstacle map)
        const planned = worldState?.getPropAt ? worldState.getPropAt(x, y) : null;
        const props = createRoomPropsFromPlan(roomType, x, y, planned);
        props.forEach(prop => {
          this.addWorldObject(prop);
        });
      }
    }

    // Pre-rotate floor/ceiling geometries once (cheaper than per-instance rotations).
    floorGeometry.rotateX(-Math.PI / 2);
    ceilingGeometry.rotateX(Math.PI / 2);

    const tmpPos = new THREE.Vector3();
    const tmpQuat = new THREE.Quaternion(); // identity
    const tmpScale = new THREE.Vector3(1, 1, 1);
    const tmpMatrix = new THREE.Matrix4();

    const addInstancedTiles = (instances, geometry, getMaterial, yPos, { namePrefix = '' } = {}) => {
      for (const [roomType, coords] of instances.entries()) {
        const count = Math.floor((coords?.length || 0) / 2);
        if (count <= 0) continue;

        const material = getMaterial(roomType);
        if (!material) continue;

        const mesh = new THREE.InstancedMesh(geometry, material, count);
        if (namePrefix) mesh.name = `${namePrefix}_${roomType}`;

        for (let i = 0; i < count; i++) {
          const cx = coords[i * 2];
          const cz = coords[i * 2 + 1];
          tmpPos.set(cx, yPos, cz);
          tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
          mesh.setMatrixAt(i, tmpMatrix);
        }
        mesh.instanceMatrix.needsUpdate = true;

        // Ensure frustum culling uses a correct bounding volume for the spread-out instances.
        mesh.computeBoundingBox?.();
        mesh.computeBoundingSphere?.();

        this.addWorldObject(mesh);
      }
    };

    const corridorMaterials = roomMaterials[ROOM_TYPES.CORRIDOR] || null;

    addInstancedTiles(
      floorInstances,
      floorGeometry,
      (roomType) => (roomMaterials[roomType]?.floor || corridorMaterials?.floor),
      0,
      { namePrefix: '__floor' }
    );

    addInstancedTiles(
      ceilingInstances,
      ceilingGeometry,
      (roomType) => (roomMaterials[roomType]?.ceiling || corridorMaterials?.ceiling),
      CONFIG.WALL_HEIGHT,
      { namePrefix: '__ceiling' }
    );

    // Walls sit at half height.
    addInstancedTiles(
      wallInstances,
      wallGeometry,
      (roomType) => (roomMaterials[roomType]?.wall || corridorMaterials?.wall),
      CONFIG.WALL_HEIGHT / 2,
      { namePrefix: '__wall' }
    );

    // Wall meshes are used for optional raycasts; include instanced walls.
    this.wallMeshes = this.worldMeshes.filter((m) => m?.isInstancedMesh && String(m.name || '').startsWith('__wall_'));

    console.log(`Built world: ${this.worldMeshes.length} meshes created (including props)`);

    // Debug overlay: visualize obstacleMap tiles in 3D (toggle in settings).
    this.rebuildObstacleOverlay(worldState);

    // Async decorations (models/textures) that are placed per-room.
    this.spawnRoomModels(worldState, buildToken).catch((err) => {
      console.log('⚠️ Room model spawn failed', err?.message || err);
    });
  }

  rebuildObstacleOverlay(worldState) {
    if (this.obstacleOverlay) {
      const overlay = this.obstacleOverlay;
      this.scene.remove(overlay);
      const idx = this.worldMeshes.indexOf(overlay);
      if (idx >= 0) this.worldMeshes.splice(idx, 1);
      overlay.geometry?.dispose?.();
      if (Array.isArray(overlay.material)) {
        overlay.material.forEach((m) => m?.dispose?.());
      } else {
        overlay.material?.dispose?.();
      }
      this.obstacleOverlay = null;
    }

    if (!(CONFIG.WORLD_SHOW_OBSTACLE_OVERLAY ?? false)) return;
    this.setObstacleOverlayEnabled(true, worldState);
  }

  setObstacleOverlayEnabled(enabled, worldState) {
    const want = !!enabled;
    if (!want) {
      if (this.obstacleOverlay) {
        this.obstacleOverlay.visible = false;
      }
      return;
    }

    if (!this.obstacleOverlay) {
      const overlay = createObstacleOverlayMesh(worldState);
      if (!overlay) return;
      this.obstacleOverlay = overlay;
      this.addWorldObject(overlay);
    }

    this.obstacleOverlay.visible = true;
  }

  async loadGltfPrototype(url) {
    if (!url) throw new Error('Missing model URL');

    if (this.modelCache.has(url)) {
      return this.modelCache.get(url);
    }
    if (this.modelPromises.has(url)) {
      return this.modelPromises.get(url);
    }

    const loader = await this.getGltfLoader();

    const promise = new Promise((resolve, reject) => {
      loader.load(
        url,
        (gltf) => {
          const scene = gltf?.scene || null;
          if (!scene) {
            reject(new Error(`GLTF has no scene: ${url}`));
            return;
          }
          scene.traverse((child) => {
            if (!child?.isMesh) return;
            child.castShadow = true;
            child.receiveShadow = true;
          });
          // Mark as shared/cached asset so world disposal doesn't nuke cached resources.
          scene.traverse((child) => {
            child.userData = child.userData || {};
            child.userData.__sharedAsset = true;
          });
          scene.userData = scene.userData || {};
          scene.userData.__sharedAsset = true;
          resolve(scene);
        },
        undefined,
        (err) => reject(err)
      );
    }).then((scene) => {
      this.modelCache.set(url, scene);
      this.modelPromises.delete(url);
      return scene;
    }).catch((err) => {
      this.modelPromises.delete(url);
      throw err;
    });

    this.modelPromises.set(url, promise);
    return promise;
  }

  async spawnRoomModels(worldState, buildToken) {
    await this.spawnPoolModels(worldState, buildToken);
  }

  async spawnPoolModels(worldState, buildToken) {
    if (!CONFIG.POOL_MODEL_ENABLED) return;
    if (!worldState) return;

    const rooms = worldState.getRooms ? worldState.getRooms() : [];
    const poolRooms = rooms.filter((r) => r?.type === ROOM_TYPES.POOL);
    if (poolRooms.length === 0) return;

    const url = CONFIG.POOL_MODEL_PATH || '/models/pool_5.glb';
    let prototype = null;
    try {
      prototype = await this.loadGltfPrototype(url);
    } catch (err) {
      console.log(`⚠️ Pool model load failed (${url})`, err?.message || err);
      return;
    }

    if (!prototype) return;
    if (buildToken !== this.worldBuildToken) return;

    const tileSize = CONFIG.TILE_SIZE || 1;
    const box = new THREE.Box3();
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    const yRotations = [0, Math.PI / 2, Math.PI, Math.PI * 3 / 2];

    for (const room of poolRooms) {
      if (buildToken !== this.worldBuildToken) return;
      if (!room || !Number.isFinite(room.width) || !Number.isFinite(room.height)) continue;

      const roomWorldW = room.width * tileSize;
      const roomWorldH = room.height * tileSize;
      const targetX = roomWorldW * 0.86;
      const targetZ = roomWorldH * 0.86;

      const model = prototype.clone(true);

      let best = { scale: 1, rot: 0 };
      for (const rot of yRotations) {
        model.position.set(0, 0, 0);
        model.rotation.set(0, rot, 0);
        model.scale.setScalar(1);
        model.updateMatrixWorld(true);
        box.setFromObject(model);
        box.getSize(size);
        if (!Number.isFinite(size.x) || !Number.isFinite(size.z) || size.x <= 0.001 || size.z <= 0.001) {
          continue;
        }
        const s = Math.min(targetX / size.x, targetZ / size.z);
        if (s > best.scale) best = { scale: s, rot };
      }

      model.position.set(0, 0, 0);
      model.rotation.set(0, best.rot, 0);
      model.scale.setScalar(Math.max(0.01, best.scale));
      model.updateMatrixWorld(true);
      box.setFromObject(model);
      box.getCenter(center);

      // Room bounds are in grid tiles. With tile centers at (x+0.5)*tileSize,
      // the room center is (room.x + room.width/2)*tileSize.
      const centerGX = room.x + room.width / 2;
      const centerGY = room.y + room.height / 2;
      const worldX = centerGX * tileSize;
      const worldZ = centerGY * tileSize;

      // Center the model on the room and sit it on the floor.
      model.position.set(
        worldX - center.x,
        0.01 - box.min.y,
        worldZ - center.z
      );

      this.scene.add(model);
      this.worldMeshes.push(model);

      if (CONFIG.POOL_FX_ENABLED && !CONFIG.LOW_PERF_MODE) {
        const fx = this.createPoolFx(worldX, worldZ, roomWorldW, roomWorldH);
        if (fx) {
          this.addWorldObject(fx);
        }
      }
    }
  }

  createPoolFx(centerX, centerZ, roomWorldW, roomWorldH) {
    // Lightweight animated water surface + subtle light pulse.
    const tileSize = CONFIG.TILE_SIZE || 1;
    const waterW = Math.max(tileSize * 1.2, roomWorldW * 0.72);
    const waterD = Math.max(tileSize * 0.9, roomWorldH * 0.56);

    const geo = new THREE.PlaneGeometry(waterW, waterD, 18, 14);
    geo.rotateX(-Math.PI / 2);

    const mat = new THREE.MeshPhysicalMaterial({
      color: 0x4ab8ff,
      transparent: true,
      opacity: 0.6,
      roughness: 0.06,
      metalness: 0.05,
      clearcoat: 1.0,
      clearcoatRoughness: 0.04,
      transmission: 0.68,
      ior: 1.33,
      envMap: this.environmentMap,
      envMapIntensity: 1.2,
      depthWrite: false
    });

    const water = new THREE.Mesh(geo, mat);
    water.position.set(centerX, 0.54, centerZ);
    water.receiveShadow = false;
    water.castShadow = false;

    const light = new THREE.PointLight(0x4ab8ff, 0.55, Math.max(roomWorldW, roomWorldH) * 2.2, 2);
    light.position.set(centerX, 1.2, centerZ);

    const group = new THREE.Group();
    group.name = '__poolFx';
    group.add(water);
    group.add(light);

    const base = geo.attributes.position.array.slice();
    group.userData.wave = {
      base,
      time: Math.random() * 10,
      amplitude: 0.08,
      frequency: 1.5,
      choppiness: 1.15
    };
    group.userData.tick = (dt) => {
      const wave = group.userData.wave;
      if (!wave) return;
      wave.time += dt;

      const pos = geo.attributes.position.array;
      for (let i = 0; i < pos.length; i += 3) {
        const ox = base[i];
        const oz = base[i + 2];
        const w1 = Math.sin(ox * wave.choppiness * 0.7 + wave.time * wave.frequency);
        const w2 = Math.cos(oz * wave.choppiness + wave.time * (wave.frequency * 0.75));
        pos[i + 1] = base[i + 1] + (w1 + w2) * 0.5 * wave.amplitude;
      }
      geo.attributes.position.needsUpdate = true;
      geo.computeVertexNormals();

      if (light) {
        light.intensity = 0.45 + Math.sin(wave.time * 1.3) * 0.12;
      }
    };

    return group;
  }

  /**
   * Clear all world meshes from the scene
   */
  clearWorld() {
    const geometries = new Set();
    const materials = new Set();
    const textures = new Set();

    const collectMaterial = (mat) => {
      if (!mat) return;
      materials.add(mat);

      const texKeys = [
        'map',
        'normalMap',
        'roughnessMap',
        'metalnessMap',
        'emissiveMap',
        'aoMap',
        'alphaMap',
        'bumpMap',
        'displacementMap'
      ];
      for (const key of texKeys) {
        const tex = mat[key];
        if (tex) textures.add(tex);
      }
    };

    this.worldMeshes.forEach(obj => {
      if (!obj) return;
      this.scene.remove(obj);

      obj.traverse?.((child) => {
        if (!child) return;
        if (child.userData?.__sharedAsset) return;
        if (child.geometry) {
          geometries.add(child.geometry);
        }
        const mat = child.material;
        if (Array.isArray(mat)) {
          mat.forEach(collectMaterial);
        } else if (mat) {
          collectMaterial(mat);
        }
      });
    });

    textures.forEach((tex) => {
      try {
        tex.dispose?.();
      } catch (err) {
        void err;
      }
    });
    materials.forEach((mat) => {
      try {
        mat.dispose?.();
      } catch (err) {
        void err;
      }
    });
    geometries.forEach((geo) => {
      try {
        geo.dispose?.();
      } catch (err) {
        void err;
      }
    });
    this.worldMeshes = [];
    this.wallMeshes = [];
    this.tickables = [];
    this.obstacleOverlay = null;
  }

  /**
   * Render the scene
   */
  update(deltaTime) {
    if (!deltaTime) return;
    for (const obj of this.tickables) {
      obj?.userData?.tick?.(deltaTime);
    }
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

  refreshEnvironmentMap() {
    try {
      this.environmentMap?.dispose?.();
    } catch (err) {
      void err;
    }
    this._setupEnvironmentMap();
  }

  /**
   * Cleanup resources
   */
  dispose() {
    this.clearWorld();
    this.renderer.dispose();
  }
}
