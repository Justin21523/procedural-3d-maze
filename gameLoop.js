/**
 * Main game loop
 * Coordinates updates and rendering for all game systems
 */

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

    // --- Autopilot orchestration ---
    // 規則：
    // 1. CONFIG.AUTOPILOT_ENABLED 為總開關
    // 2. 玩家閒置超過 AUTOPILOT_DELAY 秒自動啟動
    // 3. 只要有任何鍵盤 / 滑鼠輸入，立刻關閉 autopilot
    let externalCommand = null;
    if (this.autopilot) {
      const allowAutopilot = !!CONFIG.AUTOPILOT_ENABLED;
      const delay = CONFIG.AUTOPILOT_DELAY ?? 0;
      const idleSeconds = this.player?.input?.getIdleTimeSeconds
        ? this.player.input.getIdleTimeSeconds()
        : Infinity;
      const shouldEnable = allowAutopilot && idleSeconds >= delay;

      this.autopilotActive = shouldEnable;
      this.autopilot.setEnabled(shouldEnable);

      // 啟動時，每 frame 要一份外部控制指令
      if (this.autopilotActive) {
        externalCommand = this.autopilot.tick(dt);
      }
    }

    // 將 Autopilot 的指令注入 PlayerController（不直接改位置）
    if (externalCommand) {
      this.player.applyExternalControl(externalCommand, dt);
    }

    // autopilotActive = true 時，即使沒 pointer lock 也允許移動
    this.player.update(dt, this.autopilotActive);

    // Get player position for checks
    const playerPos = this.player.getPosition();

    // Update monsters via MonsterManager
    if (this.monsterManager && this.monsterManager.update) {
      this.monsterManager.update(dt, playerPos);
    }

    // Check monster collision (damage player)
    if (this.monsterManager && this.gameState) {
      const now = performance.now() / 1000;
      if (now - this.lastMonsterDamageTime > this.monsterDamageCooldown) {
        if (this.monsterManager.checkPlayerCaught(playerPos, 1.5)) {
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

          console.log('💔 Caught by monster! Health:', this.gameState.currentHealth);
        }
      }
    }

    // Check exit point collision (win condition)
    if (this.exitPoint && this.gameState) {
      if (this.exitPoint.isPlayerNear(playerPos, 2)) {
        // Visual feedback for victory
        if (this.visualEffects) {
          this.visualEffects.victoryFlash();
        }

        this.gameState.win('你成功找到了出口！');
        this.showGameOver(true);
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
