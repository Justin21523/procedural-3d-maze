/**
 * Exit Point
 * Creates and manages the exit point in the maze
 */

import * as THREE from 'three';
import { CONFIG } from '../core/config.js';

export class ExitPoint {
  /**
   * Create an exit point
   * @param {Object} gridPosition - Grid position {x, y}
   */
  constructor(gridPosition) {
    this.gridX = gridPosition.x;
    this.gridY = gridPosition.y;

    // World position
    const tileSize = CONFIG.TILE_SIZE || 1;
    // Tile spans [x*tileSize, (x+1)*tileSize); center at (x+0.5)*tileSize
    this.worldX = gridPosition.x * tileSize + tileSize / 2;
    this.worldZ = gridPosition.y * tileSize + tileSize / 2;

    // Create visual representation
    this.mesh = this.createExitMesh();
    // Place the group at floor level; the portal visuals are positioned within the group.
    this.baseY = 0;
    this.mesh.position.set(this.worldX, this.baseY, this.worldZ);
    this.unlocked = true;
    this.setUnlocked(true);

    // Animation
    this.time = 0;
    this.rotationSpeed = 1;
    this.bobSpeed = 2;
    this.bobAmount = 0.3;

    console.log(`🚪 Exit point created at grid (${this.gridX}, ${this.gridY})`);
  }

  /**
   * Create the 3D mesh for the exit
   * @returns {THREE.Group} Exit mesh
   */
  createExitMesh() {
    const group = new THREE.Group();

    // Main portal (glowing ring)
    const ringGeometry = new THREE.TorusGeometry(1, 0.15, 16, 32);
    const ringMaterial = new THREE.MeshStandardMaterial({
      color: 0x00ff00,
      emissive: 0x00ff00,
      emissiveIntensity: 1,
      metalness: 0.5,
      roughness: 0.2
    });
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 1.5;
    group.add(ring);

    // Inner glow
    const glowGeometry = new THREE.CircleGeometry(0.9, 32);
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ff00,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide
    });
    const glow = new THREE.Mesh(glowGeometry, glowMaterial);
    glow.rotation.x = Math.PI / 2;
    glow.position.y = 1.5;
    group.add(glow);

    // Base platform
    const platformGeometry = new THREE.CylinderGeometry(1.2, 1.5, 0.2, 32);
    const platformMaterial = new THREE.MeshStandardMaterial({
      color: 0x44ff44,
      emissive: 0x00ff00,
      emissiveIntensity: 0.3,
      metalness: 0.6,
      roughness: 0.4
    });
    const platform = new THREE.Mesh(platformGeometry, platformMaterial);
    platform.position.y = 0.1;
    platform.castShadow = true;
    platform.receiveShadow = true;
    group.add(platform);

    // Particles (small cubes around the exit)
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const radius = 1.5;

      const particleGeometry = new THREE.BoxGeometry(0.1, 0.1, 0.1);
      const particleMaterial = new THREE.MeshStandardMaterial({
        color: 0x00ff00,
        emissive: 0x00ff00,
        emissiveIntensity: 0.8
      });
      const particle = new THREE.Mesh(particleGeometry, particleMaterial);

      particle.position.set(
        Math.cos(angle) * radius,
        1.5 + Math.random() * 0.5,
        Math.sin(angle) * radius
      );

      particle.userData.angle = angle;
      particle.userData.offset = Math.random() * Math.PI * 2;

      group.add(particle);
    }

    // Add point light
    const light = new THREE.PointLight(0x00ff00, 2, 10);
    light.position.y = 1.5;
    group.add(light);

    return group;
  }

  setUnlocked(unlocked) {
    this.unlocked = unlocked !== false;
    const color = this.unlocked ? 0x00ff00 : 0xff4444;

    const ring = this.mesh?.children?.[0] || null;
    if (ring?.material) {
      ring.material.color.setHex(color);
      ring.material.emissive.setHex(color);
    }

    const glow = this.mesh?.children?.[1] || null;
    if (glow?.material) {
      glow.material.color.setHex(color);
    }

    const platform = this.mesh?.children?.[2] || null;
    if (platform?.material) {
      platform.material.color.setHex(this.unlocked ? 0x44ff44 : 0x663333);
      platform.material.emissive.setHex(color);
    }

    if (this.mesh) {
      this.mesh.children.forEach((child) => {
        if (!child) return;
        if (child.isPointLight) {
          child.color?.setHex?.(color);
          child.intensity = this.unlocked ? 2 : 1.2;
          return;
        }
        if (child.isMesh && child.material && child !== ring && child !== glow && child !== platform) {
          child.material.color?.setHex?.(color);
          child.material.emissive?.setHex?.(color);
        }
      });
    }
  }

  /**
   * Update exit animation
   * @param {number} deltaTime - Time since last frame
   */
  update(deltaTime) {
    this.time += deltaTime;

    // Rotate the main ring
    const ring = this.mesh.children[0];
    if (ring) {
      ring.rotation.z += this.rotationSpeed * deltaTime;
    }

    // Bob up and down
    this.mesh.position.y = this.baseY + Math.sin(this.time * this.bobSpeed) * this.bobAmount;

    // Animate particles
    this.mesh.children.forEach((child, index) => {
      if (index > 2) { // Skip ring, glow, and platform
        if (child.userData.angle !== undefined) {
          const angle = child.userData.angle + this.time;
          const radius = 1.5;
          const offset = child.userData.offset;

          child.position.x = Math.cos(angle) * radius;
          child.position.z = Math.sin(angle) * radius;
          child.position.y = 1.5 + Math.sin(this.time * 3 + offset) * 0.3;

          child.rotation.x += deltaTime * 2;
          child.rotation.y += deltaTime * 3;
        }
      }
    });

    // Pulse the glow
    const glow = this.mesh.children[1];
    if (glow && glow.material) {
      glow.material.opacity = 0.2 + Math.sin(this.time * 4) * 0.1;
    }
  }

  /**
   * Check if player is near the exit
   * @param {THREE.Vector3} playerPosition - Player world position
   * @param {number} distance - Detection distance
   * @returns {boolean} True if player is near
   */
  isPlayerNear(playerPosition, distance = 2) {
    const dx = playerPosition.x - this.worldX;
    const dz = playerPosition.z - this.worldZ;
    const dist = Math.sqrt(dx * dx + dz * dz);
    return dist < distance;
  }

  /**
   * Get the 3D mesh
   * @returns {THREE.Group} Exit mesh
   */
  getMesh() {
    return this.mesh;
  }

  /**
   * Get grid position
   * @returns {Object} Grid position {x, y}
   */
  getGridPosition() {
    return { x: this.gridX, y: this.gridY };
  }

  /**
   * Get world position
   * @returns {Object} World position {x, z}
   */
  getWorldPosition() {
    return { x: this.worldX, z: this.worldZ };
  }
}
