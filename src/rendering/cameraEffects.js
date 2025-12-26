/**
 * Camera Effects for first-person immersion
 * Includes head bob, dynamic FOV, and breathing effects
 */

import * as THREE from 'three';
import { CONFIG } from '../core/config.js';

export class CameraEffects {
  /**
   * Create camera effects manager
   * @param {THREE.PerspectiveCamera} camera - The Three.js camera
   */
  constructor(camera) {
    this.camera = camera;
    this.baseFOV = CONFIG.FOV;

    // Head bob parameters
    this.bobPhase = 0;
    this.bobAmplitudeY = 0.04;    // Vertical bob amplitude
    this.bobAmplitudeX = 0.02;    // Horizontal sway amplitude
    this.bobFrequency = 1.8;      // Bob frequency (Hz)
    this.sprintBobMultiplier = 1.3;

    // FOV parameters
    this.sprintFOVBoost = 8;      // FOV increase when sprinting
    this.currentFOVOffset = 0;
    this.fovTransitionSpeed = 5;  // How fast FOV changes

    // Breathing effect (subtle idle movement)
    this.breathPhase = 0;
    this.breathAmplitude = 0.002;
    this.breathFrequency = 0.3;   // Slow breathing

    // Smoothing
    this.smoothSpeed = 0;
    this.smoothingFactor = 8;     // How fast to interpolate movement speed

    // Current offsets
    this.positionOffset = new THREE.Vector3();
  }

  /**
   * Update all camera effects
   * @param {number} deltaTime - Time since last frame
   * @param {Object} context - Movement context { isMoving, isSprinting, speed }
   */
  update(deltaTime, context) {
    const { isMoving, isSprinting, speed } = context;

    // Smooth speed transition
    const targetSpeed = isMoving ? (speed || 1) : 0;
    this.smoothSpeed += (targetSpeed - this.smoothSpeed) * deltaTime * this.smoothingFactor;

    // Reset offsets
    this.positionOffset.set(0, 0, 0);

    // Update head bob
    if (CONFIG.HEAD_BOB_ENABLED !== false) {
      this.updateHeadBob(deltaTime, isSprinting);
    }

    // Update breathing (always active, but subtle)
    this.updateBreathing(deltaTime);

    // Update dynamic FOV
    if (CONFIG.DYNAMIC_FOV_ENABLED !== false) {
      this.updateDynamicFOV(deltaTime, isSprinting);
    }
  }

  /**
   * Update head bob effect
   * @param {number} deltaTime
   * @param {boolean} isSprinting
   */
  updateHeadBob(deltaTime, isSprinting) {
    if (this.smoothSpeed < 0.01) {
      return;
    }

    // Calculate frequency based on sprint state
    const freq = this.bobFrequency * (isSprinting ? this.sprintBobMultiplier : 1);

    // Update phase
    this.bobPhase += deltaTime * freq * Math.PI * 2;

    // Apply intensity from config (default 1.0)
    const intensity = CONFIG.HEAD_BOB_INTENSITY || 1.0;

    // Calculate bob offsets
    // Vertical bob (sine wave)
    const bobY = Math.sin(this.bobPhase) * this.bobAmplitudeY * this.smoothSpeed * intensity;

    // Horizontal sway (half frequency, creates figure-8 pattern)
    const bobX = Math.cos(this.bobPhase * 0.5) * this.bobAmplitudeX * this.smoothSpeed * intensity;

    this.positionOffset.y += bobY;
    this.positionOffset.x += bobX;
  }

  /**
   * Update breathing effect (subtle idle movement)
   * @param {number} deltaTime
   */
  updateBreathing(deltaTime) {
    // Only apply breathing when not moving much
    if (this.smoothSpeed > 0.1) {
      return;
    }

    this.breathPhase += deltaTime * this.breathFrequency * Math.PI * 2;

    // Very subtle vertical movement
    const breathY = Math.sin(this.breathPhase) * this.breathAmplitude;
    this.positionOffset.y += breathY;
  }

  /**
   * Update dynamic FOV effect
   * @param {number} deltaTime
   * @param {boolean} isSprinting
   */
  updateDynamicFOV(deltaTime, isSprinting) {
    const targetOffset = isSprinting ? this.sprintFOVBoost : 0;

    // Smooth interpolation
    this.currentFOVOffset += (targetOffset - this.currentFOVOffset) * deltaTime * this.fovTransitionSpeed;

    // Apply FOV
    const newFOV = this.baseFOV + this.currentFOVOffset;
    if (Math.abs(this.camera.fov - newFOV) > 0.01) {
      this.camera.fov = newFOV;
      this.camera.updateProjectionMatrix();
    }
  }

  /**
   * Get current position offset for camera
   * @returns {THREE.Vector3} Position offset to apply
   */
  getPositionOffset() {
    return this.positionOffset;
  }

  /**
   * Set base FOV (called when user changes FOV in settings)
   * @param {number} fov - New base FOV
   */
  setBaseFOV(fov) {
    this.baseFOV = fov;
  }

  /**
   * Get current FOV including effects
   * @returns {number} Current FOV
   */
  getCurrentFOV() {
    return this.baseFOV + this.currentFOVOffset;
  }

  /**
   * Trigger a temporary FOV pulse (for scares, etc.)
   * @param {number} amount - FOV change amount
   * @param {number} duration - Effect duration in seconds
   */
  triggerFOVPulse(amount, duration = 0.3) {
    // This could be extended for jump scares
    const originalOffset = this.currentFOVOffset;
    this.currentFOVOffset += amount;

    // Reset after duration (simplified, could use proper timing)
    setTimeout(() => {
      this.currentFOVOffset = originalOffset;
    }, duration * 1000);
  }

  /**
   * Reset all effects
   */
  reset() {
    this.bobPhase = 0;
    this.breathPhase = 0;
    this.currentFOVOffset = 0;
    this.smoothSpeed = 0;
    this.positionOffset.set(0, 0, 0);

    this.camera.fov = this.baseFOV;
    this.camera.updateProjectionMatrix();
  }
}
