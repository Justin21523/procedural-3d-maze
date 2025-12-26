import { CONFIG } from '../core/config.js';
import { EVENTS } from '../core/events.js';
import { ROOM_CONFIGS } from '../world/tileTypes.js';

export class UIManager {
  constructor(options = {}) {
    this.eventBus = options.eventBus || null;
    this.player = options.player || null;
    this.worldState = options.worldState || null;
    this.gameState = options.gameState || null;
    this.gun = options.gun || null;

    // Crosshair pulses
    this.crosshairEl = document.getElementById('crosshair');
    this.crosshairPulse = 0;
    this.crosshairHitPulse = 0;
    this.crosshairKillPulse = 0;

    // HUD elements
    this.positionElement = document.getElementById('position');
    this.currentRoomElement = document.getElementById('current-room');
    this.missionElement = document.getElementById('mission-status');
    this.missionObjectiveElement = document.getElementById('mission-objective');
    this.gameTimeElement = document.getElementById('game-time');
    this.healthDisplayElement = document.getElementById('health-display');
    this.healthFillElement = document.getElementById('health-fill');
    this.weaponElement = document.getElementById('hud-weapon');
    this.ammoElement = document.getElementById('hud-ammo');
    this.weaponModeElement = document.getElementById('hud-mode');
    this.weaponReloadElement = document.getElementById('hud-reload');
    this.skillQElement = document.getElementById('hud-skill-q');
    this.skillXElement = document.getElementById('hud-skill-x');
    this.pointerElement = document.getElementById('pointer-status');
    this.keysElement = document.getElementById('keys-pressed');

    // FPS
    this.fpsElement = document.getElementById('fps');
    this.frameCount = 0;
    this.lastFpsUpdate = 0;
    this.fps = 0;

    // Game over overlay
    this.gameOverElement = document.getElementById('game-over');
    this.gameOverTitleElement = document.getElementById('game-over-title');
    this.gameOverMessageElement = document.getElementById('game-over-message');
    this.finalTimeElement = document.getElementById('final-time');
    this.finalHealthElement = document.getElementById('final-health');
    this.finalRoomsElement = document.getElementById('final-rooms');
    this.finalStepsElement = document.getElementById('final-steps');

    // Interaction prompt (center screen)
    this.interactPromptElement = document.getElementById('interact-prompt');
    this.interactHoverText = '';
    this.interactFlashText = '';
    this.interactFlashTimer = 0;
    this.lastInteractPromptText = null;
    this.lastInteractPromptHidden = null;

    this.unsubscribers = [];
    this.bindEvents();
  }

  bindEvents() {
    this.unsubscribers.forEach((fn) => fn?.());
    this.unsubscribers = [];

    if (!this.eventBus?.on) return;

    this.unsubscribers.push(
      this.eventBus.on(EVENTS.WEAPON_FIRED, () => {
        if (!CONFIG.PLAYER_CROSSHAIR_ENABLED) return;
        if (!this.crosshairEl) return;
        this.crosshairPulse = 0.08;
        this.crosshairEl.classList.add('pulse');
      })
    );

    this.unsubscribers.push(
      this.eventBus.on(EVENTS.PLAYER_HIT_MONSTER, (payload) => {
        if (!CONFIG.PLAYER_CROSSHAIR_ENABLED) return;
        if (!this.crosshairEl) return;
        void payload;
        this.crosshairHitPulse = 0.12;
        this.crosshairEl.classList.add('hit');
      })
    );

    this.unsubscribers.push(
      this.eventBus.on(EVENTS.MONSTER_KILLED, (payload) => {
        if (!CONFIG.PLAYER_CROSSHAIR_ENABLED) return;
        if (!this.crosshairEl) return;
        if (payload?.cause !== 'player') return;
        this.crosshairKillPulse = 0.14;
        this.crosshairEl.classList.add('kill');
      })
    );

    this.unsubscribers.push(
      this.eventBus.on(EVENTS.GAME_WON, (payload) => {
        this.showGameOver(true, payload?.reason);
      })
    );

    this.unsubscribers.push(
      this.eventBus.on(EVENTS.GAME_LOST, (payload) => {
        this.showGameOver(false, payload?.reason);
      })
    );

    this.unsubscribers.push(
      this.eventBus.on(EVENTS.INTERACTABLE_HOVER, (payload) => {
        const text = String(payload?.text || '');
        this.setInteractHoverText(text);
      })
    );

    this.unsubscribers.push(
      this.eventBus.on(EVENTS.EXIT_LOCKED, (payload) => {
        const msg = String(payload?.message || 'Exit locked');
        this.flashInteractPrompt(msg, 1.2);
      })
    );

    this.unsubscribers.push(
      this.eventBus.on(EVENTS.MISSION_UPDATED, (payload) => {
        const objective = payload?.objectiveText ?? payload?.summary ?? '';
        if (this.missionObjectiveElement) {
          this.missionObjectiveElement.textContent = objective ? String(objective) : '—';
        }
      })
    );
  }

  setRefs({ player, worldState, gameState, gun } = {}) {
    if (player) this.player = player;
    if (worldState) this.worldState = worldState;
    if (gameState) this.gameState = gameState;
    if (gun) this.gun = gun;
  }

  setEventBus(eventBus) {
    this.eventBus = eventBus;
    this.bindEvents();
  }

  update(deltaTime, nowMs = null) {
    const dt = deltaTime ?? 0;
    if (dt <= 0) return;

    const now = Number.isFinite(nowMs) ? nowMs : performance.now();
    this.updateFPS(now);
    this.updateCrosshairPulse(dt);
    this.updateInteractPrompt(dt);
    this.updateHud();
  }

  setInteractHoverText(text) {
    this.interactHoverText = String(text || '');
    this.renderInteractPrompt();
  }

  flashInteractPrompt(text, seconds = 1.1) {
    this.interactFlashText = String(text || '');
    this.interactFlashTimer = Math.max(0.2, Number(seconds) || 1.1);
    this.renderInteractPrompt();
  }

  updateInteractPrompt(dt) {
    this.interactFlashTimer = Math.max(0, (this.interactFlashTimer || 0) - dt);
    if (this.interactFlashTimer <= 0) {
      this.interactFlashText = '';
    }
    this.renderInteractPrompt();
  }

  renderInteractPrompt() {
    const el = this.interactPromptElement;
    if (!el) return;

    const text = this.interactHoverText || this.interactFlashText || '';
    const hidden = !text;
    if (this.lastInteractPromptHidden !== hidden) {
      if (hidden) el.classList.add('hidden');
      else el.classList.remove('hidden');
      this.lastInteractPromptHidden = hidden;
    }
    if (this.lastInteractPromptText !== text) {
      el.textContent = text;
      this.lastInteractPromptText = text;
    }
  }

  updateFPS(nowMs) {
    this.frameCount++;
    if (this.lastFpsUpdate === 0) {
      this.lastFpsUpdate = nowMs;
      return;
    }
    if (nowMs - this.lastFpsUpdate < 1000) return;

    this.fps = this.frameCount;
    this.frameCount = 0;
    this.lastFpsUpdate = nowMs;

    if (this.fpsElement) {
      this.fpsElement.textContent = this.fps;
    }
  }

  updateCrosshairPulse(dt) {
    if (!this.crosshairEl) return;
    if (!CONFIG.PLAYER_CROSSHAIR_ENABLED) {
      this.crosshairEl.classList.remove('pulse', 'hit', 'kill');
      this.crosshairPulse = 0;
      this.crosshairHitPulse = 0;
      this.crosshairKillPulse = 0;
      return;
    }

    this.crosshairPulse = Math.max(0, this.crosshairPulse - dt);
    if (this.crosshairPulse <= 0) {
      this.crosshairEl.classList.remove('pulse');
    }

    this.crosshairHitPulse = Math.max(0, this.crosshairHitPulse - dt);
    if (this.crosshairHitPulse <= 0) {
      this.crosshairEl.classList.remove('hit');
    }

    this.crosshairKillPulse = Math.max(0, this.crosshairKillPulse - dt);
    if (this.crosshairKillPulse <= 0) {
      this.crosshairEl.classList.remove('kill');
    }
  }

  updateHud() {
    if (this.positionElement && this.player?.getPosition && this.player?.getGridPosition) {
      const pos = this.player.getPosition();
      const gridPos = this.player.getGridPosition();
      this.positionElement.textContent =
        `${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)} | Grid: ${gridPos.x}, ${gridPos.y}`;
    }

    if (this.currentRoomElement && this.worldState && this.player?.getGridPosition) {
      const gridPos = this.player.getGridPosition();
      const roomType = this.worldState.getRoomType(gridPos.x, gridPos.y);
      const roomConfig = ROOM_CONFIGS[roomType];
      if (roomConfig) {
        this.currentRoomElement.textContent = roomConfig.name;
      }
    }

    if (this.missionElement && this.gameState) {
      this.missionElement.textContent = `${this.gameState.missionsCollected}/${this.gameState.missionsTotal}`;
    }

    if (this.gameTimeElement && this.gameState?.getFormattedTime) {
      this.gameTimeElement.textContent = this.gameState.getFormattedTime();
    }

    if (this.healthDisplayElement && this.gameState) {
      this.healthDisplayElement.textContent = this.gameState.currentHealth;
    }

    if (this.healthFillElement && this.gameState?.getHealthPercentage) {
      const healthPercent = this.gameState.getHealthPercentage();
      this.healthFillElement.style.width = `${healthPercent}%`;
    }

    // Weapon HUD
    const hud = this.gun?.getHudState ? this.gun.getHudState() : null;
    if (hud) {
      if (this.weaponElement) {
        this.weaponElement.textContent = hud.weaponName || '—';
      }
      if (this.ammoElement) {
        const mag = Number.isFinite(hud.magSize) && hud.magSize > 0 ? hud.magSize : 0;
        if (mag > 0) {
          this.ammoElement.textContent = `${hud.ammoInMag}/${mag} (${hud.ammoReserve})`;
        } else {
          this.ammoElement.textContent = `${hud.ammoInMag}/${hud.ammoReserve}`;
        }
      }
      if (this.weaponModeElement) {
        this.weaponModeElement.textContent = hud.modeLabel || '—';
      }
      if (this.weaponReloadElement) {
        if (hud.isReloading) {
          const pct = Number.isFinite(hud.reloadProgress) ? Math.round(hud.reloadProgress * 100) : 0;
          this.weaponReloadElement.textContent = `Reloading ${pct}%`;
        } else {
          this.weaponReloadElement.textContent = '';
        }
      }

      const fmtSkill = (seconds) => {
        const s = Number.isFinite(seconds) ? seconds : 0;
        return s > 0 ? `${s.toFixed(1)}s` : 'Ready';
      };
      if (this.skillQElement) {
        this.skillQElement.textContent = fmtSkill(hud.skills?.grenade ?? 0);
      }
      if (this.skillXElement) {
        this.skillXElement.textContent = fmtSkill(hud.skills?.emp ?? 0);
      }
    }

    if (this.keysElement && this.player?.input) {
      const keys = [];
      if (this.player.input.isKeyPressed?.('KeyW')) keys.push('W');
      if (this.player.input.isKeyPressed?.('KeyA')) keys.push('A');
      if (this.player.input.isKeyPressed?.('KeyS')) keys.push('S');
      if (this.player.input.isKeyPressed?.('KeyD')) keys.push('D');
      if (this.player.input.isSprinting?.()) keys.push('Shift');
      if (this.player.isBlocking?.()) keys.push('Block');
      this.keysElement.textContent = keys.length > 0 ? keys.join(', ') : 'None';
    }

    if (this.pointerElement && this.player?.input?.isPointerLocked) {
      this.pointerElement.textContent = this.player.input.isPointerLocked() ? 'Locked ✓' : 'Not Locked';
    }
  }

  showGameOver(won, reason = null) {
    if (!this.gameOverElement) return;

    if (this.gameOverTitleElement && this.gameOverMessageElement) {
      if (won) {
        this.gameOverTitleElement.textContent = '🎉 Victory!';
        this.gameOverTitleElement.style.color = '#ffd700';
        this.gameOverMessageElement.textContent = reason || 'You escaped the maze!';
      } else {
        this.gameOverTitleElement.textContent = '💀 Defeat';
        this.gameOverTitleElement.style.color = '#ff4444';
        this.gameOverMessageElement.textContent = reason || 'You ran out of health...';
      }
    }

    // Update stats
    if (this.gameState?.getStats) {
      const stats = this.gameState.getStats();
      if (this.finalTimeElement) this.finalTimeElement.textContent = stats.timeFormatted;
      if (this.finalHealthElement) this.finalHealthElement.textContent = stats.health;
      if (this.finalRoomsElement) this.finalRoomsElement.textContent = stats.roomsVisited;
      if (this.finalStepsElement) this.finalStepsElement.textContent = stats.steps;
    }

    this.gameOverElement.classList.remove('hidden');

    // Release pointer lock
    if (this.player?.input?.exitPointerLock) {
      this.player.input.exitPointerLock();
    }

    console.log(won ? '🎉 Victory!' : '💀 Game Over');
  }

  dispose() {
    this.unsubscribers.forEach((fn) => fn?.());
    this.unsubscribers = [];
  }
}
