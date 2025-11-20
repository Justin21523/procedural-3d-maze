/**
 * 3D Model loader for GLTF/GLB and DAE files
 * Handles loading and caching of 3D models
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';

export class ModelLoader {
  constructor() {
    this.gltfLoader = new GLTFLoader();
    this.daeLoader = new ColladaLoader();
    this.cache = new Map(); // Cache loaded models
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
      return this.cache.get(path).clone();
    }

    console.log(`🔄 Loading model: ${path}`);

    // Determine file type and select appropriate loader
    const isDAE = path.toLowerCase().endsWith('.dae');
    const loader = isDAE ? this.daeLoader : this.gltfLoader;

    return new Promise((resolve, reject) => {
      loader.load(
        path,
        (data) => {
          console.log(`✅ Model loaded: ${path}`);

          // Handle different loader response formats
          const scene = isDAE ? data.scene : data.scene;

          // Store in cache
          this.cache.set(path, scene);

          // Enable shadows on all meshes
          scene.traverse((child) => {
            if (child.isMesh) {
              child.castShadow = true;
              child.receiveShadow = true;
            }
          });

          // Return a clone so the original stays in cache
          resolve(scene.clone());
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

    // Determine file type and select appropriate loader
    const isDAE = path.toLowerCase().endsWith('.dae');
    const loader = isDAE ? this.daeLoader : this.gltfLoader;
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

          console.log(`✅ Animated model loaded: ${path}`);
          console.log('   - Animations:', animations.length);
          console.log('   - Scene children:', scene.children.length);
          console.log('   - Scene type:', scene.type);

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

          resolve({
            model: scene,
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
