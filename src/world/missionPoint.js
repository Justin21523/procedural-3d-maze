import * as THREE from 'three';
import { CONFIG } from '../core/config.js';

/**
 * Mission Point
 * Simple collectible reward point in the maze
 */
export class MissionPoint {
  constructor(gridPos) {
    this.gridPos = gridPos;
    this.collected = false;

    const radius = CONFIG.TILE_SIZE * 0.3;
    const height = CONFIG.TILE_SIZE * 0.2;

    const material = new THREE.MeshStandardMaterial({
      color: 0xffa726,
      emissive: 0xffc107,
      emissiveIntensity: 0.6,
      roughness: 0.4,
      metalness: 0.3,
      transparent: true,
      opacity: 0.9,
    });

    const geometry = new THREE.CylinderGeometry(radius, radius, height, 24);
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;

    const x = gridPos.x * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2;
    const z = gridPos.y * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2;
    this.mesh.position.set(x, height / 2, z);

    // Add a small floating animation
    this.pulseTime = Math.random() * Math.PI * 2;
  }

  update(dt) {
    if (this.collected) return;
    this.pulseTime += dt;
    const offset = Math.sin(this.pulseTime * 2) * 0.1;
    this.mesh.position.y += offset * dt * 60;
    this.mesh.rotation.y += dt;
  }

  isPlayerNear(playerPos, distance = 2) {
    if (this.collected) return false;
    return this.mesh.position.distanceTo(playerPos) < distance;
  }

  collect(scene) {
    if (this.collected) return;
    this.collected = true;
    if (scene && this.mesh) {
      scene.remove(this.mesh);
    }
  }

  getMesh() {
    return this.mesh;
  }

  getGridPosition() {
    return this.gridPos;
  }
}
