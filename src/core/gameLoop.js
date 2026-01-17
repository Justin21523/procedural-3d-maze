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
import { PlayerToolAISystem } from './playerToolAISystem.js';

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
  constructor(sceneManager, player, minimap = null, monsterManager = null, lights = null, worldState = null, gameState = null, exitPoint = null, missionPoints = [], autopilot = null, projectileManager = null, gun = null, spawnDirector = null, toolSystem = null, deviceManager = null, uiManager = null, interactableSystem = null, missionDirector = null) {
    this.sceneManager = sceneManager;
    this.player = player;
    this.minimap = minimap;
    this.monsterManager = monsterManager;
    this.lights = lights;
    this.projectileManager = projectileManager;
    this.gun = gun;
    this.spawnDirector = spawnDirector;
    this.toolSystem = toolSystem;
    this.deviceManager = deviceManager;
    this.uiManager = uiManager;
    this.interactableSystem = interactableSystem;
    this.missionDirector = missionDirector;
    this.worldMarkerSystem = null;
    this.playerToolAISystem = new PlayerToolAISystem({
      player,
      toolSystem,
      monsterManager,
      worldState,
      gameState,
      missionDirector
    });

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
    this.rafId = null;

    // Dynamic resolution scaling (simple FPS governor)
    this._perf = {
      emaFrameMs: 16.67,
      adjustCooldown: 0,
      guardCooldown: 0,
      lowFpsTimer: 0,
      highFpsTimer: 0,
      guardTier: 0,
      defaults: {
        monsterCullTiles: Number.isFinite(CONFIG.MONSTER_RENDER_CULL_DISTANCE_TILES) ? CONFIG.MONSTER_RENDER_CULL_DISTANCE_TILES : 22,
        farTickSeconds: Number.isFinite(CONFIG.MONSTER_AI_FAR_TICK_SECONDS) ? CONFIG.MONSTER_AI_FAR_TICK_SECONDS : 0.35,
        minimapInterval: this.minimapInterval
      }
    };

    this._watchdog = {
      lowFpsSeconds: 0,
      spikeSeconds: 0,
      tripped: false,
      reason: null
    };
    this.onWatchdogTrip = null;

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
    this.rafId = null;

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
  stop(reason = '') {
    if (!this.running) return;
    this.running = false;
    if (this.rafId !== null) {
      try { cancelAnimationFrame(this.rafId); } catch { /* ignore */ }
      this.rafId = null;
    }
    this.lastStopReason = String(reason || '');
    console.warn(`⏹️ Game loop stopped${this.lastStopReason ? ` (${this.lastStopReason})` : ''}`);
    try {
      console.trace('Game loop stop trace');
    } catch {
      // ignore
    }
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
          const playerGridPos = this.player?.getGridPosition ? this.player.getGridPosition() : null;
          const cameraToolActive = !!this.player?.isCameraToolActive?.();
          bus.emit(EVENTS.TIMER_TICK, { elapsedSec, playerGridPos, cameraToolActive });
        }
      }
    }, { order: 24 });

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
          this.player.input.isKeyPressed('KeyC') ||
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

    systems.add('moveModifiers', () => {
      const player = this.player;
      const md = this.missionDirector;
      if (!player?.setMoveModifiers) return;
      if (!md?.missions?.values) {
        player.setMoveModifiers({ speedMult: 1.0, sprintDisabled: false });
        return;
      }

      let speedMult = 1.0;
      let sprintDisabled = false;

      for (const mission of md.missions.values()) {
        if (!mission) continue;
        if (mission.template !== 'deliverFragile') continue;
        if (mission.state?.delivered) continue;
        if (!mission.state?.carrying) continue;

        const multRaw = Number(mission.params?.carrySpeedMult);
        const mult = Number.isFinite(multRaw)
          ? Math.max(0.2, Math.min(1.0, multRaw))
          : (Number.isFinite(CONFIG.PLAYER_CARRY_HEAVY_SPEED_MULT) ? CONFIG.PLAYER_CARRY_HEAVY_SPEED_MULT : 0.72);
        speedMult = Math.min(speedMult, mult);

        const defaultDisable = CONFIG.PLAYER_CARRY_HEAVY_DISABLE_SPRINT === true;
        const disable = mission.params?.carryDisableSprint === false ? false : defaultDisable;
        if (disable) sprintDisabled = true;
      }

      player.setMoveModifiers({ speedMult, sprintDisabled });
    }, { order: 18 });

    systems.add('player', (dt, ctx) => {
      if (this.gameState?.gameOver) return;
      if (!this.player?.update) return;
      this.player.update(dt, !!ctx.autopilotActive, ctx.externalCommand || null);
      ctx.playerPos = this.player.getPosition ? this.player.getPosition() : null;
      ctx.forcedInteractId = this.player.getForcedInteractId ? this.player.getForcedInteractId() : null;
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

    systems.add('playerToolAI', (dt, ctx) => {
      if (this.gameState?.gameOver) return;
      this.playerToolAISystem?.setRefs?.({
        player: this.player,
        toolSystem: this.toolSystem,
        monsterManager: this.monsterManager,
        worldState: this.worldState,
        gameState: this.gameState,
        missionDirector: this.missionDirector,
        autopilot: this.autopilot,
        gun: this.gun
      });
      this.playerToolAISystem?.update?.(dt, ctx);
    }, { order: 35 });

    systems.add('projectiles', (dt) => {
      if (this.gameState?.gameOver) return;
      this.projectileManager?.update?.(dt);
    }, { order: 40 });

    systems.add('spawnDirector', (dt) => {
      if (this.gameState?.gameOver) return;
      this.spawnDirector?.update?.(dt);
    }, { order: 50 });

    systems.add('tools', (dt) => {
      if (this.gameState?.gameOver) return;
      this.toolSystem?.update?.(dt);
    }, { order: 55 });

    systems.add('devices', (dt) => {
      if (this.gameState?.gameOver) return;
      this.deviceManager?.update?.(dt);
    }, { order: 56 });

    systems.add('worldMarkers', (dt, ctx) => {
      if (this.gameState?.gameOver) return;
      this.worldMarkerSystem?.update?.(dt, ctx);
    }, { order: 57 });

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
      // If the player is intentionally idle (silent), do not let monsters "push" the player around.
      // Monster movement should resolve around the player instead.
      if (ctx?.autopilotActive || ctx?.hasPlayerMove) {
        this.separatePlayerFromMonsters(playerPos, dt);
      }
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

    systems.add('darkZones', () => {
      const ws = this.worldState;
      const ve = this.visualEffects;
      if (!ws || !ve) return;

      const playerPos = this.player?.getPosition?.() || null;
      if (!playerPos) return;

      const zones = typeof ws.getDarkZones === 'function'
        ? ws.getDarkZones()
        : (Array.isArray(ws.darkZones) ? ws.darkZones : []);
      let tMax = 0;
      if (Array.isArray(zones) && zones.length > 0) {
        const px = Number(playerPos.x) || 0;
        const pz = Number(playerPos.z) || 0;
        for (const zone of zones) {
          if (!zone) continue;
          const r = Number(zone.radius) || 0;
          if (!(r > 0)) continue;
          const cx = Number.isFinite(zone.x) ? zone.x : (Number.isFinite(zone.position?.x) ? zone.position.x : 0);
          const cz = Number.isFinite(zone.z) ? zone.z : (Number.isFinite(zone.position?.z) ? zone.position.z : 0);
          const dx = px - cx;
          const dz = pz - cz;
          const dist = Math.sqrt(dx * dx + dz * dz);
          if (dist >= r) continue;
          const t = 1 - (dist / r);
          if (t > tMax) tMax = t;
        }
      }

      const overlayMax = Number.isFinite(CONFIG.DARK_OVERLAY_MAX) ? CONFIG.DARK_OVERLAY_MAX : 0.75;
      ve.setDarkness?.(Math.max(0, Math.min(1, tMax * overlayMax)));

      const scene = this.sceneManager?.getScene?.() || this.sceneManager?.scene || null;
      const fog = scene?.fog || null;
      if (fog && typeof fog.density === 'number') {
        if (!Number.isFinite(this._darkZonesBaseFogDensity)) {
          this._darkZonesBaseFogDensity = Number(fog.density) || 0;
        }
        const base = Number(this._darkZonesBaseFogDensity) || 0;
        const multRaw = Number(CONFIG.DARK_FOG_MULT);
        const mult = Number.isFinite(multRaw) ? Math.max(1, Math.min(8, multRaw)) : 2.2;
        fog.density = base * (1 + (mult - 1) * tMax);
      }
    }, { order: 145 });

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
    const frameMs = now - this.lastTime;
    const deltaTime = frameMs / 1000; // Convert to seconds
    this.lastTime = now;

    try {
      // Update perf EMA (used for dynamic resolution)
      if (Number.isFinite(frameMs) && frameMs > 0) {
        const a = 0.06;
        this._perf.emaFrameMs = this._perf.emaFrameMs * (1 - a) + frameMs * a;
      }

      // Update game state
      const updateStart = performance.now();
      this.update(deltaTime, now);
      const updateMs = performance.now() - updateStart;

      // Dynamic resolution scaling to maintain target FPS
      if (CONFIG.RENDER_DYNAMIC_RESOLUTION && this.sceneManager?.setPixelRatio) {
        const dt = Math.max(0, Math.min(0.1, deltaTime));
        this._perf.adjustCooldown = Math.max(0, (this._perf.adjustCooldown || 0) - dt);
        if (this._perf.adjustCooldown <= 0) {
          const targetFps = Number.isFinite(CONFIG.RENDER_TARGET_FPS) ? CONFIG.RENDER_TARGET_FPS : 60;
          const ema = Math.max(1, Number(this._perf.emaFrameMs) || 16.67);
          const fps = 1000 / ema;
          const ratio = this.sceneManager.pixelRatio || 1.0;
          const step = 0.05;
          const downThreshold = targetFps - 5;
          const upThreshold = targetFps + 10;

          if (fps < downThreshold) {
            this.sceneManager.setPixelRatio(ratio - step);
            this._perf.adjustCooldown = 0.9;
          } else if (fps > upThreshold) {
            this.sceneManager.setPixelRatio(ratio + step);
            this._perf.adjustCooldown = 1.6;
          } else {
            this._perf.adjustCooldown = 0.6;
          }
        }
      }

      // Render scene
      const renderStart = performance.now();
      this.render();
      const renderMs = performance.now() - renderStart;

      const ema = Math.max(1, Number(this._perf.emaFrameMs) || 16.67);
      const fpsEma = 1000 / ema;

      this.applyPerformanceGuard(deltaTime, fpsEma);
      this.applyWatchdog(deltaTime, fpsEma);

      this.sceneManager?.setFrameStats?.({
        frameMs: Number.isFinite(frameMs) ? frameMs : 0,
        updateMs,
        renderMs,
        fpsEma
      });
    } catch (err) {
      // If an exception bubbles out of update/render, it would otherwise kill the RAF chain and "freeze" the game.
      const msg = String(err?.message || err || 'Unknown loop error');
      const at = Number(this._lastLoopErrorAtMs) || 0;
      if (!Number.isFinite(this._loopErrorCount)) this._loopErrorCount = 0;
      if (now - at > 1000) {
        this._loopErrorCount = 0;
      }
      this._loopErrorCount += 1;
      this._lastLoopErrorAtMs = now;

      if (this._loopErrorCount <= 3) {
        console.error('💥 GameLoop frame failed:', msg, err);
      } else if (this._loopErrorCount === 4) {
        console.error('💥 GameLoop frame continues failing (muting further logs for 1s)…', msg);
      }
      const bus = this.gameState?.eventBus || null;
      bus?.emit?.(EVENTS.UI_TOAST, { text: `Loop error: ${msg}`, seconds: 2.5 });
    } finally {
      // Request next frame (keep the loop alive unless explicitly stopped).
      if (this.running) {
        this.rafId = requestAnimationFrame(() => this.loop());
      }
    }
  }

  applyPerformanceGuard(deltaTime, fpsEma) {
    const dt = Math.max(0, Math.min(0.25, Number(deltaTime) || 0));
    const targetFps = Number.isFinite(CONFIG.RENDER_TARGET_FPS) ? CONFIG.RENDER_TARGET_FPS : 60;
    const perf = this._perf || (this._perf = {});

    perf.guardCooldown = Math.max(0, (perf.guardCooldown || 0) - dt);
    if (perf.guardCooldown > 0) return;

    const lowThreshold = targetFps - 6;
    const highThreshold = targetFps + 8;

    if (Number.isFinite(fpsEma) && fpsEma < lowThreshold) {
      perf.lowFpsTimer = (perf.lowFpsTimer || 0) + dt;
      perf.highFpsTimer = 0;
    } else if (Number.isFinite(fpsEma) && fpsEma > highThreshold) {
      perf.highFpsTimer = (perf.highFpsTimer || 0) + dt;
      perf.lowFpsTimer = 0;
    } else {
      perf.lowFpsTimer = 0;
      perf.highFpsTimer = 0;
    }

    let tier = Math.max(0, Math.min(2, perf.guardTier || 0));
    if ((perf.lowFpsTimer || 0) >= 1.6 && tier < 2) {
      tier += 1;
      perf.guardCooldown = 1.25;
      perf.lowFpsTimer = 0;
    } else if ((perf.highFpsTimer || 0) >= 5.0 && tier > 0) {
      tier -= 1;
      perf.guardCooldown = 2.0;
      perf.highFpsTimer = 0;
    } else {
      perf.guardCooldown = 0.5;
    }

    if (tier === (perf.guardTier || 0)) return;
    perf.guardTier = tier;

    const baseCull = Number(perf.defaults?.monsterCullTiles) || 22;
    const baseFarTick = Number(perf.defaults?.farTickSeconds) || 0.35;
    const baseMinimap = Number(perf.defaults?.minimapInterval) || 0.25;

    if (tier === 0) {
      CONFIG.MONSTER_RENDER_CULL_DISTANCE_TILES = baseCull;
      CONFIG.MONSTER_AI_FAR_TICK_SECONDS = baseFarTick;
      this.minimapInterval = baseMinimap;
    } else if (tier === 1) {
      CONFIG.MONSTER_RENDER_CULL_DISTANCE_TILES = Math.max(12, Math.round(baseCull - 6));
      CONFIG.MONSTER_AI_FAR_TICK_SECONDS = Math.max(baseFarTick, 0.55);
      this.minimapInterval = Math.max(baseMinimap, 0.35);
    } else {
      CONFIG.MONSTER_RENDER_CULL_DISTANCE_TILES = Math.max(10, Math.round(baseCull - 10));
      CONFIG.MONSTER_AI_FAR_TICK_SECONDS = Math.max(baseFarTick, 0.8);
      this.minimapInterval = Math.max(baseMinimap, 0.5);
    }
  }

  applyWatchdog(deltaTime, fpsEma) {
    if (CONFIG.WATCHDOG_ENABLED === false) return;
    const w = this._watchdog || (this._watchdog = {});
    if (w.tripped) return;

    const dtRaw = Number(deltaTime) || 0;
    const dt = Math.max(0, Math.min(0.5, dtRaw));
    const lowFps = Number(CONFIG.WATCHDOG_LOW_FPS_THRESHOLD) || 18;
    const lowFpsSec = Number(CONFIG.WATCHDOG_LOW_FPS_SECONDS) || 3.0;
    const spikeDt = Number(CONFIG.WATCHDOG_DT_SPIKE_THRESHOLD) || 0.22;
    const spikeSec = Number(CONFIG.WATCHDOG_DT_SPIKE_SECONDS) || 1.2;

    if (Number.isFinite(fpsEma) && fpsEma < lowFps) {
      w.lowFpsSeconds = (w.lowFpsSeconds || 0) + dt;
    } else {
      w.lowFpsSeconds = Math.max(0, (w.lowFpsSeconds || 0) - dt * 0.5);
    }

    if (dt >= spikeDt) {
      w.spikeSeconds = (w.spikeSeconds || 0) + dt;
    } else {
      w.spikeSeconds = Math.max(0, (w.spikeSeconds || 0) - dt);
    }

    if ((w.lowFpsSeconds || 0) >= lowFpsSec) {
      w.tripped = true;
      w.reason = `low_fps:${Number.isFinite(fpsEma) ? fpsEma.toFixed(1) : 'n/a'}`;
    } else if ((w.spikeSeconds || 0) >= spikeSec) {
      w.tripped = true;
      w.reason = `dt_spike:${dt.toFixed(3)}`;
    }

    if (w.tripped && typeof this.onWatchdogTrip === 'function') {
      this.onWatchdogTrip({
        reason: w.reason,
        fpsEma: Number.isFinite(fpsEma) ? fpsEma : null,
        dt
      });
    }
  }

  getWatchdogSnapshot() {
    const w = this._watchdog || {};
    return {
      tripped: !!w.tripped,
      reason: w.reason || null,
      lowFpsSeconds: Number(w.lowFpsSeconds) || 0,
      spikeSeconds: Number(w.spikeSeconds) || 0
    };
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
      const dt = this.frameContext?.dt ?? 0;
      this.minimapAccumulator = (this.minimapAccumulator || 0) + Math.max(0, dt);
      const interval = Math.max(0, this.minimapInterval ?? 0);
      if (interval > 0 && this.minimapAccumulator < interval) {
        return;
      }
      if (interval > 0) {
        // Keep leftover time to reduce drift on low FPS.
        this.minimapAccumulator = this.minimapAccumulator % interval;
      }
      const playerGridPos = this.player.getGridPosition();
      const monsterPositions = this.monsterManager ? this.monsterManager.getMonsterPositions() : [];
      const exitPosition = this.exitPoint ? this.exitPoint.getGridPosition() : null;
      const missionPositions = this.missionDirector?.getAutopilotTargets
        ? this.missionDirector.getAutopilotTargets().map(t => t.gridPos)
        : [];
      const pickupPositions = this.spawnDirector?.pickupManager?.getPickupMarkers
        ? this.spawnDirector.pickupManager.getPickupMarkers()
        : [];
      const devicePositions = [
        ...(this.toolSystem?.getDeviceMarkers ? this.toolSystem.getDeviceMarkers() : []),
        ...(this.deviceManager?.getDeviceMarkers ? this.deviceManager.getDeviceMarkers() : []),
      ];
      this.minimap.render(playerGridPos, monsterPositions, exitPosition, missionPositions, {
        pickupPositions,
        devicePositions,
        navHeat: (CONFIG.DEBUG_NAV_HEATMAP_ENABLED ?? false) ? (this.worldState?.getNavHeat?.() || null) : null,
        aiMarkers: (CONFIG.DEBUG_AI_MARKERS_ENABLED !== false && this.monsterManager?.getAIDebugMinimapMarkers)
          ? this.monsterManager.getAIDebugMinimapMarkers({
            onlyChasing: CONFIG.DEBUG_AI_FILTER_CHASE_ONLY === true,
            onlyLeader: CONFIG.DEBUG_AI_FILTER_LEADER_ONLY === true,
            nearestN: Number(CONFIG.DEBUG_AI_FILTER_NEAREST_N) || 0
          })
          : null
      });
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
  separatePlayerFromMonsters(playerPos, dt = 1 / (CONFIG.TARGET_FPS || 60)) {
    if (!this.monsterManager || !this.player) return;
    if (typeof this.player?.isHidden === 'function' && this.player.isHidden()) return;
    const monsters = this.monsterManager.getMonsters ? this.monsterManager.getMonsters() : [];
    if (!monsters || monsters.length === 0) return;

    const tileSize = CONFIG.TILE_SIZE || 1;
    // Only separate if actually overlapping; monsters already treat the player as a solid obstacle.
    const playerRadius = CONFIG.PLAYER_RADIUS ?? 0.35;
    const monsterRadius = (CONFIG.PLAYER_RADIUS ?? 0.35) * 0.9;
    const minDist = Math.max(0.01, playerRadius + monsterRadius + 0.05);
    const px = playerPos.x;
    const pz = playerPos.z;

    // Accumulate overlaps into a single push vector to avoid oscillation from sequential teleports.
    let pushX = 0;
    let pushZ = 0;
    let hits = 0;

    for (let i = 0; i < monsters.length; i++) {
      const monster = monsters[i];
      const mPos = monster?.getWorldPosition ? monster.getWorldPosition() : null;
      if (!mPos) continue;

      const dx = px - mPos.x;
      const dz = pz - mPos.z;
      const dist = Math.hypot(dx, dz);
      if (!Number.isFinite(dist) || dist >= minDist) continue;

      if (dist <= 0.0001) {
        // Rare degenerate overlap: nudge in a stable direction based on index.
        const angle = (i * 2.399963229728653) % (Math.PI * 2);
        pushX += Math.cos(angle) * minDist;
        pushZ += Math.sin(angle) * minDist;
        hits++;
        continue;
      }

      const overlap = minDist - dist;
      const inv = 1 / dist;
      pushX += dx * inv * overlap;
      pushZ += dz * inv * overlap;
      hits++;
    }

    if (hits <= 0) return;

    // Soften and clamp the push to avoid visible "jump tiles" on narrow corridors.
    const soften = 0.55;
    pushX *= soften;
    pushZ *= soften;

    const mag = Math.hypot(pushX, pushZ);
    if (!Number.isFinite(mag) || mag <= 1e-8) return;

    const baseFrame = 1 / (CONFIG.TARGET_FPS || 60);
    const dtScale = Math.max(0.5, Math.min(2.0, dt / baseFrame));
    const maxPush = tileSize * 0.14 * dtScale;
    if (mag > maxPush) {
      pushX = (pushX / mag) * maxPush;
      pushZ = (pushZ / mag) * maxPush;
    }

    if (typeof this.player.applyDisplacement === 'function') {
      this.player.applyDisplacement(pushX, pushZ, { separateFromWalls: false });
      return;
    }

    // Fallback: best-effort nudge without triggering large relocation.
    const canMoveTo = (x, z) => {
      if (typeof this.player?.canMoveTo === 'function') return this.player.canMoveTo(x, z);
      if (this.worldState && this.worldState.isWalkable) {
        const gx = Math.floor(x / tileSize);
        const gy = Math.floor(z / tileSize);
        return this.worldState.isWalkable(gx, gy);
      }
      return true;
    };

    let tx = px + pushX;
    let tz = pz + pushZ;
    if (!canMoveTo(tx, tz)) {
      if (canMoveTo(px + pushX, pz)) {
        tz = pz;
      } else if (canMoveTo(px, pz + pushZ)) {
        tx = px;
      } else {
        return;
      }
    }

    this.player.setPosition(tx, playerPos.y, tz);
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
