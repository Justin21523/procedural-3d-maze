/**
 * First-person camera controller
 * Manages camera rotation (yaw/pitch) and position synchronization
 */

import * as THREE from 'three';
import { CONFIG } from '../core/config.js';
import { clamp } from '../utils/math.js';

export class FirstPersonCamera {
  /**
   * Create a first-person perspective camera
   * @param {number} aspect - Aspect ratio (width/height)
   */
  constructor(aspect) {
    this.camera = new THREE.PerspectiveCamera(
      CONFIG.FOV,
      aspect,
      CONFIG.NEAR_PLANE,
      CONFIG.FAR_PLANE
    );

    // Camera rotation state
    this.yaw = 0;      // Horizontal rotation (left-right)
    this.pitch = 0;    // Vertical rotation (up-down)

    // Set initial position
    this.camera.position.set(0, CONFIG.PLAYER_HEIGHT, 0);
  }

  /**
   * Update camera rotation based on mouse movement
   * @param {number} deltaX - Mouse movement X (pixels)
   * @param {number} deltaY - Mouse movement Y (pixels)
   * @param {number} sensitivity - Mouse sensitivity multiplier
   */
  updateRotation(deltaX, deltaY, sensitivity = CONFIG.MOUSE_SENSITIVITY) {
    this.yaw -= deltaX * sensitivity;
    this.pitch -= deltaY * sensitivity;

    // Clamp pitch to prevent camera flipping
    this.pitch = clamp(this.pitch, -Math.PI / 2 + 0.1, Math.PI / 2 - 0.1);

    // Apply rotation to camera
    // Order is important: YXZ ensures yaw is applied before pitch
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
  }

  /**
   * Update camera position
   * @param {number} x - World X position
   * @param {number} y - World Y position (usually player height)
   * @param {number} z - World Z position
   */
  updatePosition(x, y, z) {
    this.camera.position.set(x, y, z);
  }

  /**
   * Get the camera's forward direction vector (on XZ plane)
   * Useful for movement calculations
   * @returns {THREE.Vector3} Normalized forward vector
   */
  getForwardVector() {
    const direction = new THREE.Vector3();
    this.camera.getWorldDirection(direction);
    direction.y = 0; // Flatten to XZ plane
    direction.normalize();
    return direction;
  }

  /**
   * Get the camera's right direction vector (on XZ plane)
   * Useful for strafe movement
   * @returns {THREE.Vector3} Normalized right vector
   */
  getRightVector() {
    const forward = this.getForwardVector();
    const right = new THREE.Vector3();
    right.crossVectors(forward, new THREE.Vector3(0, 1, 0));
    right.normalize();
    return right;
  }

  /**
   * Get the Three.js camera object
   * @returns {THREE.PerspectiveCamera} The camera
   */
  getCamera() {
    return this.camera;
  }

  /**
   * Update aspect ratio (e.g., on window resize)
   * @param {number} aspect - New aspect ratio
   */
  updateAspect(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Get current yaw angle
   * @returns {number} Yaw in radians
   */
  getYaw() {
    return this.yaw;
  }

  /**
   * Get current pitch angle
   * @returns {number} Pitch in radians
   */
  getPitch() {
    return this.pitch;
  }
}
