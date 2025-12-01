import * as THREE from 'three';
import { CONFIG } from '../core/config.js';

/**
 * Simple hitscan-like gun that spawns fast bullets and muzzle flash.
 */
export class Gun {
  constructor(scene, camera, input, projectileManager, audioManager = null) {
    this.scene = scene;
    this.camera = camera;
    this.input = input;
    this.projectileManager = projectileManager;
    this.audioManager = audioManager;

    this.fireInterval = CONFIG.PLAYER_FIRE_INTERVAL ?? 0.08;
    this.cooldown = 0;

    this.muzzleFlashes = [];
  }

  update(deltaTime) {
    const dt = deltaTime ?? 0;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.updateMuzzleFlashes(dt);

    if (!this.input?.isFiring()) return;
    if (this.cooldown > 0) return;

    this.cooldown = this.fireInterval;
    this.fire();
  }

  fire() {
    const cam = this.camera?.getCamera ? this.camera.getCamera() : null;
    if (!cam || !this.projectileManager) return;

    // Aim direction
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    dir.normalize();

    // Origin slightly in front of camera to avoid intersecting the player
    const origin = cam.position.clone();
    origin.add(dir.clone().multiplyScalar(0.6));
    origin.y -= 0.05;

    this.projectileManager.spawnBullet(origin, dir);
    this.spawnMuzzleFlash(origin, dir);

    if (this.audioManager?.playGunshot) {
      this.audioManager.playGunshot();
    }
  }

  spawnMuzzleFlash(origin, direction) {
    const flash = new THREE.PointLight(0xffdd88, 2, 8, 2);
    flash.position.copy(origin);
    flash.position.addScaledVector(direction, 0.2);
    this.scene.add(flash);

    const spriteMat = new THREE.SpriteMaterial({
      color: 0xffeeaa,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.95,
      depthWrite: false
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.position.copy(flash.position);
    sprite.scale.set(0.6, 0.6, 0.6);
    this.scene.add(sprite);

    this.muzzleFlashes.push({
      light: flash,
      sprite,
      life: 0.08,
      maxLife: 0.08
    });
  }

  updateMuzzleFlashes(dt) {
    for (let i = this.muzzleFlashes.length - 1; i >= 0; i--) {
      const fx = this.muzzleFlashes[i];
      fx.life -= dt;
      const progress = Math.max(0, fx.life / fx.maxLife);
      if (fx.sprite) {
        fx.sprite.material.opacity = progress;
        fx.sprite.scale.setScalar(0.6 + (1 - progress) * 0.3);
      }
      if (fx.light) {
        fx.light.intensity = 2 * progress;
      }
      if (fx.life <= 0) {
        if (fx.light) this.scene.remove(fx.light);
        if (fx.sprite) this.scene.remove(fx.sprite);
        this.muzzleFlashes.splice(i, 1);
      }
    }
  }
}
