import * as THREE from 'three';
import { CONFIG } from '../../core/config.js';
import { EVENTS } from '../../core/events.js';

export class MonsterDamage {
  constructor(manager) {
    this.manager = manager;
    this.pendingDeaths = [];
    this.deathEffects = [];
  }

  clear() {
    const scene = this.manager.scene;
    this.deathEffects.forEach(fx => scene.remove(fx.group));
    this.deathEffects = [];

    for (const entry of this.pendingDeaths) {
      if (entry?.sprite) scene.remove(entry.sprite);
    }
    this.pendingDeaths = [];
  }

  handleProjectileHit(monster, hitPosition = null, projectile = null) {
    if (!monster || monster.isDead || monster.isDying) return;

    const damage = Number.isFinite(projectile?.damage)
      ? projectile.damage
      : (CONFIG.PLAYER_BULLET_DAMAGE ?? 1);

    const stunSeconds = this.getMonsterHitStunSeconds(monster, projectile);
    this.applyDamageToMonster(monster, damage, {
      hitPosition,
      stunSeconds,
      cause: projectile?.owner || 'player'
    });
  }

  getMonsterHitStunSeconds(monster, projectile = null) {
    const fromProjectile = projectile?.stunSeconds;
    if (Number.isFinite(fromProjectile) && fromProjectile > 0) {
      return fromProjectile;
    }
    const fromType = monster?.typeConfig?.combat?.hitStunSeconds;
    if (Number.isFinite(fromType) && fromType > 0) {
      return fromType;
    }
    return CONFIG.MONSTER_HIT_STUN_SECONDS ?? 0.22;
  }

  ensureMonsterHealth(monster) {
    if (!monster) return;
    if (!Number.isFinite(monster.maxHealth) || monster.maxHealth <= 0) {
      monster.maxHealth = CONFIG.MONSTER_BASE_HEALTH ?? 10;
    }
    if (!Number.isFinite(monster.health)) {
      monster.health = monster.maxHealth;
    }
  }

  applyDamageToMonster(monster, damage, options = {}) {
    if (!monster || monster.isDead || monster.isDying) return;
    this.ensureMonsterHealth(monster);

    // Monster guard (simple defense mechanic)
    const guardEnabled = CONFIG.MONSTER_GUARD_ENABLED ?? true;
    if (guardEnabled) {
      const health = Math.max(0, Number(monster.health) || 0);
      const max = Math.max(1, Number(monster.maxHealth) || 1);
      const ratio = health / max;

      const canStartGuard = (monster.guardTimer || 0) <= 0 && (monster.guardCooldown || 0) <= 0;
      if (canStartGuard) {
        const chance = Math.max(0, Math.min(1, Number(CONFIG.MONSTER_GUARD_CHANCE) || 0));
        const threshold = Math.max(0, Math.min(1, Number(CONFIG.MONSTER_GUARD_MIN_HEALTH_RATIO) || 0.55));
        const bias = ratio <= threshold ? 1.0 : 0.6;
        if (Math.random() < chance * bias) {
          monster.guardTimer = Math.max(0.05, Number(CONFIG.MONSTER_GUARD_DURATION_SECONDS) || 0.7);
          monster.guardCooldown = Math.max(0.1, Number(CONFIG.MONSTER_GUARD_COOLDOWN_SECONDS) || 2.2);
          this.manager?.audioManager?.playMonsterGuard?.();
        }
      }
    }

    const now = performance.now() / 1000;
    monster.lastDamagedAt = now;
    monster.lastDamageCause = options.cause || monster.lastDamageCause || null;

    const stunSeconds = options.stunSeconds;
    if (Number.isFinite(stunSeconds) && stunSeconds > 0) {
      const guardMult = (CONFIG.MONSTER_GUARD_ENABLED ?? true) && (monster.guardTimer || 0) > 0 ? 0.5 : 1.0;
      monster.stunTimer = Math.max(monster.stunTimer || 0, stunSeconds * guardMult);
    }

    const baseAmount = Number.isFinite(damage) ? damage : 0;
    const guardDamageMult =
      (CONFIG.MONSTER_GUARD_ENABLED ?? true) && (monster.guardTimer || 0) > 0
        ? (Number(CONFIG.MONSTER_GUARD_DAMAGE_MULT) || 0.35)
        : 1.0;
    const amount = baseAmount * Math.max(0, guardDamageMult);
    if (amount > 0) {
      monster.health = Math.max(0, (monster.health || 0) - amount);
    }

    if ((monster.health || 0) <= 0) {
      this.beginMonsterDeath(monster, options.hitPosition || null);
    }
  }

  applyAreaDamage(centerPos, radius, damage, options = {}) {
    const manager = this.manager;
    if (!centerPos) return;
    const r = Number.isFinite(radius) ? radius : 0;
    if (r <= 0) return;

    const owner = options.owner || 'unknown';
    const excludeMonster = options.excludeMonster || null;
    const baseDamage = Number.isFinite(damage) ? damage : 0;
    const stunSeconds = Number.isFinite(options.stunSeconds) ? options.stunSeconds : null;

    const center = centerPos.clone ? centerPos.clone() : new THREE.Vector3(centerPos.x || 0, centerPos.y || 0, centerPos.z || 0);
    center.y = 0;

    for (const monster of manager.monsters) {
      if (!monster || monster.isDead || monster.isDying) continue;
      if (excludeMonster && monster === excludeMonster) continue;
      const pos = monster.getWorldPosition?.();
      if (!pos) continue;
      const dx = pos.x - center.x;
      const dz = pos.z - center.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > r) continue;

      const t = 1 - dist / r;
      const scaledDamage = baseDamage > 0 ? Math.max(0, Math.round(baseDamage * (0.35 + 0.65 * t))) : 0;
      const scaledStun = (stunSeconds && stunSeconds > 0) ? stunSeconds * (0.4 + 0.6 * t) : 0;

      if (scaledDamage <= 0 && scaledStun <= 0) continue;

      this.applyDamageToMonster(monster, scaledDamage, {
        hitPosition: centerPos,
        stunSeconds: scaledStun,
        cause: owner
      });
    }

    const shouldDamagePlayer = options.damagePlayer ?? (owner === 'monster');
    if (!shouldDamagePlayer) return;

    const playerPos = manager.playerRef?.getPosition ? manager.playerRef.getPosition() : null;
    const gs = manager.playerRef?.gameState || null;
    if (!playerPos || !gs?.takeDamage) return;

    const dx = playerPos.x - center.x;
    const dz = playerPos.z - center.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist > r) return;

    if (baseDamage <= 0) return;
    const t = 1 - dist / r;
    const scaled = Math.max(0, Math.round(baseDamage * (0.25 + 0.75 * t)));
    if (scaled > 0) {
      gs.takeDamage(scaled);
    }
  }

  beginMonsterDeath(monster, hitPosition = null) {
    const manager = this.manager;
    if (!monster || monster.isDead || monster.isDying) return;

    monster.isDying = true;
    monster.isMoving = false;
    monster.isSprinting = false;

    const brain = manager.brains.get(monster);
    if (brain?.setEnabled) {
      brain.setEnabled(false);
    } else if (brain) {
      brain.enabled = false;
    }

    const delay =
      monster.typeConfig?.combat?.deathDelay ??
      CONFIG.MONSTER_DEATH_DELAY ??
      0.35;

    const color = monster.typeConfig?.appearance?.emissiveColor || 0xff4444;

    const chargeMat = new THREE.SpriteMaterial({
      color,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.8,
      depthWrite: false
    });
    const sprite = new THREE.Sprite(chargeMat);
    sprite.scale.set(0.9, 0.9, 0.9);
    manager.scene.add(sprite);

    this.pendingDeaths.push({
      monster,
      timer: Math.max(0.05, delay),
      maxTimer: Math.max(0.05, delay),
      hitPosition: hitPosition ? hitPosition.clone() : null,
      sprite,
      color
    });
  }

  updatePendingDeaths(dt) {
    const manager = this.manager;
    for (let i = this.pendingDeaths.length - 1; i >= 0; i--) {
      const entry = this.pendingDeaths[i];
      const monster = entry.monster;
      if (!monster || monster.isDead) {
        if (entry.sprite) manager.scene.remove(entry.sprite);
        this.pendingDeaths.splice(i, 1);
        continue;
      }

      entry.timer -= dt;
      const progress = Math.max(0, entry.timer / entry.maxTimer);
      const pulse = 1 + (1 - progress) * 0.8;

      const pos = monster.getWorldPosition?.() || null;
      if (pos && entry.sprite) {
        const height =
          (CONFIG.MONSTER_BASE_HEIGHT ?? 1.6) *
          (monster.scale || monster.typeConfig?.stats?.scale || 1);
        entry.sprite.position.copy(pos);
        entry.sprite.position.y += Math.max(0.35, height * 0.75);
        entry.sprite.material.opacity = 0.25 + 0.55 * (1 - progress);
        entry.sprite.scale.setScalar(0.9 * pulse);
      }

      if (entry.timer <= 0) {
        const explodePos = entry.hitPosition || pos || null;
        if (explodePos) {
          if (manager.projectileManager?.spawnExplosion) {
            manager.projectileManager.spawnExplosion(explodePos, {
              color: entry.color,
              size: 1.3,
              intensity: 2.0
            });
          }

          const deathRadius =
            monster.typeConfig?.combat?.deathExplosionRadius ??
            CONFIG.MONSTER_DEATH_EXPLOSION_RADIUS ??
            0;
          const deathDamage =
            monster.typeConfig?.combat?.deathExplosionDamage ??
            CONFIG.MONSTER_DEATH_EXPLOSION_DAMAGE ??
            0;
          if (Number.isFinite(deathRadius) && deathRadius > 0 && Number.isFinite(deathDamage) && deathDamage > 0) {
            this.applyAreaDamage(explodePos, deathRadius, deathDamage, {
              owner: 'monster'
            });
          }
        }

        if (entry.sprite) manager.scene.remove(entry.sprite);
        this.pendingDeaths.splice(i, 1);

        monster.isDying = false;
        this.killMonster(monster, explodePos);
      }
    }
  }

  createFragmentEffect(monster, hitPosition = null) {
    const manager = this.manager;
    const pos = monster.getWorldPosition ? monster.getWorldPosition() : null;
    if (!pos) return;

    const pieceCount = 12;
    const group = new THREE.Group();
    const velocities = [];
    const color = monster.typeConfig?.appearance?.emissiveColor || 0xff4444;

    for (let i = 0; i < pieceCount; i++) {
      const geo = new THREE.BoxGeometry(0.25, 0.25, 0.25);
      const mat = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.4,
        transparent: true,
        opacity: 1,
        roughness: 0.6,
        metalness: 0.1
      });

      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(pos);
      mesh.position.x += (Math.random() - 0.5) * 0.6;
      mesh.position.y += (Math.random() - 0.2) * 0.6;
      mesh.position.z += (Math.random() - 0.5) * 0.6;
      group.add(mesh);

      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 6,
        Math.random() * 4 + 2,
        (Math.random() - 0.5) * 6
      );
      if (hitPosition) {
        const away = mesh.position.clone().sub(hitPosition).setY(0.3).normalize();
        vel.addScaledVector(away, 2);
      }
      velocities.push(vel);
    }

    manager.scene.add(group);
    this.deathEffects.push({
      group,
      velocities,
      life: 1.2,
      maxLife: 1.2
    });
  }

  updateDeathEffects(dt) {
    const manager = this.manager;
    for (let i = this.deathEffects.length - 1; i >= 0; i--) {
      const fx = this.deathEffects[i];
      fx.life -= dt;
      const progress = Math.max(0, fx.life / fx.maxLife);

      fx.group.children.forEach((mesh, index) => {
        const vel = fx.velocities[index];
        vel.y -= 9.8 * 0.4 * dt;
        mesh.position.addScaledVector(vel, dt);
        mesh.rotation.x += dt * 6;
        mesh.rotation.y += dt * 5;

        if (mesh.material) {
          mesh.material.opacity = progress;
        }
      });

      if (fx.life <= 0) {
        manager.scene.remove(fx.group);
        this.deathEffects.splice(i, 1);
      }
    }
  }

  killMonster(monster, hitPosition = null) {
    const manager = this.manager;
    const typeConfig = monster.typeConfig || null;
    const worldPosition = monster.getWorldPosition ? monster.getWorldPosition() : null;
    const gridPosition = monster.getGridPosition ? monster.getGridPosition() : (monster.gridPos || null);
    const cause = monster.lastDamageCause || null;
    const modelPath = monster.modelPath || null;
    const modelMeta = monster.modelMeta || null;

    this.createFragmentEffect(monster, hitPosition);

    monster.isDead = true;
    const model = monster.getModel?.();
    if (model) {
      manager.scene.remove(model);
    }

    const idx = manager.monsters.indexOf(monster);
    if (idx !== -1) {
      manager.monsters.splice(idx, 1);
    }
    manager.brains.delete(monster);

    manager.eventBus?.emit?.(EVENTS.MONSTER_KILLED, {
      monsterManager: manager,
      monster,
      typeConfig,
      worldPosition,
      gridPosition,
      hitPosition,
      cause,
      modelPath,
      modelMeta
    });

    // Drops: health + "heart" that can increase max health.
    try {
      const eb = manager.eventBus;
      if (eb?.emit && worldPosition) {
        const hpChance = Math.max(0, Math.min(1, Number(CONFIG.MONSTER_DROP_HEALTH_CHANCE) || 0));
        const bigChance = Math.max(0, Math.min(1, Number(CONFIG.MONSTER_DROP_HEALTH_BIG_CHANCE) || 0));
        const heartChance = Math.max(0, Math.min(1, Number(CONFIG.MONSTER_DROP_HEART_CHANCE) || 0));

        if (Math.random() < heartChance) {
          eb.emit(EVENTS.PICKUP_SPAWN_REQUESTED, {
            kind: 'monsterHeart',
            amount: Math.max(1, Math.round(Number(CONFIG.MONSTER_DROP_HEART_MAX_HEALTH_BONUS) || 2)),
            ttl: 25,
            position: worldPosition.clone()
          });
        }

        if (Math.random() < bigChance) {
          eb.emit(EVENTS.PICKUP_SPAWN_REQUESTED, {
            kind: 'healthBig',
            amount: Math.max(1, Math.round(Number(CONFIG.MONSTER_DROP_HEALTH_BIG_AMOUNT) || 30)),
            ttl: 18,
            position: worldPosition.clone()
          });
        } else if (Math.random() < hpChance) {
          eb.emit(EVENTS.PICKUP_SPAWN_REQUESTED, {
            kind: 'healthSmall',
            amount: Math.max(1, Math.round(Number(CONFIG.MONSTER_DROP_HEALTH_SMALL_AMOUNT) || 12)),
            ttl: 16,
            position: worldPosition.clone()
          });
        }
      }
    } catch (err) {
      void err;
    }

    manager.spawner?.queueRespawn?.(typeConfig);
  }
}
