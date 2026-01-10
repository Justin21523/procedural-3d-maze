/**
 * Lighting setup for the Backrooms-like atmosphere
 * Creates ambient and point lights to simulate fluorescent office lighting
 */

import * as THREE from 'three';

/**
 * Setup lighting for the scene
 * Creates a Backrooms-style atmosphere with yellowish ambient light
 * @param {THREE.Scene} scene - The Three.js scene to add lights to
 */
export function setupLighting(scene) {
  // 環境光：給整體一點黃白色 base light
  const ambientLight = new THREE.AmbientLight(0xffffcc, 0.38);
  scene.add(ambientLight);

  // 半球光：模擬來自上方的冷色 + 下方反射的暗色
  const hemiLight = new THREE.HemisphereLight(0xffffee, 0x202020, 0.32);
  hemiLight.position.set(0, 20, 0);
  scene.add(hemiLight);

  // 主要方向光，模擬頂上的一排日光燈
  const directionalLight = new THREE.DirectionalLight(0xffffdd, 0.78);
  directionalLight.position.set(5, 12, 2);

  // 陰影設定（不要太大，避免 FPS 掉太兇）
  directionalLight.castShadow = true;
  directionalLight.shadow.mapSize.set(1024, 1024);
  directionalLight.shadow.camera.near = 0.5;
  directionalLight.shadow.camera.far = 50;
  directionalLight.shadow.bias = -0.0005;

  scene.add(directionalLight);

  // Flicker controller（沿用舊邏輯）
  const flickerData = {
    time: 0,
    nextFlicker: Math.random() * 5 + 3, // 3-8 秒一次
    isFlickering: false,
    flickerDuration: 0,
    originalIntensity: directionalLight.intensity,
    baseIntensity: ambientLight.intensity
  };

  return {
    ambientLight,
    hemiLight,
    directionalLight,
    flickerData,
  };
}


/**
 * Update lighting (call every frame for flickering effect)
 * @param {Object} lights - Lights object returned from setupLighting
 * @param {number} deltaTime - Time since last frame
 */
export function updateLighting(lights, deltaTime) {
  if (!lights || !lights.flickerData) return;

  const { directionalLight, ambientLight, hemiLight, flickerData } = lights;

  flickerData.time += deltaTime;

  if (!flickerData.isFlickering && flickerData.time >= flickerData.nextFlicker) {
    flickerData.isFlickering = true;
    flickerData.flickerDuration = Math.random() * 0.3 + 0.1;
    flickerData.time = 0;
  }

  if (flickerData.isFlickering) {
    const flicker = Math.random() * 0.5 + 0.3;

    directionalLight.intensity = flickerData.originalIntensity * flicker;
    ambientLight.intensity = flickerData.baseIntensity * flicker;
    if (hemiLight) hemiLight.intensity = 0.25 * flicker;

    if (flickerData.time >= flickerData.flickerDuration) {
      flickerData.isFlickering = false;
      flickerData.time = 0;
      flickerData.nextFlicker = Math.random() * 8 + 5;

      directionalLight.intensity = flickerData.originalIntensity;
      ambientLight.intensity = flickerData.baseIntensity;
      if (hemiLight) hemiLight.intensity = 0.25;
    }
  }
}

/**
 * Add a point light at a specific position
 * Can be used to add lights in specific rooms or corridors
 * @param {THREE.Scene} scene - The scene to add the light to
 * @param {number} x - World X position
 * @param {number} y - World Y position
 * @param {number} z - World Z position
 * @param {number} intensity - Light intensity
 * @returns {THREE.PointLight} The created point light
 */
export function addPointLight(scene, x, y, z, intensity = 1) {
  const pointLight = new THREE.PointLight(0xffffcc, intensity, 15);
  pointLight.position.set(x, y, z);
  scene.add(pointLight);
  return pointLight;
}
