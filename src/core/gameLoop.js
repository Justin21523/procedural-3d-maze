/**
 * Main game loop
 * Coordinates updates and rendering for all game systems
 */

import * as THREE from 'three';
import { CONFIG } from '../core/config.js';
import { EVENTS } from './events.js';
import { updateLighting } from '../rendering/lighting.js';
import { VisualEffects } from '../rendering/visualEffects.js';
import { SystemRegistry } from './systemRegistry.js';

export class GameLoop {
  /**
   * Create the game loop
   * @param {SceneManager} sceneManager - Scene manager for rendering
   * @param {PlayerController} player - Player controller
   * @param {Minimap} minimap - Minimap renderer (optional)
   * @param {MonsterManager|Array} monsterManager - Monster manager or array of monsters
   * @param {Object} lights - Lighting system (optional)
   * @param {WorldState} worldState - World state (optional)
   * @param {GameState} gameState - Game state manager (optional)
   * @param {ExitPoint} exitPoint - Exit point (optional)
   */
  constructor(sceneManager, player, minimap = null, monsterManager = null, lights = null, worldState = null, gameState = null, exitPoint = null, missionPoints = [], autopilot = null, projectileManager = null, gun = null, spawnDirector = null, uiManager = null, interactableSystem = null, missionDirector = null) {
    this.sceneManager = sceneManager;
    this.player = player;
    this.minimap = minimap;
    this.monsterManager = monsterManager;
    this.lights = lights;
    this.projectileManager = projectileManager;
    this.gun = gun;
    this.spawnDirector = spawnDirector;
    this.uiManager = uiManager;
    this.interactableSystem = interactableSystem;
    this.missionDirector = missionDirector;

    this.worldState = worldState;
    this.gameState = gameState;
    this.exitPoint = exitPoint;
    this.missionPoints = missionPoints;
    this.autopilot = autopilot;
    this.autopilotActive = CONFIG.AUTOPILOT_ENABLED;
    this.autopilotIdleSeconds = 0;

    // Minimap throttle
    this.minimapAccumulator = 0;
    this.minimapInterval = 0.25; // seconds between minimap renders

    this.running = false;
    this.lastTime = 0;

    this.lastProgressPos = null;
    this.noProgressTimer = 0;

    // Monster damage tracking
    this.lastMonsterDamageTime = 0;
    this.monsterDamageCooldown = 1.0; // 1 second between damage

    // Visual effects
    this.visualEffects = new VisualEffects();

    // Callbacks for win/lose
    this.onWin = null;
    this.onLose = null;
    this.winHandled = false;
    this.loseHandled = false;

    this.frameContext = {
      nowMs: 0,
      dt: 0,
      gameOver: false,
      hasPlayerMove: false,
      hasPlayerLook: false,
      autopilotActive: false,
      externalCommand: null,
      playerPos: null,
    };

    this.lastTimerTickSec = -1;
    this.lastRoomType = null;

    this.systemRegistry = new SystemRegistry();
    this.registerSystems();
  }

  /**
   * Start the game loop
   */
  start() {
    if (this.running) return;

    this.running = true;
    this.lastTime = performance.now();

    // Start game timer
    if (this.gameState && !this.gameState.isRunning) {
      this.gameState.startTimer();
    }

    console.log('Game loop started');
    this.loop();
  }

  /**
   * Stop the game loop
   */
  stop() {
    this.running = false;
    console.log('Game loop stopped');
  }

  registerSystems() {
    const systems = this.systemRegistry;
    systems.systems = [];

    // Handle win/lose callbacks even if gameOver happens from outside GameLoop (e.g. projectile hits).
    systems.add('outcome', (dt, ctx) => {
      if (!this.gameState?.gameOver) return;
      if (this.gameState.hasWon && !this.winHandled) {
        this.winHandled = true;
        this.visualEffects?.victoryFlash?.();
        if (typeof this.onWin === 'function') this.onWin();
      } else if (this.gameState.hasLost && !this.loseHandled) {
        this.loseHandled = true;
        this.visualEffects?.deathEffect?.();
        if (typeof this.onLose === 'function') this.onLose();
      }
    }, { order: 0 });

    systems.add('timer', () => {
      if (this.gameState && !this.gameState.gameOver) {
        this.gameState.updateTimer();

        const bus = this.gameState?.eventBus || null;
        const elapsedSec = this.gameState?.getElapsedTime ? this.gameState.getElapsedTime() : null;
        if (bus?.emit && Number.isFinite(elapsedSec) && elapsedSec !== this.lastTimerTickSec) {
          this.lastTimerTickSec = elapsedSec;
          bus.emit(EVENTS.TIMER_TICK, { elapsedSec });
        }
      }
    }, { order: 5 });

    systems.add('autopilot', (dt, ctx) => {
      ctx.hasPlayerMove = false;
      ctx.hasPlayerLook = false;
      ctx.externalCommand = null;
      ctx.autopilotActive = false;

      if (this.gameState?.gameOver) {
        this.autopilotActive = false;
        this.autopilotIdleSeconds = 0;
        return;
      }

      const allowAutopilot = CONFIG.AUTOPILOT_ENABLED && this.autopilot && !this.gameState?.gameOver;
      let hasPlayerMove = false;
      let hasPlayerLook = false;
      let externalCommand = null;

      if (allowAutopilot && this.player?.input) {
        const mouseDelta = this.player.input.peekMouseDelta
          ? this.player.input.peekMouseDelta()
          : { x: 0, y: 0 };

        hasPlayerMove =
          this.player.input.isKeyPressed('KeyW') ||
          this.player.input.isKeyPressed('KeyA') ||
          this.player.input.isKeyPressed('KeyS') ||
          this.player.input.isKeyPressed('KeyD') ||
          this.player.input.isKeyPressed('ShiftLeft') ||
          this.player.input.isKeyPressed('ShiftRight');

        const hasMouseButtons = !!(this.player.input.mouseButtons?.left || this.player.input.mouseButtons?.right);
        hasPlayerLook = mouseDelta.x !== 0 || mouseDelta.y !== 0 || hasMouseButtons;

        const idle = this.player.input.getIdleTimeSeconds
          ? this.player.input.getIdleTimeSeconds()
          : 0;
        this.autopilotIdleSeconds = idle;
      } else {
        this.autopilotIdleSeconds = 0;
      }

      const allowAutopilotNow =
        allowAutopilot &&
        this.autopilotIdleSeconds >= (CONFIG.AUTOPILOT_DELAY || 0);

      const autopilotControlling = allowAutopilotNow && !hasPlayerMove && !hasPlayerLook;

      if (this.autopilot) {
        this.autopilot.setEnabled(allowAutopilot);
        const cmd = allowAutopilot ? (this.autopilot.tick(dt) || null) : null;

        if (autopilotControlling && cmd) {
          if (hasPlayerLook) {
            const { lookYaw, ...rest } = cmd;
            externalCommand = rest;
          } else {
            externalCommand = cmd;
          }
        }
      }

      ctx.hasPlayerMove = hasPlayerMove;
      ctx.hasPlayerLook = hasPlayerLook;
      ctx.externalCommand = externalCommand;
      ctx.autopilotActive = autopilotControlling;
      this.autopilotActive = autopilotControlling;
    }, { order: 10 });

    systems.add('player', (dt, ctx) => {
      if (this.gameState?.gameOver) return;
      if (!this.player?.update) return;
      this.player.update(dt, !!ctx.autopilotActive, ctx.externalCommand || null);
      ctx.playerPos = this.player.getPosition ? this.player.getPosition() : null;
    }, { order: 20 });

    systems.add('roomTracker', (dt, ctx) => {
      void dt;
      if (this.gameState?.gameOver) return;
      if (!this.worldState?.getRoomType) return;
      if (!this.player?.getGridPosition) return;

      const gridPos = this.player.getGridPosition();
      const roomType = this.worldState.getRoomType(gridPos.x, gridPos.y);
      if (roomType === this.lastRoomType) return;
      this.lastRoomType = roomType;

      this.gameState?.visitRoom?.(roomType);
      this.gameState?.eventBus?.emit?.(EVENTS.ROOM_ENTERED, {
        gridPos,
        roomType
      });
    }, { order: 22 });

    systems.add('interactables', (dt, ctx) => {
      if (this.gameState?.gameOver) return;
      this.interactableSystem?.update?.(dt, ctx);
    }, { order: 25 });

    systems.add('gun', (dt, ctx) => {
      if (this.gameState?.gameOver) return;
      this.gun?.update?.(dt, ctx?.externalCommand || null, !!ctx?.autopilotActive);
    }, { order: 30 });

    systems.add('projectiles', (dt) => {
      if (this.gameState?.gameOver) return;
      this.projectileManager?.update?.(dt);
    }, { order: 40 });

    systems.add('spawnDirector', (dt) => {
      if (this.gameState?.gameOver) return;
      this.spawnDirector?.update?.(dt);
    }, { order: 50 });

    systems.add('monsters', (dt, ctx) => {
      if (this.gameState?.gameOver) return;
      const playerPos = ctx.playerPos || (this.player?.getPosition ? this.player.getPosition() : null);
      if (!playerPos) return;
      this.monsterManager?.update?.(dt, playerPos);
    }, { order: 60 });

    systems.add('separation', (dt, ctx) => {
      if (this.gameState?.gameOver) return;
      if (!this.player?.getPosition) return;

      let playerPos = this.player.getPosition();
      this.separatePlayerFromMonsters(playerPos);
      playerPos = this.player.getPosition();
      this.separatePlayerFromWalls(playerPos);
      ctx.playerPos = this.player.getPosition();
    }, { order: 70 });

    systems.add('noProgress', (dt, ctx) => {
      if (this.gameState?.gameOver) return;
      const playerPos = ctx.playerPos || (this.player?.getPosition ? this.player.getPosition() : null);
      if (!playerPos) return;

      const isDriven = !!ctx.autopilotActive || !!ctx.hasPlayerMove;
      if (!this.lastProgressPos) {
        this.lastProgressPos = playerPos.clone();
      }

      const distSinceLast = this.lastProgressPos ? playerPos.distanceTo(this.lastProgressPos) : 0;
      if (isDriven && distSinceLast < 0.05) {
        this.noProgressTimer += dt;
        if (this.noProgressTimer > 2.0) {
          if (this.player?.forceUnstuck) {
            this.player.forceUnstuck();
          }
          if (this.autopilot?.resetPath) {
            this.autopilot.resetPath();
          }
          const refreshed = this.player?.getPosition ? this.player.getPosition() : playerPos;
          this.lastProgressPos = refreshed.clone();
          this.noProgressTimer = 0;
          console.log('⚠️ No-progress detected, nudging player free.');
        }
      } else {
        this.noProgressTimer = 0;
        this.lastProgressPos = playerPos.clone();
      }
    }, { order: 80 });

    systems.add('meleeCollision', (dt, ctx) => {
      if (this.gameState?.gameOver) return;
      if (!this.monsterManager || !this.gameState || !this.player?.getPosition) return;

      const nowSeconds = (Number.isFinite(ctx.nowMs) ? ctx.nowMs : performance.now()) / 1000;
      const playerPos = ctx.playerPos || this.player.getPosition();
      const caught = this.monsterManager.checkPlayerCaught(playerPos, 1.25);
      if (!caught?.hit) return;
      if (!caught?.monster) return;

      // Global limiter: prevent multi-hit bursts when several monsters overlap the player.
      if (nowSeconds - this.lastMonsterDamageTime <= this.monsterDamageCooldown) return;

      const monster = caught.monster;
      const profile = this.getMonsterContactAttackProfile(monster);
      const nextAt = Number.isFinite(monster.__nextMeleeAttackAt) ? monster.__nextMeleeAttackAt : 0;
      if (nowSeconds < nextAt) return;

      // Require the monster to be roughly facing the player to land a melee hit.
      if (!this.isMonsterFacingTarget(monster, playerPos, profile.facingDot)) {
        monster.__nextMeleeAttackAt = nowSeconds + 0.25;
        return;
      }

      // Optional hesitation to avoid "endless" contact DPS.
      if (profile.chance < 1.0 && Math.random() > profile.chance) {
        monster.__nextMeleeAttackAt = nowSeconds + Math.max(0.25, profile.cooldown * (0.35 + Math.random() * 0.35));
        return;
      }

      const damage = caught.damage ?? 10;
      monster.__nextMeleeAttackAt = nowSeconds + Math.max(0.25, profile.cooldown * (0.85 + Math.random() * 0.3));
      this.lastMonsterDamageTime = nowSeconds;
      const eventBus = this.gameState?.eventBus || null;
      if (eventBus?.emit) {
        eventBus.emit(EVENTS.MONSTER_HIT_PLAYER, {
          attackType: 'melee',
          monster: caught.monster,
          damage,
          hitPosition: playerPos.clone()
        });
      } else {
        this.gameState.takeDamage(damage);
      }

      this.applyPlayerKnockback(caught.monster);
      ctx.playerPos = this.player.getPosition();
    }, { order: 90 });

    systems.add('exitAnim', (dt) => {
      if (this.exitPoint?.update) {
        this.exitPoint.update(dt);
      }
    }, { order: 120 });

    systems.add('lighting', (dt) => {
      if (this.lights) {
        updateLighting(this.lights, dt);
      }
    }, { order: 130 });

    systems.add('sceneUpdate', (dt) => {
      if (this.sceneManager && typeof this.sceneManager.update === 'function') {
        this.sceneManager.update(dt);
      }
    }, { order: 140 });

    systems.add('visualEffects', (dt) => {
      if (this.visualEffects) {
        this.visualEffects.update(dt, this.sceneManager.camera);
      }
    }, { order: 150 });

    systems.add('ui', (dt, ctx) => {
      this.uiManager?.update?.(dt, ctx.nowMs);
    }, { order: 160 });
  }

  /**
   * Main loop function (called every frame)
   */
  loop() {
    if (!this.running) return;

    const now = performance.now();
    const deltaTime = (now - this.lastTime) / 1000; // Convert to seconds
    this.lastTime = now;

    // Update game state
    this.update(deltaTime, now);

    // Render scene
    this.render();

    // Request next frame
    requestAnimationFrame(() => this.loop());
  }

  /**
   * Update all game systems
   * @param {number} deltaTime - Time since last frame in seconds
   */
  update(deltaTime, nowMs = null) {
    const dt = Math.min(deltaTime, 0.1);
    const now = Number.isFinite(nowMs) ? nowMs : performance.now();
    const ctx = this.frameContext;
    ctx.nowMs = now;
    ctx.dt = dt;

    this.systemRegistry.update(dt, ctx);
  }

  /**
   * Render the scene
   */
  render() {
    this.sceneManager.render();

    // Render minimap if available
    if (this.minimap) {
      const playerGridPos = this.player.getGridPosition();
      const monsterPositions = this.monsterManager ? this.monsterManager.getMonsterPositions() : [];
      const exitPosition = this.exitPoint ? this.exitPoint.getGridPosition() : null;
      const missionPositions = this.missionDirector?.getAutopilotTargets
        ? this.missionDirector.getAutopilotTargets().map(t => t.gridPos)
        : [];
      this.minimap.render(playerGridPos, monsterPositions, exitPosition, missionPositions);
    }
  }

  /**
   * Reset per-run flags/timers
   */
  resetRoundState() {
    this.lastMonsterDamageTime = 0;
    this.winHandled = false;
    this.loseHandled = false;
  }

  /**
   * Push player slightly away from the monster that just hit them to avoid overlap/locking
   * @param {Monster|null} monster
   */
  applyPlayerKnockback(monster) {
    if (!monster || !this.player) return;

    const monsterPos = monster.getWorldPosition ? monster.getWorldPosition() : null;
    const playerPos = this.player.getPosition ? this.player.getPosition() : null;
    if (!monsterPos || !playerPos) return;

    const direction = new THREE.Vector3().subVectors(playerPos, monsterPos).setY(0);
    if (direction.lengthSq() === 0) {
      direction.set(1, 0, 0); // Fallback direction
    }
    direction.normalize();

    const blockMult =
      (typeof this.player?.isBlocking === 'function' && this.player.isBlocking())
        ? (CONFIG.PLAYER_BLOCK_KNOCKBACK_MULT ?? 0.5)
        : 1.0;

    const pushDistance = (CONFIG.TILE_SIZE || 1) * 0.75 * blockMult;
    const attempts = [pushDistance, pushDistance * 0.5, pushDistance * 0.25];
    for (const dist of attempts) {
      const targetPos = playerPos.clone().add(direction.clone().multiplyScalar(dist));

      // Keep knockback inside walkable space when possible
      if (typeof this.player?.canMoveTo === 'function') {
        if (!this.player.canMoveTo(targetPos.x, targetPos.z)) continue;
      } else if (this.worldState && this.worldState.isWalkable) {
        const grid = {
          x: Math.floor(targetPos.x / (CONFIG.TILE_SIZE || 1)),
          y: Math.floor(targetPos.z / (CONFIG.TILE_SIZE || 1))
        };
        if (!this.worldState.isWalkable(grid.x, grid.y)) continue;
      }

      this.player.setPosition(targetPos.x, targetPos.y, targetPos.z);
      break;
    }
  }

  getMonsterContactAttackProfile(monster) {
    const combat = monster?.typeConfig?.combat || {};
    const cooldown = Number.isFinite(combat.contactCooldown) ? combat.contactCooldown : 1.8;
    const chance = Number.isFinite(combat.contactChance) ? combat.contactChance : 0.65;
    const facingDot = Number.isFinite(combat.contactFacingDot) ? combat.contactFacingDot : 0.15;

    return {
      cooldown: Math.max(0.25, cooldown),
      chance: Math.max(0, Math.min(1, chance)),
      facingDot: Math.max(-1, Math.min(1, facingDot))
    };
  }

  isMonsterFacingTarget(monster, targetPos, minDot = 0.15) {
    const yaw = typeof monster?.getYaw === 'function' ? monster.getYaw() : monster?.yaw;
    const monsterPos = monster?.getWorldPosition ? monster.getWorldPosition() : null;
    if (!Number.isFinite(yaw) || !monsterPos || !targetPos) return true;

    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const toTarget = targetPos.clone().sub(monsterPos).setY(0);
    if (toTarget.lengthSq() <= 1e-8) return true;
    toTarget.normalize();

    const dot = forward.dot(toTarget);
    return dot >= minDot;
  }

  /**
   * Continuously push player away from overlapping monsters to avoid sticking
   */
  separatePlayerFromMonsters(playerPos) {
    if (!this.monsterManager || !this.player) return;
    const monsters = this.monsterManager.getMonsters ? this.monsterManager.getMonsters() : [];
    const minDist = (CONFIG.TILE_SIZE || 1) * 0.6;

    for (const m of monsters) {
      const mPos = m.getWorldPosition ? m.getWorldPosition() : null;
      if (!mPos) continue;

      const delta = new THREE.Vector3().subVectors(playerPos, mPos).setY(0);
      const dist = delta.length();
      if (dist <= 0.0001 || dist >= minDist) continue;

      const pushDir = delta.normalize();
      const pushMag = (minDist - dist) * 0.6; // soften push
      const pushVec = pushDir.clone().multiplyScalar(pushMag);
      let targetPos = playerPos.clone().add(pushVec);

      const canMoveTo = (x, z) => {
        if (typeof this.player?.canMoveTo === 'function') return this.player.canMoveTo(x, z);
        if (this.worldState && this.worldState.isWalkable) {
          const gx = Math.floor(x / (CONFIG.TILE_SIZE || 1));
          const gy = Math.floor(z / (CONFIG.TILE_SIZE || 1));
          return this.worldState.isWalkable(gx, gy);
        }
        return true;
      };

      if (!canMoveTo(targetPos.x, targetPos.z)) {
        // Try axis-only pushes to avoid corner tunneling.
        const posX = playerPos.clone().add(new THREE.Vector3(pushVec.x, 0, 0));
        const posZ = playerPos.clone().add(new THREE.Vector3(0, 0, pushVec.z));
        if (canMoveTo(posX.x, posX.z)) {
          targetPos = posX;
        } else if (canMoveTo(posZ.x, posZ.z)) {
          targetPos = posZ;
        } else {
          continue;
        }
      }

      this.player.setPosition(targetPos.x, targetPos.y, targetPos.z);
      // Update playerPos reference for subsequent monsters in the same frame
      playerPos = this.player.getPosition();
    }
  }

  /**
   * Push player away from nearby walls/corners to reduce sticking.
   * @param {THREE.Vector3} playerPos
   */
  separatePlayerFromWalls(playerPos) {
    if (!this.worldState || !this.player || !this.worldState.isWalkable) return;

    const tileSize = CONFIG.TILE_SIZE || 1;
    const radius = CONFIG.PLAYER_RADIUS ?? 0.35;

    let pos = playerPos.clone();
    const baseGX = Math.floor(pos.x / tileSize);
    const baseGY = Math.floor(pos.z / tileSize);

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const gx = baseGX + dx;
        const gy = baseGY + dy;

        if (this.worldState.isWalkable(gx, gy)) continue;

        const minX = gx * tileSize;
        const maxX = minX + tileSize;
        const minZ = gy * tileSize;
        const maxZ = minZ + tileSize;

        const closestX = Math.max(minX, Math.min(pos.x, maxX));
        const closestZ = Math.max(minZ, Math.min(pos.z, maxZ));

        const dxWorld = pos.x - closestX;
        const dzWorld = pos.z - closestZ;
        const distSq = dxWorld * dxWorld + dzWorld * dzWorld;

        if (distSq <= 0) continue;
        if (distSq >= radius * radius) continue;

        const dist = Math.sqrt(distSq);
        const overlap = radius - dist + 0.001;
        const nx = dxWorld / dist;
        const nz = dzWorld / dist;

        pos.x += nx * overlap;
        pos.z += nz * overlap;
      }
    }

    const canMoveTo = typeof this.player?.canMoveTo === 'function'
      ? this.player.canMoveTo.bind(this.player)
      : null;

    const finalGX = Math.floor(pos.x / tileSize);
    const finalGY = Math.floor(pos.z / tileSize);
    if (canMoveTo ? canMoveTo(pos.x, pos.z) : this.worldState.isWalkable(finalGX, finalGY)) {
      this.player.setPosition(pos.x, pos.y, pos.z);
    }
  }

}
