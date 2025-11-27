/**
 * Main game loop
 * Coordinates updates and rendering for all game systems
 */

import * as THREE from 'three';
import { CONFIG } from '../core/config.js';
import { updateLighting } from '../rendering/lighting.js';
import { ROOM_CONFIGS } from '../world/tileTypes.js';
import { VisualEffects } from '../rendering/visualEffects.js';

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
  constructor(sceneManager, player, minimap = null, monsterManager = null, lights = null, worldState = null, gameState = null, exitPoint = null, missionPoints = [], autopilot = null) {
    this.sceneManager = sceneManager;
    this.player = player;
    this.minimap = minimap;
    this.monsterManager = monsterManager;
    this.lights = lights;

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

    // FPS tracking
    this.frameCount = 0;
    this.fps = CONFIG.TARGET_FPS;
    this.lastFpsUpdate = 0;
    this.targetFrameTime = 1000 / CONFIG.TARGET_FPS; // Target time per frame in ms
    this.lastProgressPos = null;
    this.noProgressTimer = 0;

    // UI elements
    this.positionElement = document.getElementById('position');
    this.fpsElement = document.getElementById('fps');
    this.currentRoomElement = document.getElementById('current-room');
    this.gameTimeElement = document.getElementById('game-time');
    this.healthDisplayElement = document.getElementById('health-display');
    this.healthFillElement = document.getElementById('health-fill');

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
  }

  /**
   * Start the game loop
   */
  start() {
    if (this.running) return;

    this.running = true;
    this.lastTime = performance.now();
    this.lastFpsUpdate = this.lastTime;

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

  /**
   * Main loop function (called every frame)
   */
  loop() {
    if (!this.running) return;

    const now = performance.now();
    const deltaTime = (now - this.lastTime) / 1000; // Convert to seconds
    this.lastTime = now;

    // Update game state
    this.update(deltaTime);

    // Render scene
    this.render();

    // Update FPS counter
    this.updateFPS(now);

    // Request next frame
    requestAnimationFrame(() => this.loop());
  }

  /**
   * Update all game systems
   * @param {number} deltaTime - Time since last frame in seconds
   */
  update(deltaTime) {
    // Clamp deltaTime to prevent physics issues on lag spikes
    const dt = Math.min(deltaTime, 0.1);

    // Don't update if game is over
    if (this.gameState && this.gameState.gameOver) {
      return;
    }

    // Update game state timer
    if (this.gameState) {
      this.gameState.updateTimer();
    }

    // --- Autopilot takeover (v2) ---
    let externalCommand = null;
    const allowAutopilot =
      CONFIG.AUTOPILOT_ENABLED &&
      this.autopilot &&
      !this.gameState?.gameOver;

    let hasPlayerMove = false;
    let hasPlayerLook = false;

    if (allowAutopilot && this.player && this.player.input) {
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

      hasPlayerLook = mouseDelta.x !== 0 || mouseDelta.y !== 0;

      // Idle timer counts all input (keyboard + mouse)
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

    // Only hand over movement when autopilot is enabled and player isn't providing input
    const autopilotControlling = allowAutopilotNow && !hasPlayerMove && !hasPlayerLook;

    if (this.autopilot) {
      this.autopilot.setEnabled(allowAutopilot);

      const cmd = allowAutopilot ? (this.autopilot.tick(dt) || null) : null;

      if (autopilotControlling && cmd) {
        // Mouse look this frame: keep autopilot movement but don't override view
        if (hasPlayerLook) {
          const { lookYaw, ...rest } = cmd;
          externalCommand = rest;
        } else {
          externalCommand = cmd;
        }
      }
    }

    this.autopilotActive = autopilotControlling;
    if (this.player) {
      this.player.update(dt, this.autopilotActive, externalCommand);
    }

    // Get player position for checks
    let playerPos = this.player.getPosition();

    // Update monsters via MonsterManager
    if (this.monsterManager && this.monsterManager.update) {
      this.monsterManager.update(dt, playerPos);
    }

    // Soft separation to reduce sticking with monsters
    this.separatePlayerFromMonsters(playerPos);
    playerPos = this.player.getPosition();
    this.separatePlayerFromWalls(playerPos);
    playerPos = this.player.getPosition();

    // Detect prolonged no-progress while input or autopilot is active
    const isDriven = this.autopilotActive || hasPlayerMove;
    if (!this.lastProgressPos) {
      this.lastProgressPos = playerPos.clone();
    }
    const distSinceLast = this.lastProgressPos ? playerPos.distanceTo(this.lastProgressPos) : 0;
    if (isDriven && distSinceLast < 0.05) {
      this.noProgressTimer += dt;
      if (this.noProgressTimer > 2.0) {
        if (this.player?.forceUnstuck) {
          this.player.forceUnstuck();
          playerPos = this.player.getPosition();
        }
        if (this.autopilot?.resetPath) {
          this.autopilot.resetPath();
        }
        this.lastProgressPos = playerPos.clone();
        this.noProgressTimer = 0;
        console.log('⚠️ No-progress detected, nudging player free.');
      }
    } else {
      this.noProgressTimer = 0;
      this.lastProgressPos = playerPos.clone();
    }

    // Check monster collision (damage player)
    if (this.monsterManager && this.gameState) {
      const now = performance.now() / 1000;
      if (now - this.lastMonsterDamageTime > this.monsterDamageCooldown) {
        const caught = this.monsterManager.checkPlayerCaught(playerPos, 1.25);
        if (caught?.hit) {
          const died = this.gameState.takeDamage(10);
          this.lastMonsterDamageTime = now;

          // Visual feedback
          if (this.visualEffects) {
            if (died) {
              // Death effect (stronger)
              this.visualEffects.deathEffect();
              this.showGameOver(false);
            } else {
              // Damage effect
              this.visualEffects.monsterCaughtEffect();
            }
          }

          if (died && !this.loseHandled) {
            this.loseHandled = true;
            if (typeof this.onLose === 'function') {
              this.onLose();
            }
          }

          // Small knockback so player doesn't stick to monsters
          this.applyPlayerKnockback(caught.monster);

          console.log('💔 Caught by monster! Health:', this.gameState.currentHealth);
        }
      }
    }

    // Refresh player position after potential knockback
    playerPos = this.player.getPosition();

    // Check exit point collision (win condition)
    if (this.exitPoint && this.gameState) {
      if (this.exitPoint.isPlayerNear(playerPos, 2)) {
        // Visual feedback for victory
        if (this.visualEffects) {
          this.visualEffects.victoryFlash();
        }

        if (!this.winHandled) {
          this.winHandled = true;
          this.gameState.win('你成功找到了出口！');
          this.showGameOver(true);
          if (typeof this.onWin === 'function') {
            this.onWin();
          }
        }
      }
    }

    // Check mission points
    if (this.gameState && this.missionPoints && this.missionPoints.length > 0) {
      this.missionPoints.forEach(mp => {
        if (!mp.collected && mp.isPlayerNear(playerPos, 2)) {
          mp.collect(this.sceneManager.getScene());
          this.gameState.collectMission();
        }
      });
    }

    // Update exit point animation
    if (this.exitPoint) {
      this.exitPoint.update(dt);
    }

    // Update lighting (flickering effect)
    if (this.lights) {
      updateLighting(this.lights, dt);
    }

    // Update visual effects
    if (this.visualEffects) {
      this.visualEffects.update(dt, this.sceneManager.camera);
    }

    // Update UI
    this.updateUI();
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
      const missionPositions =
        this.missionPoints?.filter(mp => !mp.collected).map(mp => mp.getGridPosition()) || [];
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
   * Update UI elements
   */
  updateUI() {
    // Update position display
    if (this.positionElement) {
      const pos = this.player.getPosition();
      const gridPos = this.player.getGridPosition();
      this.positionElement.textContent =
        `${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)} | Grid: ${gridPos.x}, ${gridPos.y}`;
    }

    // Update current room display
    if (this.currentRoomElement && this.worldState) {
      const gridPos = this.player.getGridPosition();
      const roomType = this.worldState.getRoomType(gridPos.x, gridPos.y);
      const roomConfig = ROOM_CONFIGS[roomType];
      if (roomConfig) {
        this.currentRoomElement.textContent = roomConfig.name;
      }
    }

    // Update mission status
    const missionElement = document.getElementById('mission-status');
    if (missionElement && this.gameState) {
      missionElement.textContent = `${this.gameState.missionsCollected}/${this.gameState.missionsTotal}`;
    }

    // Update game timer
    if (this.gameTimeElement && this.gameState) {
      this.gameTimeElement.textContent = this.gameState.getFormattedTime();
    }

    // Update health display
    if (this.healthDisplayElement && this.gameState) {
      this.healthDisplayElement.textContent = this.gameState.currentHealth;
    }

    // Update health bar fill
    if (this.healthFillElement && this.gameState) {
      const healthPercent = this.gameState.getHealthPercentage();
      this.healthFillElement.style.width = `${healthPercent}%`;
    }

    // Update keys pressed display
    const keysElement = document.getElementById('keys-pressed');
    if (keysElement && this.player && this.player.input) {
      const keys = [];
      if (this.player.input.isKeyPressed('KeyW')) keys.push('W');
      if (this.player.input.isKeyPressed('KeyA')) keys.push('A');
      if (this.player.input.isKeyPressed('KeyS')) keys.push('S');
      if (this.player.input.isKeyPressed('KeyD')) keys.push('D');
      if (this.player.input.isSprinting()) keys.push('Shift');
      keysElement.textContent = keys.length > 0 ? keys.join(', ') : 'None';
    }

    // Update pointer lock status
    const pointerElement = document.getElementById('pointer-status');
    if (pointerElement && this.player && this.player.input) {
      pointerElement.textContent = this.player.input.isPointerLocked() ? 'Locked ✓' : 'Not Locked';
    }
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

    const pushDistance = (CONFIG.TILE_SIZE || 1) * 0.75;
    const targetPos = playerPos.clone().add(direction.multiplyScalar(pushDistance));

    // Keep knockback inside walkable space when possible
    if (this.worldState && this.worldState.isWalkable) {
      const grid = {
        x: Math.floor(targetPos.x / (CONFIG.TILE_SIZE || 1)),
        y: Math.floor(targetPos.z / (CONFIG.TILE_SIZE || 1))
      };
      if (!this.worldState.isWalkable(grid.x, grid.y)) {
        return;
      }
    }

    this.player.setPosition(targetPos.x, targetPos.y, targetPos.z);
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
      const targetPos = playerPos.clone().add(pushDir.multiplyScalar(pushMag));

      // Avoid pushing into walls
      if (this.worldState && this.worldState.isWalkable) {
        const gx = Math.floor(targetPos.x / (CONFIG.TILE_SIZE || 1));
        const gy = Math.floor(targetPos.z / (CONFIG.TILE_SIZE || 1));
        if (!this.worldState.isWalkable(gx, gy)) {
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
    const radius = (CONFIG.PLAYER_COLLISION_RADIUS || 0.35) * tileSize;

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

    const finalGX = Math.floor(pos.x / tileSize);
    const finalGY = Math.floor(pos.z / tileSize);
    if (this.worldState.isWalkable(finalGX, finalGY)) {
      this.player.setPosition(pos.x, pos.y, pos.z);
    }
  }

  /**
   * Update FPS counter
   * @param {number} now - Current timestamp
   */
  updateFPS(now) {
    this.frameCount++;

    // Update FPS display every second
    if (now - this.lastFpsUpdate >= 1000) {
      this.fps = this.frameCount;
      this.frameCount = 0;
      this.lastFpsUpdate = now;

      if (this.fpsElement) {
        this.fpsElement.textContent = this.fps;
      }
    }
  }

  /**
   * Add a monster to the game loop
   * @param {Monster} monster - Monster controller to add
   */
  addMonster(monster) {
    this.monsters.push(monster);
  }

  /**
   * Remove a monster from the game loop
   * @param {Monster} monster - Monster controller to remove
   */
  removeMonster(monster) {
    const index = this.monsters.indexOf(monster);
    if (index !== -1) {
      this.monsters.splice(index, 1);
    }
  }

  /**
   * Get current FPS
   * @returns {number} Current FPS
   */
  getFPS() {
    return this.fps;
  }

  /**
   * Show game over screen
   * @param {boolean} won - True if player won, false if lost
   */
  showGameOver(won) {
    const gameOverElement = document.getElementById('game-over');
    const titleElement = document.getElementById('game-over-title');
    const messageElement = document.getElementById('game-over-message');

    // Set title and message
    if (won) {
      titleElement.textContent = '🎉 胜利！';
      titleElement.style.color = '#ffd700';
      messageElement.textContent = '你成功找到了出口！';
    } else {
      titleElement.textContent = '💀 失败';
      titleElement.style.color = '#ff4444';
      messageElement.textContent = '你的生命值耗尽了...';
    }

    // Update stats
    if (this.gameState) {
      const stats = this.gameState.getStats();
      document.getElementById('final-time').textContent = stats.timeFormatted;
      document.getElementById('final-health').textContent = stats.health;
      document.getElementById('final-rooms').textContent = stats.roomsVisited;
      document.getElementById('final-steps').textContent = stats.steps;
    }

    // Show the overlay
    gameOverElement.classList.remove('hidden');

    // Release pointer lock
    if (this.player && this.player.input) {
      this.player.input.exitPointerLock();
    }

    console.log(won ? '🎉 Victory!' : '💀 Game Over');
  }
}
