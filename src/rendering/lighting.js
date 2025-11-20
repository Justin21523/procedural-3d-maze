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
  // Ambient light - provides base illumination
  // Yellowish tint for that "old office" feel
  const ambientLight = new THREE.AmbientLight(0xffffcc, 0.5);
  scene.add(ambientLight);

  // Directional light - simulates overhead lighting
  const directionalLight = new THREE.DirectionalLight(0xffffdd, 0.6);
  directionalLight.position.set(0, 10, 0);
  scene.add(directionalLight);

  // Create flickering controller
  const flickerData = {
    time: 0,
    nextFlicker: Math.random() * 5 + 3, // 3-8 seconds
    isFlickering: false,
    flickerDuration: 0,
    originalIntensity: 0.6,
    baseIntensity: 0.5,
  };

  return {
    ambientLight,
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

  const { directionalLight, ambientLight, flickerData } = lights;

  flickerData.time += deltaTime;

  // Check if it's time to flicker
  if (!flickerData.isFlickering && flickerData.time >= flickerData.nextFlicker) {
    flickerData.isFlickering = true;
    flickerData.flickerDuration = Math.random() * 0.3 + 0.1; // 0.1-0.4 seconds
    flickerData.time = 0;
  }

  // Apply flicker effect
  if (flickerData.isFlickering) {
    // Random intensity variation during flicker
    const flicker = Math.random() * 0.5 + 0.3; // 0.3-0.8
    directionalLight.intensity = flickerData.originalIntensity * flicker;
    ambientLight.intensity = flickerData.baseIntensity * flicker;

    // End flicker
    if (flickerData.time >= flickerData.flickerDuration) {
      flickerData.isFlickering = false;
      flickerData.time = 0;
      flickerData.nextFlicker = Math.random() * 8 + 5; // 5-13 seconds
      // Restore original intensity
      directionalLight.intensity = flickerData.originalIntensity;
      ambientLight.intensity = flickerData.baseIntensity;
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
