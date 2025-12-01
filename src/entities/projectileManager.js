import * as THREE from 'three';
import { CONFIG } from '../core/config.js';

/**
 * ProjectileManager
 * Handles bullets, simple impacts, and collision checks against monsters.
 */
export class ProjectileManager {
  constructor(scene, worldState, monsterManager) {
    this.scene = scene;
    this.worldState = worldState;
    this.monsterManager = monsterManager;

    this.bullets = [];
    this.impacts = [];

    this.bulletGeometry = new THREE.SphereGeometry(0.08, 10, 10);
    this.bulletMaterial = new THREE.MeshStandardMaterial({
      color: 0xffee88,
      emissive: 0xffcc55,
      emissiveIntensity: 0.9,
      transparent: true,
      opacity: 0.95,
      roughness: 0.3,
      metalness: 0.1
    });

    this.hitRadius = CONFIG.MONSTER_HIT_RADIUS ?? 1.0;
    this.bulletSpeed = CONFIG.PLAYER_BULLET_SPEED ?? 42;
    this.bulletLifetime = CONFIG.PLAYER_BULLET_LIFETIME ?? 2.2;
  }

  /**
   * Spawn a bullet traveling from origin along direction.
   * @param {THREE.Vector3} origin
   * @param {THREE.Vector3} direction - normalized
   */
  spawnBullet(origin, direction) {
    if (!origin || !direction) return;

    const mesh = new THREE.Mesh(this.bulletGeometry, this.bulletMaterial.clone());
    mesh.position.copy(origin);
    mesh.scale.setScalar(1.2);
    this.scene.add(mesh);

    const velocity = direction.clone().normalize().multiplyScalar(this.bulletSpeed);
    this.bullets.push({
      mesh,
      velocity,
      life: this.bulletLifetime
    });
  }

  update(deltaTime) {
    const dt = deltaTime ?? 0;
    if (dt <= 0) return;

    this.updateBullets(dt);
    this.updateImpacts(dt);
  }

  reset() {
    this.bullets.forEach(b => this.scene.remove(b.mesh));
    this.impacts.forEach(fx => this.scene.remove(fx.sprite));
    this.bullets = [];
    this.impacts = [];
  }

  updateBullets(dt) {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const bullet = this.bullets[i];
      bullet.life -= dt;

      if (bullet.life <= 0) {
        this.cleanupBullet(i);
        continue;
      }

      bullet.mesh.position.addScaledVector(bullet.velocity, dt);

      if (this.hitWall(bullet.mesh.position)) {
        this.spawnImpact(bullet.mesh.position);
        this.cleanupBullet(i);
        continue;
      }

      const hit = this.findHitMonster(bullet.mesh.position);
      if (hit) {
        this.spawnImpact(bullet.mesh.position);
        if (this.monsterManager?.handleProjectileHit) {
          this.monsterManager.handleProjectileHit(hit, bullet.mesh.position);
        }
        this.cleanupBullet(i);
      }
    }
  }

  updateImpacts(dt) {
    for (let i = this.impacts.length - 1; i >= 0; i--) {
      const fx = this.impacts[i];
      fx.life -= dt;
      const progress = Math.max(0, fx.life / fx.maxLife);
      fx.sprite.material.opacity = progress;
      fx.sprite.scale.setScalar(0.6 + (1 - progress) * 0.6);

      if (fx.life <= 0) {
        this.scene.remove(fx.sprite);
        this.impacts.splice(i, 1);
      }
    }
  }

  hitWall(pos) {
    if (!this.worldState || !this.worldState.isWalkable) return false;
    const tileSize = CONFIG.TILE_SIZE || 1;
    const gx = Math.floor(pos.x / tileSize);
    const gy = Math.floor(pos.z / tileSize);
    return !this.worldState.isWalkable(gx, gy);
  }

  findHitMonster(position) {
    if (!this.monsterManager || !this.monsterManager.getMonsters) return null;
    const monsters = this.monsterManager.getMonsters();
    for (const m of monsters) {
      const mPos = m.getWorldPosition ? m.getWorldPosition() : null;
      if (!mPos) continue;
      const dist = mPos.distanceTo(position);
      if (dist <= this.hitRadius) {
        return m;
      }
    }
    return null;
  }

  cleanupBullet(index) {
    const bullet = this.bullets[index];
    if (bullet?.mesh) {
      this.scene.remove(bullet.mesh);
    }
    this.bullets.splice(index, 1);
  }

  spawnImpact(position) {
    if (!position) return;
    const material = new THREE.SpriteMaterial({
      color: 0xffddaa,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 1,
      depthWrite: false
    });
    const sprite = new THREE.Sprite(material);
    sprite.position.copy(position);
    sprite.position.y += 0.3;
    sprite.scale.set(0.8, 0.8, 0.8);
    this.scene.add(sprite);

    this.impacts.push({
      sprite,
      life: 0.25,
      maxLife: 0.25
    });
  }
}
