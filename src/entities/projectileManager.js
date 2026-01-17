import * as THREE from 'three';
import { CONFIG } from '../core/config.js';
import { EVENTS } from '../core/events.js';

const MAX_POOLED_PROJECTILES = {
  bullet: 96,
  grenade: 32,
  bolt: 64
};
const MAX_POOLED_IMPACTS = 64;
const MAX_POOLED_EXPLOSIONS = 32;
const BULLET_BASE_AXIS = new THREE.Vector3(0, 1, 0);

/**
 * ProjectileManager
 * Handles projectiles (player + monsters), simple impacts, and collision checks.
 */
export class ProjectileManager {
  constructor(scene, worldState, monsterManager, playerRef = null, eventBus = null) {
    this.scene = scene;
    this.worldState = worldState;
    this.monsterManager = monsterManager;
    this.playerRef = playerRef;
    this.eventBus = eventBus;

    this.projectiles = [];
    this.impacts = [];
    this.explosions = [];
    this.activeCounts = { player: 0, monster: 0 };

    this.projectilePools = {
      bullet: [],
      grenade: [],
      bolt: []
    };
    this.impactPool = [];
    this.explosionPool = [];

    this.playerBulletGeometry = new THREE.CylinderGeometry(0.028, 0.028, 0.28, 10);
    this.playerBulletMaterial = new THREE.MeshStandardMaterial({
      color: 0xffee88,
      emissive: 0xffcc55,
      emissiveIntensity: 0.85,
      transparent: true,
      opacity: 0.95,
      roughness: 0.35,
      metalness: 0.15
    });

    this.playerGrenadeGeometry = new THREE.SphereGeometry(0.14, 12, 10);
    this.playerGrenadeMaterial = new THREE.MeshStandardMaterial({
      color: 0x66ff99,
      emissive: 0x22aa66,
      emissiveIntensity: 0.55,
      transparent: true,
      opacity: 0.95,
      roughness: 0.45,
      metalness: 0.1
    });

    this.monsterBoltGeometry = new THREE.IcosahedronGeometry(0.12, 0);
    this.monsterBoltMaterial = new THREE.MeshStandardMaterial({
      color: 0x77ccff,
      emissive: 0x66aaff,
      emissiveIntensity: 1.0,
      transparent: true,
      opacity: 0.92,
      roughness: 0.25,
      metalness: 0.05
    });

    this.hitRadius = CONFIG.MONSTER_HIT_RADIUS ?? 1.0;
    this.bulletSpeed = CONFIG.PLAYER_BULLET_SPEED ?? 42;
    this.bulletLifetime = CONFIG.PLAYER_BULLET_LIFETIME ?? 2.2;

    this.monsterProjectileSpeed = CONFIG.MONSTER_PROJECTILE_SPEED ?? 22;
    this.monsterProjectileLifetime = CONFIG.MONSTER_PROJECTILE_LIFETIME ?? 3.0;
    this.monsterProjectileDamage = CONFIG.MONSTER_PROJECTILE_DAMAGE ?? 8;

    this.playerHitRadius = CONFIG.PLAYER_PROJECTILE_HIT_RADIUS ?? (CONFIG.PLAYER_RADIUS ?? 0.35) * 1.1;

    // Event hooks (optional)
    this.onPlayerHitMonster = null;
    this.onMonsterHitPlayer = null;

    // Optional extra hittables (e.g. world devices)
    this.extraHittablesProvider = null; // () => Array<{ kind, position, radius, ref }>
  }

  canSpawnProjectile(owner) {
    const maxTotal = CONFIG.MAX_ACTIVE_PROJECTILES;
    if (Number.isFinite(maxTotal) && maxTotal >= 0 && this.projectiles.length >= maxTotal) {
      return false;
    }

    const maxPlayer = CONFIG.MAX_ACTIVE_PLAYER_PROJECTILES;
    const maxMonster = CONFIG.MAX_ACTIVE_MONSTER_PROJECTILES;
    if (owner === 'player' && Number.isFinite(maxPlayer) && maxPlayer >= 0) {
      const count = this.activeCounts?.player ?? 0;
      if (count >= maxPlayer) return false;
    }
    if (owner === 'monster' && Number.isFinite(maxMonster) && maxMonster >= 0) {
      const count = this.activeCounts?.monster ?? 0;
      if (count >= maxMonster) return false;
    }

    return true;
  }

  getProjectilePoolKey(owner, kind) {
    if (owner === 'monster') return 'bolt';
    const lowerKind = String(kind || '').toLowerCase();
    const isGrenade = lowerKind.includes('grenade') || lowerKind.includes('rocket') || lowerKind.includes('bomb');
    return isGrenade ? 'grenade' : 'bullet';
  }

  createPooledProjectile(poolKey) {
    let mesh = null;
    let spin = null;

    if (poolKey === 'bolt') {
      mesh = new THREE.Mesh(this.monsterBoltGeometry, this.monsterBoltMaterial.clone());
      spin = new THREE.Vector3();
    } else if (poolKey === 'grenade') {
      mesh = new THREE.Mesh(this.playerGrenadeGeometry, this.playerGrenadeMaterial.clone());
    } else {
      mesh = new THREE.Mesh(this.playerBulletGeometry, this.playerBulletMaterial.clone());
    }

    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.visible = false;

    return {
      poolKey,
      mesh,
      velocity: new THREE.Vector3(),
      spin,
      hitMonsters: new Set()
    };
  }

  releaseProjectile(projectile) {
    if (!projectile) return;
    if (projectile.mesh) {
      this.scene.remove(projectile.mesh);
      projectile.mesh.visible = false;
      projectile.mesh.rotation.set(0, 0, 0);
    }

    projectile.velocity?.set?.(0, 0, 0);
    projectile.hitMonsters?.clear?.();
    projectile.sourceMonster = null;
    projectile.remainingPierce = 0;

    const poolKey = projectile.poolKey || 'bullet';
    const pool = this.projectilePools?.[poolKey] || null;
    const limit = MAX_POOLED_PROJECTILES[poolKey] ?? 0;
    if (pool && pool.length < limit) {
      pool.push(projectile);
    }
  }

  createPooledImpact() {
    const material = new THREE.SpriteMaterial({
      color: 0xffffff,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 1,
      depthWrite: false
    });
    const sprite = new THREE.Sprite(material);
    sprite.visible = false;
    return { sprite, life: 0, maxLife: 0 };
  }

  releaseImpact(fx) {
    if (!fx?.sprite) return;
    this.scene.remove(fx.sprite);
    fx.sprite.visible = false;
    if (this.impactPool.length < MAX_POOLED_IMPACTS) {
      this.impactPool.push(fx);
    }
  }

  createPooledExplosion() {
    const group = new THREE.Group();

    const coreMat = new THREE.SpriteMaterial({
      color: 0xffffff,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.95,
      depthWrite: false
    });
    const core = new THREE.Sprite(coreMat);
    core.position.set(0, 0.2, 0);
    group.add(core);

    const ringMat = new THREE.SpriteMaterial({
      color: 0xffffff,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.6,
      depthWrite: false
    });
    const ring = new THREE.Sprite(ringMat);
    ring.position.set(0, 0.25, 0);
    group.add(ring);

    group.visible = false;

    const light = new THREE.PointLight(0xffffff, 1, 8, 2);
    light.visible = false;

    return {
      group,
      light,
      core,
      ring,
      maxIntensity: 1,
      life: 0,
      maxLife: 0
    };
  }

  releaseExplosion(fx) {
    if (!fx) return;
    if (fx.group) {
      this.scene.remove(fx.group);
      fx.group.visible = false;
    }
    if (fx.light) {
      this.scene.remove(fx.light);
      fx.light.visible = false;
    }
    if (this.explosionPool.length < MAX_POOLED_EXPLOSIONS) {
      this.explosionPool.push(fx);
    }
  }

  /**
   * Spawn a bullet traveling from origin along direction.
   * @param {THREE.Vector3} origin
   * @param {THREE.Vector3} direction - normalized
   */
  spawnBullet(origin, direction) {
    return this.spawnProjectile({
      origin,
      direction,
      owner: 'player',
      kind: 'bullet',
      speed: this.bulletSpeed,
      lifetime: this.bulletLifetime,
      damage: CONFIG.PLAYER_BULLET_DAMAGE ?? 1,
      canHitMonsters: true,
      canHitPlayer: false
    });
  }

  /**
   * Spawn a configurable player projectile (supports explosive/piercing/etc).
   * @param {THREE.Vector3} origin
   * @param {THREE.Vector3} direction - normalized
   * @param {Object} options
   */
  spawnPlayerProjectile(origin, direction, options = {}) {
    const speed = options.speed ?? this.bulletSpeed;
    const lifetime = options.lifetime ?? this.bulletLifetime;
    const damage = options.damage ?? (CONFIG.PLAYER_BULLET_DAMAGE ?? 1);
    const kind = options.kind ?? 'bullet';

    return this.spawnProjectile({
      origin,
      direction,
      owner: 'player',
      kind,
      speed,
      lifetime,
      damage,
      color: options.color,
      canHitMonsters: options.canHitMonsters ?? true,
      canHitPlayer: options.canHitPlayer ?? false,
      hitRadius: options.hitRadius,
      stunSeconds: options.stunSeconds,
      explosionRadius: options.explosionRadius,
      explosionDamage: options.explosionDamage,
      explosionColor: options.explosionColor,
      pierce: options.pierce
    });
  }

  /**
   * Spawn a monster projectile traveling from origin along direction.
   * @param {THREE.Vector3} origin
   * @param {THREE.Vector3} direction - normalized
   * @param {Object} options
   */
  spawnMonsterProjectile(origin, direction, options = {}) {
    const speed = options.speed ?? this.monsterProjectileSpeed;
    const lifetime = options.lifetime ?? this.monsterProjectileLifetime;
    const damage = options.damage ?? this.monsterProjectileDamage;
    const color = options.color ?? 0x77ccff;

    return this.spawnProjectile({
      origin,
      direction,
      owner: 'monster',
      kind: options.kind ?? 'bolt',
      speed,
      lifetime,
      damage,
      color,
      canHitMonsters: false,
      canHitPlayer: true,
      sourceMonster: options.sourceMonster || null
    });
  }

  setPlayerRef(playerRef) {
    this.playerRef = playerRef;
  }

  setEventBus(eventBus) {
    this.eventBus = eventBus;
  }

  setOnPlayerHitMonster(callback) {
    this.onPlayerHitMonster = typeof callback === 'function' ? callback : null;
  }

  setOnMonsterHitPlayer(callback) {
    this.onMonsterHitPlayer = typeof callback === 'function' ? callback : null;
  }

  setExtraHittablesProvider(provider) {
    this.extraHittablesProvider = typeof provider === 'function' ? provider : null;
  }

  registerNoise(position, options = {}) {
    if (!position) return;

    const entry = this.monsterManager?.registerNoise
      ? this.monsterManager.registerNoise(position, options)
      : null;

    if (this.eventBus?.emit) {
      if (entry) {
        this.eventBus.emit(EVENTS.NOISE_EMITTED, entry);
      } else {
        const tileSize = CONFIG.TILE_SIZE || 1;
        const x = Number.isFinite(position.x) ? position.x : 0;
        const z = Number.isFinite(position.z) ? position.z : 0;
        const grid = { x: Math.floor(x / tileSize), y: Math.floor(z / tileSize) };

        const kind = options.kind || 'noise';
        const radius = Number.isFinite(options.radius) ? options.radius : 8;
        const ttl = Number.isFinite(options.ttl) ? options.ttl : 0.8;

        this.eventBus.emit(EVENTS.NOISE_EMITTED, {
          kind,
          radius,
          life: ttl,
          maxLife: ttl,
          grid,
          world: new THREE.Vector3(x, Number.isFinite(position.y) ? position.y : 0, z),
          strength: Number.isFinite(options.strength) ? options.strength : 1.0,
          source: options.source || null
        });
      }
    }
  }

  update(deltaTime) {
    const dt = deltaTime ?? 0;
    if (dt <= 0) return;

    this.updateProjectiles(dt);
    this.updateImpacts(dt);
    this.updateExplosions(dt);
  }

  reset() {
    this.projectiles.forEach(p => this.releaseProjectile(p));
    this.impacts.forEach(fx => this.releaseImpact(fx));
    this.explosions.forEach(fx => this.releaseExplosion(fx));
    this.projectiles = [];
    this.impacts = [];
    this.explosions = [];
    this.activeCounts = { player: 0, monster: 0 };
  }

  updateProjectiles(dt) {
    const tileSize = CONFIG.TILE_SIZE || 1;
    const farTiles = CONFIG.PROJECTILE_FAR_DISTANCE_TILES ?? 0;
    const farWorld = Number.isFinite(farTiles) && farTiles > 0 ? farTiles * tileSize : 0;
    const farSq = farWorld > 0 ? farWorld * farWorld : 0;
    const farTickSeconds = Math.max(0.016, CONFIG.PROJECTILE_FAR_TICK_SECONDS ?? 0.06);
    const playerPos = this.playerRef?.getPosition ? this.playerRef.getPosition() : null;

    const tmpStart = new THREE.Vector3();
    const tmpEnd = new THREE.Vector3();

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;

      if (p.life <= 0) {
        this.cleanupProjectile(i);
        continue;
      }

      let stepDt = dt;
      if (playerPos && farSq > 0) {
        const dx = p.mesh.position.x - playerPos.x;
        const dz = p.mesh.position.z - playerPos.z;
        const distSq = dx * dx + dz * dz;
        if (distSq > farSq) {
          p.lodAccumulator = (p.lodAccumulator || 0) + dt;
          if ((p.lodAccumulator || 0) < farTickSeconds) {
            continue;
          }
          stepDt = p.lodAccumulator || dt;
          p.lodAccumulator = 0;
        } else {
          p.lodAccumulator = 0;
        }
      } else if (p.lodAccumulator) {
        p.lodAccumulator = 0;
      }

      tmpStart.copy(p.mesh.position);
      tmpEnd.copy(tmpStart).addScaledVector(p.velocity, stepDt);
      const segLen = tmpStart.distanceTo(tmpEnd);

      // If dt is tiny, just move.
      if (segLen <= 1e-6) {
        p.mesh.position.copy(tmpEnd);
        continue;
      }

      const wallHit = this.sweepWall(tmpStart, tmpEnd);
      let monsterHit = p.canHitMonsters ? this.sweepMonsters(tmpStart, tmpEnd, p.hitRadius ?? this.hitRadius) : null;
      if (monsterHit && p.hitMonsters && p.hitMonsters.has(monsterHit.target)) {
        monsterHit = null;
      }
      const playerHit = p.canHitPlayer ? this.sweepPlayer(tmpStart, tmpEnd, p.playerHitRadius ?? this.playerHitRadius) : null;
      const deviceHit = this.sweepExtraHittables(tmpStart, tmpEnd);

      let hitType = null;
      let hitResult = null;

      if (wallHit) {
        hitType = 'wall';
        hitResult = wallHit;
      }
      if (monsterHit && (!hitResult || monsterHit.t < hitResult.t)) {
        hitType = 'monster';
        hitResult = monsterHit;
      }
      if (playerHit && (!hitResult || playerHit.t < hitResult.t)) {
        hitType = 'player';
        hitResult = playerHit;
      }
      if (deviceHit && (!hitResult || deviceHit.t < hitResult.t)) {
        hitType = 'device';
        hitResult = deviceHit;
      }

      if (hitResult) {
        const hitPos = hitResult.point || tmpEnd;
        p.mesh.position.copy(hitPos);

        if (hitType === 'wall') {
          if (this.eventBus) {
            this.eventBus.emit(EVENTS.PROJECTILE_HIT_WALL, {
              hitPosition: hitPos.clone(),
              projectile: p
            });
          }
        } else if (hitType === 'monster') {
          const monster = hitResult.target;
          if (p.owner === 'player' && this.eventBus) {
            this.eventBus.emit(EVENTS.PLAYER_HIT_MONSTER, {
              monster,
              hitPosition: hitPos.clone(),
              projectile: p
            });
          }
          if (p.owner === 'player' && this.onPlayerHitMonster) {
            try {
              this.onPlayerHitMonster({ monster, hitPosition: hitPos.clone(), projectile: p });
            } catch (err) {
              console.warn('⚠️ onPlayerHitMonster callback failed:', err?.message || err);
            }
          }
          if (p.hitMonsters && monster) {
            p.hitMonsters.add(monster);
          }
          if (p.explosionRadius && p.explosionRadius > 0) {
            // Explosion handled by combat system.
          }
        } else if (hitType === 'player') {
          if (p.owner === 'monster' && this.eventBus) {
            this.eventBus.emit(EVENTS.MONSTER_HIT_PLAYER, {
              hitPosition: hitPos.clone(),
              projectile: p,
              damage: p?.damage ?? this.monsterProjectileDamage
            });
          }
          if (p.owner === 'monster' && this.onMonsterHitPlayer) {
            try {
              this.onMonsterHitPlayer({ hitPosition: hitPos.clone(), projectile: p });
            } catch (err) {
              console.warn('⚠️ onMonsterHitPlayer callback failed:', err?.message || err);
            }
          }
          if (p.explosionRadius && p.explosionRadius > 0) {
            // Explosion handled by combat system.
          }
        } else if (hitType === 'device') {
          const device = hitResult.target;
          if (this.eventBus) {
            this.eventBus.emit(EVENTS.PROJECTILE_HIT_DEVICE, {
              device,
              hitPosition: hitPos.clone(),
              projectile: p
            });
          }
        }

        if (hitType === 'monster' && p.remainingPierce > 0) {
          p.remainingPierce -= 1;
          const n = p.velocity.clone().normalize();
          p.mesh.position.addScaledVector(n, 0.25);
          continue;
        }

        this.cleanupProjectile(i);
        continue;
      }

      // No hit: apply movement
      p.mesh.position.copy(tmpEnd);
      if (p.spin) {
        p.mesh.rotation.x += p.spin.x * stepDt;
        p.mesh.rotation.y += p.spin.y * stepDt;
        p.mesh.rotation.z += p.spin.z * stepDt;
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
        this.impacts.splice(i, 1);
        this.releaseImpact(fx);
      }
    }
  }

  updateExplosions(dt) {
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const fx = this.explosions[i];
      fx.life -= dt;
      const progress = Math.max(0, fx.life / fx.maxLife);
      const inv = 1 - progress;

      if (fx.group) {
        fx.group.children.forEach((obj) => {
          if (!obj?.material) return;
          obj.material.opacity = progress;
          obj.scale.setScalar(1 + inv * 1.8);
        });
      }
      if (fx.light) {
        fx.light.intensity = fx.maxIntensity * progress;
      }
      if (fx.life <= 0) {
        this.explosions.splice(i, 1);
        this.releaseExplosion(fx);
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

  getMonsterHitCenter(monster) {
    const base = monster?.getWorldPosition ? monster.getWorldPosition() : null;
    if (!base) return null;
    const height =
      (CONFIG.MONSTER_BASE_HEIGHT ?? 1.6) *
      (monster?.scale || monster?.typeConfig?.stats?.scale || 1);
    const center = base.clone();
    center.y += Math.max(0.2, height * 0.55);
    return center;
  }

  getPlayerHitCenter() {
    const pos = this.playerRef?.getPosition ? this.playerRef.getPosition() : null;
    if (!pos) return null;
    const center = pos.clone();
    center.y -= (CONFIG.PLAYER_HEIGHT ?? 1.7) * 0.35;
    return center;
  }

  cleanupProjectile(index) {
    const projectile = this.projectiles[index];
    this.projectiles.splice(index, 1);
    if (projectile?.owner) {
      const key = projectile.owner;
      const cur = this.activeCounts?.[key] ?? 0;
      if (this.activeCounts) {
        this.activeCounts[key] = Math.max(0, cur - 1);
      }
    }
    this.releaseProjectile(projectile);
  }

  spawnProjectile(options) {
    const origin = options?.origin;
    const direction = options?.direction;
    if (!origin || !direction) return false;

    const dir = direction.clone().normalize();
    const owner = options.owner || 'player';

    if (!this.canSpawnProjectile(owner)) return false;

    const kind = options.kind || 'bullet';
    const speed = Number.isFinite(options.speed) ? options.speed : 20;
    const lifetime = Number.isFinite(options.lifetime) ? options.lifetime : 2.0;

    const poolKey = this.getProjectilePoolKey(owner, kind);
    const pool = this.projectilePools[poolKey] || [];
    const projectile = pool.length > 0 ? pool.pop() : this.createPooledProjectile(poolKey);
    const mesh = projectile.mesh;

    if (!mesh) return false;

    if (poolKey === 'bolt') {
      const color = options.color ?? 0x77ccff;
      mesh.material.color.setHex(color);
      mesh.material.emissive.setHex(color);
      mesh.scale.setScalar(1.0);
      mesh.quaternion.identity();
      projectile.spin.set((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 2);
    } else if (poolKey === 'grenade') {
      if (options.color) {
        mesh.material.color.setHex(options.color);
        mesh.material.emissive.setHex(options.color);
      } else {
        mesh.material.color.copy(this.playerGrenadeMaterial.color);
        mesh.material.emissive.copy(this.playerGrenadeMaterial.emissive);
      }
      mesh.scale.setScalar(1.0);
      mesh.quaternion.identity();
      projectile.spin = null;
    } else {
      const color = options.color ?? this.playerBulletMaterial.color.getHex();
      mesh.material.color.setHex(color);
      mesh.material.emissive.setHex(options.color ?? this.playerBulletMaterial.emissive.getHex());
      // Cylinder is Y-up; align to direction
      mesh.quaternion.setFromUnitVectors(BULLET_BASE_AXIS, dir);
      mesh.scale.set(1.15, 1.15, 1.15);
      projectile.spin = null;
    }

    mesh.position.copy(origin);
    mesh.visible = true;
    this.scene.add(mesh);

    projectile.velocity.copy(dir).multiplyScalar(speed);

    const pierce = Number.isFinite(options.pierce) ? Math.max(0, options.pierce) : 0;
    projectile.life = lifetime;
    projectile.maxLife = lifetime;
    projectile.owner = owner;
    projectile.kind = kind;
    projectile.damage = options.damage ?? 1;
    projectile.stunSeconds = options.stunSeconds;
    projectile.canHitMonsters = !!options.canHitMonsters;
    projectile.canHitPlayer = !!options.canHitPlayer;
    projectile.hitRadius = options.hitRadius;
    projectile.playerHitRadius = options.playerHitRadius;
    projectile.sourceMonster = options.sourceMonster || null;
    projectile.explosionRadius = options.explosionRadius;
    projectile.explosionDamage = options.explosionDamage;
    projectile.explosionColor = options.explosionColor;
    projectile.remainingPierce = pierce;
    projectile.hitMonsters.clear();

    this.projectiles.push(projectile);
    if (this.activeCounts) {
      if (owner === 'player') this.activeCounts.player = (this.activeCounts.player ?? 0) + 1;
      else if (owner === 'monster') this.activeCounts.monster = (this.activeCounts.monster ?? 0) + 1;
    }
    return true;
  }

  segmentSphereHit(start, end, center, radius) {
    if (!start || !end || !center) return null;
    const r = Number.isFinite(radius) ? radius : 1.0;
    const d = end.clone().sub(start);
    const f = start.clone().sub(center);
    const a = d.dot(d);
    if (a <= 1e-9) {
      const dist = start.distanceTo(center);
      if (dist <= r) return { t: 0, point: start.clone() };
      return null;
    }
    const b = 2 * f.dot(d);
    const c = f.dot(f) - r * r;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const sqrt = Math.sqrt(disc);
    const inv2a = 1 / (2 * a);
    const t1 = (-b - sqrt) * inv2a;
    const t2 = (-b + sqrt) * inv2a;

    let t = null;
    if (t1 >= 0 && t1 <= 1) t = t1;
    else if (t2 >= 0 && t2 <= 1) t = t2;
    if (t === null) return null;

    const point = start.clone().addScaledVector(d, t);
    return { t, point };
  }

  sweepWall(start, end) {
    if (!this.worldState || !this.worldState.isWalkable) return null;
    const tileSize = CONFIG.TILE_SIZE || 1;

    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (!Number.isFinite(len) || len <= 1e-6) return null;

    const dirX = dx / len;
    const dirZ = dz / len;

    let gx = Math.floor(start.x / tileSize);
    let gy = Math.floor(start.z / tileSize);

    if (!this.worldState.isWalkable(gx, gy)) {
      return { t: 0, point: start.clone() };
    }

    const stepX = dirX > 0 ? 1 : dirX < 0 ? -1 : 0;
    const stepY = dirZ > 0 ? 1 : dirZ < 0 ? -1 : 0;

    const nextBoundaryX = stepX > 0
      ? (gx + 1) * tileSize
      : gx * tileSize;
    const nextBoundaryZ = stepY > 0
      ? (gy + 1) * tileSize
      : gy * tileSize;

    let tMaxX = stepX === 0 ? Infinity : (nextBoundaryX - start.x) / dirX;
    let tMaxZ = stepY === 0 ? Infinity : (nextBoundaryZ - start.z) / dirZ;
    const tDeltaX = stepX === 0 ? Infinity : tileSize / Math.abs(dirX);
    const tDeltaZ = stepY === 0 ? Infinity : tileSize / Math.abs(dirZ);

    let t = 0;
    while (t <= len) {
      if (tMaxX < tMaxZ) {
        gx += stepX;
        t = tMaxX;
        tMaxX += tDeltaX;
      } else {
        gy += stepY;
        t = tMaxZ;
        tMaxZ += tDeltaZ;
      }

      const isWalkable = this.worldState.isWalkable(gx, gy);
      if (!isWalkable) {
        const clamped = Math.max(0, Math.min(len, t));
        const point = start.clone().add(new THREE.Vector3(dirX, 0, dirZ).multiplyScalar(clamped));
        const tn = len > 0 ? clamped / len : 0;
        return { t: tn, point };
      }
    }

    return null;
  }

  sweepMonsters(start, end, radius) {
    if (!this.monsterManager || !this.monsterManager.getMonsters) return null;
    const monsters = this.monsterManager.getMonsters();

    let best = null;
    for (const monster of monsters) {
      if (!monster) continue;
      const center = this.getMonsterHitCenter(monster);
      if (!center) continue;
      const monsterRadius =
        monster?.hitRadius ??
        monster?.typeConfig?.stats?.hitRadius ??
        null;
      const effectiveRadius = Number.isFinite(monsterRadius)
        ? Math.max(radius, monsterRadius)
        : radius;
      const res = this.segmentSphereHit(start, end, center, effectiveRadius);
      if (!res) continue;
      if (!best || res.t < best.t) {
        best = { ...res, target: monster };
      }
    }
    return best;
  }

  sweepPlayer(start, end, radius) {
    const center = this.getPlayerHitCenter();
    if (!center) return null;
    const res = this.segmentSphereHit(start, end, center, radius);
    if (!res) return null;
    return { ...res, target: 'player' };
  }

  sweepExtraHittables(start, end) {
    const provider = this.extraHittablesProvider;
    if (!provider) return null;

    let list = null;
    try {
      list = provider();
    } catch {
      return null;
    }
    if (!Array.isArray(list) || list.length === 0) return null;

    let best = null;
    for (const h of list) {
      const center = h?.position || null;
      if (!center) continue;
      const r = Number.isFinite(h?.radius) ? h.radius : 0.5;
      const res = this.segmentSphereHit(start, end, center, r);
      if (!res) continue;
      if (!best || res.t < best.t) {
        best = { ...res, target: h?.ref || h, kind: h?.kind || 'unknown' };
      }
    }
    return best;
  }

  spawnImpact(position, projectile = null) {
    if (!position) return;
    const maxImpacts = CONFIG.MAX_ACTIVE_IMPACTS;
    if (Number.isFinite(maxImpacts) && maxImpacts >= 0 && this.impacts.length >= maxImpacts) {
      return;
    }

    const fxTiles = CONFIG.FX_RENDER_DISTANCE_TILES ?? 0;
    const tileSize = CONFIG.TILE_SIZE || 1;
    const fxWorld = Number.isFinite(fxTiles) && fxTiles > 0 ? fxTiles * tileSize : 0;
    if (fxWorld > 0) {
      const playerPos = this.playerRef?.getPosition ? this.playerRef.getPosition() : null;
      if (playerPos) {
        const dx = position.x - playerPos.x;
        const dz = position.z - playerPos.z;
        if ((dx * dx + dz * dz) > fxWorld * fxWorld) {
          return;
        }
      }
    }

    const owner = projectile?.owner || 'player';
    const color = owner === 'monster' ? 0x88ccff : 0xffddaa;

    const fx = this.impactPool.length > 0 ? this.impactPool.pop() : this.createPooledImpact();
    fx.life = 0.25;
    fx.maxLife = 0.25;
    fx.sprite.material.color.setHex(color);
    fx.sprite.material.opacity = 1;
    fx.sprite.position.copy(position);
    fx.sprite.position.y += 0.3;
    fx.sprite.scale.set(0.9, 0.9, 0.9);
    fx.sprite.visible = true;
    this.scene.add(fx.sprite);

    this.impacts.push(fx);
  }

  spawnExplosion(position, options = {}) {
    if (!position) return;
    const maxExplosions = CONFIG.MAX_ACTIVE_EXPLOSIONS;
    if (Number.isFinite(maxExplosions) && maxExplosions >= 0 && this.explosions.length >= maxExplosions) {
      return;
    }

    const fxTiles = CONFIG.FX_RENDER_DISTANCE_TILES ?? 0;
    const tileSize = CONFIG.TILE_SIZE || 1;
    const fxWorld = Number.isFinite(fxTiles) && fxTiles > 0 ? fxTiles * tileSize : 0;
    if (fxWorld > 0) {
      const playerPos = this.playerRef?.getPosition ? this.playerRef.getPosition() : null;
      if (playerPos) {
        const dx = position.x - playerPos.x;
        const dz = position.z - playerPos.z;
        if ((dx * dx + dz * dz) > fxWorld * fxWorld) {
          return;
        }
      }
    }

    const color = options.color ?? 0xffaa55;
    const size = options.size ?? 1.2;
    const intensity = options.intensity ?? 1.6;

    const fx = this.explosionPool.length > 0 ? this.explosionPool.pop() : this.createPooledExplosion();

    fx.group.position.copy(position);
    fx.group.visible = true;
    fx.group.children.forEach((obj) => {
      if (!obj?.material) return;
      obj.material.color.setHex(color);
      obj.material.opacity = obj === fx.core ? 0.95 : 0.6;
    });
    fx.core.scale.set(size, size, size);
    fx.ring.scale.set(size * 1.4, size * 1.4, size * 1.4);

    fx.light.color.setHex(color);
    fx.light.intensity = intensity;
    fx.light.position.copy(position);
    fx.light.position.y += 0.6;
    fx.light.visible = true;

    this.scene.add(fx.group);
    this.scene.add(fx.light);

    fx.maxIntensity = intensity;
    fx.life = 0.35;
    fx.maxLife = 0.35;

    this.explosions.push(fx);
  }
}
