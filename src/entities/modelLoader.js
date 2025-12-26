/**
 * 3D Model loader for GLTF/GLB and DAE files
 * Handles loading and caching of 3D models
 */

import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';

export class ModelLoader {
  constructor() {
    this.manager = new THREE.LoadingManager();
    this.manager.setURLModifier((url) => {
      if (typeof url !== 'string') return url;
      if (url.startsWith('data:') || url.startsWith('blob:')) return url;
      return encodeURI(url);
    });

    this.gltfLoader = null;
    this.daeLoader = null;
    this.gltfLoaderPromise = null;
    this.daeLoaderPromise = null;
    this.cache = new Map(); // path -> { scene, animations, hasSkinnedMesh }
  }

  async getGltfLoader() {
    if (this.gltfLoader) return this.gltfLoader;
    if (this.gltfLoaderPromise) return this.gltfLoaderPromise;

    this.gltfLoaderPromise = import('three/examples/jsm/loaders/GLTFLoader.js')
      .then(({ GLTFLoader }) => {
        this.gltfLoader = new GLTFLoader(this.manager);
        return this.gltfLoader;
      })
      .finally(() => {
        this.gltfLoaderPromise = null;
      });

    return this.gltfLoaderPromise;
  }

  async getDaeLoader() {
    if (this.daeLoader) return this.daeLoader;
    if (this.daeLoaderPromise) return this.daeLoaderPromise;

    this.daeLoaderPromise = import('three/examples/jsm/loaders/ColladaLoader.js')
      .then(({ ColladaLoader }) => {
        this.daeLoader = new ColladaLoader(this.manager);
        return this.daeLoader;
      })
      .finally(() => {
        this.daeLoaderPromise = null;
      });

    return this.daeLoaderPromise;
  }

  wrapModel(scene) {
    const root = new THREE.Group();
    const yawGroup = new THREE.Group();
    yawGroup.name = '__monsterYaw';
    const correctionGroup = new THREE.Group();
    correctionGroup.name = '__monsterCorrection';

    if (scene) {
      scene.name = '__monsterInner';
      scene.userData.__basePosition = [scene.position.x, scene.position.y, scene.position.z];
      scene.userData.__baseQuaternion = [
        scene.quaternion.x,
        scene.quaternion.y,
        scene.quaternion.z,
        scene.quaternion.w
      ];
      scene.userData.__baseScale = [scene.scale.x, scene.scale.y, scene.scale.z];
    }

    correctionGroup.add(scene);
    yawGroup.add(correctionGroup);
    root.add(yawGroup);

    // Auto-upright:
    // Some models import with X-up or Z-up and appear "lying down".
    // We try a small set of candidate rotations and keep the one that produces the
    // largest Y-extent (height). Apply only if it's a meaningful improvement.
    try {
      const candidates = [
        { x: 0, z: 0 },
        { x: Math.PI / 2, z: 0 },
        { x: -Math.PI / 2, z: 0 },
        { x: 0, z: Math.PI / 2 },
        { x: 0, z: -Math.PI / 2 }
      ];

      const box = new THREE.Box3();
      const size = new THREE.Vector3();

      const measure = () => {
        root.updateMatrixWorld(true);
        box.setFromObject(correctionGroup);
        box.getSize(size);
        return { x: Math.abs(size.x), y: Math.abs(size.y), z: Math.abs(size.z) };
      };

      correctionGroup.rotation.set(0, 0, 0);
      const identity = measure();
      const identityY = identity.y || 0;

      let best = {
        rot: { x: 0, z: 0 },
        size: identity,
        y: identityY,
        ratio: identityY / (Math.max(identity.x, identity.z) + 1e-6)
      };

      for (let i = 1; i < candidates.length; i++) {
        const c = candidates[i];
        correctionGroup.rotation.set(c.x, 0, c.z);
        const s = measure();
        const y = s.y || 0;
        const ratio = y / (Math.max(s.x, s.z) + 1e-6);

        if (y > best.y + 1e-4 || (Math.abs(y - best.y) <= 1e-4 && ratio > best.ratio)) {
          best = { rot: { x: c.x, z: c.z }, size: s, y, ratio };
        }
      }

      const improvedEnough = best.y > identityY * 1.15;
      if (improvedEnough) {
        correctionGroup.rotation.set(best.rot.x, 0, best.rot.z);
        root.updateMatrixWorld(true);
      } else {
        correctionGroup.rotation.set(0, 0, 0);
      }
    } catch (err) {
      void err;
    }

    // Keep legacy fields on the root for debugging/compat.
    root.userData.innerBasePosition = scene?.userData?.__basePosition || [0, 0, 0];
    root.userData.innerBaseQuaternion = scene?.userData?.__baseQuaternion || [0, 0, 0, 1];
    root.userData.innerBaseScale = scene?.userData?.__baseScale || [1, 1, 1];
    root.userData.__yawName = yawGroup.name;
    root.userData.__innerName = scene?.name || '__monsterInner';
    root.userData.__correctionName = correctionGroup.name;

    return root;
  }

  hasSkinnedMesh(scene) {
    let found = false;
    scene?.traverse?.((child) => {
      if (found) return;
      if (child?.isSkinnedMesh) {
        found = true;
      }
    });
    return found;
  }

  cloneModel(model, hasSkinnedMeshHint = null) {
    const hasSkinned = hasSkinnedMeshHint ?? this.hasSkinnedMesh(model);
    return hasSkinned ? cloneSkeleton(model) : model.clone(true);
  }

  /**
   * Load a GLTF/GLB/DAE model
   * @param {string} path - Path to the model file
   * @returns {Promise<THREE.Group>} Loaded model
   */
  async loadModel(path) {
    // Check cache first
    if (this.cache.has(path)) {
      console.log(`📦 Using cached model: ${path}`);
      const entry = this.cache.get(path);
      return this.cloneModel(entry.scene, entry.hasSkinnedMesh);
    }

    console.log(`🔄 Loading model: ${path}`);

    // Determine file type and select appropriate loader
    const isDAE = path.toLowerCase().endsWith('.dae');
    const loader = isDAE ? await this.getDaeLoader() : await this.getGltfLoader();

    return new Promise((resolve, reject) => {
      loader.load(
        path,
        (data) => {
          console.log(`✅ Model loaded: ${path}`);

          // Handle different loader response formats
          const loadedScene = isDAE ? data.scene : data.scene;
          const scene = this.wrapModel(loadedScene);
          const hasSkinnedMesh = this.hasSkinnedMesh(scene);

          // Store in cache
          this.cache.set(path, { scene, animations: [], hasSkinnedMesh });

          // Enable shadows on all meshes
          scene.traverse((child) => {
            if (child.isMesh) {
              child.castShadow = true;
              child.receiveShadow = true;
            }
          });

          // Return a clone so the original stays in cache
          resolve(this.cloneModel(scene, hasSkinnedMesh));
        },
        (progress) => {
          const percent = (progress.loaded / progress.total * 100).toFixed(0);
          console.log(`Loading ${path}: ${percent}%`);
        },
        (error) => {
          console.error(`❌ Error loading model ${path}:`, error);
          reject(error);
        }
      );
    });
  }

  /**
   * Load a model with animations
   * @param {string} path - Path to the model file
   * @returns {Promise<{model: THREE.Group, animations: Array}>} Model and animations
   */
  async loadModelWithAnimations(path) {
    console.log(`🔄 Loading animated model: ${path}`);

    // Check cache first
    if (this.cache.has(path)) {
      const entry = this.cache.get(path);
      console.log(`📦 Using cached animated model: ${path}`);
      return {
        model: this.cloneModel(entry.scene, entry.hasSkinnedMesh),
        animations: entry.animations || []
      };
    }

    // Determine file type and select appropriate loader
    const isDAE = path.toLowerCase().endsWith('.dae');
    const loader = isDAE ? await this.getDaeLoader() : await this.getGltfLoader();
    console.log(`   Using ${isDAE ? 'ColladaLoader' : 'GLTFLoader'} for ${path}`);

    return new Promise((resolve, reject) => {
      loader.load(
        path,
        (data) => {
          // Handle different loader response formats
          let scene, animations;

          if (isDAE) {
            // ColladaLoader returns { scene, animations } in data.scene
            scene = data.scene;
            animations = data.animations || [];
          } else {
            // GLTFLoader returns gltf object
            scene = data.scene;
            animations = data.animations || [];
          }

          scene = this.wrapModel(scene);

          console.log(`✅ Animated model loaded: ${path}`);
          console.log('   - Animations:', animations.length);
          console.log('   - Scene children:', scene.children.length);
          console.log('   - Scene type:', scene.type);

          const hasSkinnedMesh = this.hasSkinnedMesh(scene);

          // Enable shadows
          let meshCount = 0;
          scene.traverse((child) => {
            if (child.isMesh) {
              child.castShadow = true;
              child.receiveShadow = true;
              meshCount++;
            }
          });
          console.log('   - Meshes found:', meshCount);

          // Store in cache (keep a pristine prototype, clone for each use)
          this.cache.set(path, { scene, animations, hasSkinnedMesh });

          resolve({
            model: this.cloneModel(scene, hasSkinnedMesh),
            animations: animations
          });
        },
        (progress) => {
          if (progress.total > 0) {
            const percent = (progress.loaded / progress.total * 100).toFixed(0);
            console.log(`   Loading progress: ${percent}%`);
          }
        },
        (error) => {
          console.error(`❌ Error loading animated model ${path}:`, error);
          console.error('   Error type:', error.constructor.name);
          console.error('   Error message:', error.message);
          reject(error);
        }
      );
    });
  }

  /**
   * Clear the model cache
   */
  clearCache() {
    this.cache.clear();
    console.log('🗑️ Model cache cleared');
  }
}
