import { EVENTS } from './events.js';

export class CombatSystem {
  constructor(options = {}) {
    this.eventBus = options.eventBus || null;

    this.monsterManager = options.monsterManager || null;
    this.projectileManager = options.projectileManager || null;
    this.playerRef = options.playerRef || null;
    this.gameState = options.gameState || null;
    this.audioManager = options.audioManager || null;

    this.unsubscribers = [];
    this.bind();
  }

  bind() {
    this.unsubscribers.forEach((fn) => fn?.());
    this.unsubscribers = [];

    if (!this.eventBus?.on) return;

    this.unsubscribers.push(
      this.eventBus.on(EVENTS.PLAYER_HIT_MONSTER, (payload) => this.onPlayerHitMonster(payload))
    );

    this.unsubscribers.push(
      this.eventBus.on(EVENTS.MONSTER_HIT_PLAYER, (payload) => this.onMonsterHitPlayer(payload))
    );

    this.unsubscribers.push(
      this.eventBus.on(EVENTS.PROJECTILE_HIT_WALL, (payload) => this.onProjectileHitWall(payload))
    );

    this.unsubscribers.push(
      this.eventBus.on(EVENTS.PLAYER_USED_SKILL, (payload) => this.onPlayerUsedSkill(payload))
    );
  }

  setEventBus(eventBus) {
    this.eventBus = eventBus;
    this.bind();
  }

  setRefs({ monsterManager, projectileManager, playerRef, gameState } = {}) {
    if (monsterManager) this.monsterManager = monsterManager;
    if (projectileManager) this.projectileManager = projectileManager;
    if (playerRef) this.playerRef = playerRef;
    if (gameState) this.gameState = gameState;
  }

  onPlayerHitMonster(payload) {
    const monster = payload?.monster || null;
    const hitPosition = payload?.hitPosition || null;
    const projectile = payload?.projectile || null;

    if (!monster || monster.isDead || monster.isDying) return;

    if (hitPosition && this.projectileManager?.spawnImpact) {
      this.projectileManager.spawnImpact(hitPosition, projectile);
    }

    if (this.monsterManager?.handleProjectileHit) {
      this.monsterManager.handleProjectileHit(monster, hitPosition, projectile);
    }

    this.handleProjectileExplosion(hitPosition, projectile, { excludeMonster: monster });
  }

  onMonsterHitPlayer(payload) {
    const hitPosition = payload?.hitPosition || null;
    const projectile = payload?.projectile || null;
    const attackType = payload?.attackType || payload?.kind || null;

    const damage = Number.isFinite(payload?.damage)
      ? payload.damage
      : (projectile?.damage ?? 0);

    const gs = this.gameState || this.playerRef?.gameState || null;
    if (damage > 0) {
      const mult = typeof this.playerRef?.getDamageTakenMultiplier === 'function'
        ? this.playerRef.getDamageTakenMultiplier({ attackType, projectile, payload })
        : 1.0;
      const finalDamage = Number.isFinite(mult) ? damage * mult : damage;
      const rounded = Number.isFinite(finalDamage) ? Math.round(finalDamage) : finalDamage;
      if (rounded > 0) {
        gs?.takeDamage?.(rounded);
      }
    }

    // Player hit VFX are handled by FeedbackSystem (single red ring overlay).
    this.handleProjectileExplosion(hitPosition, projectile, { suppressVisuals: true });
  }

  onProjectileHitWall(payload) {
    const hitPosition = payload?.hitPosition || null;
    const projectile = payload?.projectile || null;
    if (!hitPosition) return;

    if (this.projectileManager?.spawnImpact) {
      this.projectileManager.spawnImpact(hitPosition, projectile);
    }

    this.handleProjectileExplosion(hitPosition, projectile);
  }

  onPlayerUsedSkill(payload) {
    const kind = String(payload?.kind || '').toLowerCase();
    const pos = payload?.position || null;
    if (!pos) return;

    if (kind === 'emp') {
      const radius = Number.isFinite(payload?.radius) ? payload.radius : 4.2;
      const stunSeconds = Number.isFinite(payload?.stunSeconds) ? payload.stunSeconds : 1.6;
      const damage = Number.isFinite(payload?.damage) ? payload.damage : 0;

      this.projectileManager?.spawnExplosion?.(pos, {
        color: payload?.color ?? 0x66aaff,
        size: 1.4,
        intensity: 2.0
      });

      this.monsterManager?.applyAreaDamage?.(pos, radius, damage, {
        owner: 'player',
        kind: 'emp',
        stunSeconds,
        damagePlayer: false
      });
    }
  }

  handleProjectileExplosion(hitPosition, projectile, options = {}) {
    if (!hitPosition || !projectile) return;

    const radius = projectile.explosionRadius;
    if (!Number.isFinite(radius) || radius <= 0) return;

    const damage = Number.isFinite(projectile.explosionDamage)
      ? projectile.explosionDamage
      : (projectile.damage ?? 1);

    const color = projectile.explosionColor ?? (projectile.owner === 'monster' ? 0x88ccff : 0xffaa55);

    if (!options.suppressVisuals) {
      this.projectileManager?.spawnExplosion?.(hitPosition, {
        color,
        size: Math.max(1.1, radius * 0.35),
        intensity: 2.3
      });
    }

    if (projectile.owner === 'player') {
      this.audioManager?.playExplosion?.(Math.max(0.4, Math.min(1.0, radius / 5)));
    }

    this.monsterManager?.applyAreaDamage?.(hitPosition, radius, damage, {
      owner: projectile.owner,
      kind: projectile.kind,
      sourceMonster: projectile.sourceMonster || null,
      excludeMonster: options.excludeMonster || null,
      stunSeconds: projectile.stunSeconds
    });
  }

  dispose() {
    this.unsubscribers.forEach((fn) => fn?.());
    this.unsubscribers = [];
  }
}
