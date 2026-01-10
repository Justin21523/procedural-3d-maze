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
    this.monsterManager = options.monsterManager || null;
    this.projectileManager = options.projectileManager || null;
    this.toolSystem = options.toolSystem || null;
    this.pickupManager = options.pickupManager || null;
    this.missionDirector = options.missionDirector || null;
    this.sceneManager = options.sceneManager || null;

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
    this.inventoryElement = document.getElementById('hud-inventory');
    this.toolsElement = document.getElementById('hud-tools');
    this.throwablesElement = document.getElementById('hud-throwables');

    // FPS
    this.fpsElement = document.getElementById('fps');
    this.debugCountsElement = document.getElementById('debug-counts');
    this.frameCount = 0;
    this.lastFpsUpdate = 0;
    this.fps = 0;

    // Throttle heavy HUD DOM updates (position, inventory, ammo, etc.)
    this.hudAccumulator = 0;
    this.hudIntervalSeconds = 0.1; // 10 Hz

    // Noise meter (player noise feedback)
    this.noiseFillElement = document.getElementById('noise-fill');
    this.noiseLastAtMs = 0;
    this.noiseLastStrength = 0;
    this.noiseDecaySeconds = 1.35;

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

    // Puzzle UI: keypad input mode (captures digit keys without triggering weapon binds)
    this.keypadMode = null; // { keypadId, codeLength }
    this.keypadBuffer = '';
    this.keypadSubmitting = false;
    this.keypadPrevAutopilotEnabled = null;
    this._keypadKeydownCapture = (e) => this.onKeypadKeydownCapture(e);
    window.addEventListener('keydown', this._keypadKeydownCapture, true);

    this.unsubscribers = [];
    this.bindEvents();
  }

  bindEvents() {
    this.unsubscribers.forEach((fn) => fn?.());
    this.unsubscribers = [];

    if (!this.eventBus?.on) return;

    const templateLabel = (template) => {
      const key = String(template || '').trim();
      const map = {
        findKeycard: 'Find Keycard',
        collectEvidence: 'Collect Evidence',
        restorePower: 'Restore Power',
        activateShrines: 'Activate Shrines',
        restorePowerFuses: 'Restore Power (Fuses)',
        uploadEvidence: 'Upload Evidence',
        codeLock: 'Code Lock',
        lockedDoor: 'Unlock Door',
        placeItemsAtAltars: 'Place Items',
        searchRoomTypeN: 'Search Rooms',
        photographEvidence: 'Photograph Evidence',
        deliverItemToTerminal: 'Deliver Packages',
        switchSequence: 'Switch Sequence',
        hideForSeconds: 'Hide',
        escort: 'Escort',
        surviveTimer: 'Survive',
        surviveNoDamage: 'Avoid Damage',
        enterRoomType: 'Enter Rooms',
        enterRoomSequence: 'Room Sequence',
        killCount: 'Defeat Monsters',
        stealthNoise: 'Stay Quiet',
        unlockExit: 'Unlock Exit'
      };
      return map[key] || key || 'Objective';
    };

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
      this.eventBus.on(EVENTS.UI_TOAST, (payload) => {
        const text = String(payload?.text || '');
        if (!text) return;
        const seconds = Number.isFinite(payload?.seconds) ? payload.seconds : 1.8;
        this.flashInteractPrompt(text, seconds);
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

    this.unsubscribers.push(
      this.eventBus.on(EVENTS.MISSION_COMPLETED, (payload) => {
        if (payload?.required === false) return;
        const label = templateLabel(payload?.template);
        this.flashInteractPrompt(`Objective complete: ${label}`, 1.7);
      })
    );

    this.unsubscribers.push(
      this.eventBus.on(EVENTS.MISSION_FAILED, (payload) => {
        const label = templateLabel(payload?.template);
        const reason = String(payload?.reason || '').trim();
        const msg = reason ? `Objective failed: ${label} (${reason})` : `Objective failed: ${label}`;
        this.flashInteractPrompt(msg, 1.9);
      })
    );

    this.unsubscribers.push(
      this.eventBus.on(EVENTS.MISSION_STARTED, () => {
        this.closeKeypadInput();
      })
    );

    this.unsubscribers.push(
      this.eventBus.on(EVENTS.INTERACT, (payload) => {
        if (payload?.actorKind !== 'player') return;
        if (payload?.kind !== 'keypad') return;
        if (!payload?.result?.openKeypad) return;

        const keypadId = String(payload?.id || '').trim();
        if (!keypadId) return;
        const codeLength = Number(payload?.result?.codeLength);
        this.openKeypadInput({ keypadId, codeLength });
      })
    );

    this.unsubscribers.push(
      this.eventBus.on(EVENTS.KEYPAD_CODE_RESULT, (payload) => {
        if (payload?.actorKind !== 'player') return;
        const keypadId = String(payload?.keypadId || '').trim();
        if (!keypadId) return;
        if (this.keypadMode?.keypadId !== keypadId) return;

        this.keypadSubmitting = false;
        if (payload?.ok) {
          this.closeKeypadInput();
        } else {
          this.keypadBuffer = '';
          this.renderInteractPrompt();
        }
      })
    );

    this.unsubscribers.push(
      this.eventBus.on(EVENTS.NOISE_EMITTED, (payload) => {
        if (payload?.source !== 'player') return;
        const strengthRaw = Number(payload?.strength);
        if (!Number.isFinite(strengthRaw)) return;
        const strength = Math.max(0, Math.min(1, strengthRaw));
        this.noiseLastStrength = Math.max(this.noiseLastStrength || 0, strength);
        this.noiseLastAtMs = performance.now();
      })
    );
  }

  setRefs({ player, worldState, gameState, gun, monsterManager, projectileManager, toolSystem, pickupManager, missionDirector } = {}) {
    if (player) this.player = player;
    if (worldState) this.worldState = worldState;
    if (gameState) this.gameState = gameState;
    if (gun) this.gun = gun;
    if (monsterManager) this.monsterManager = monsterManager;
    if (projectileManager) this.projectileManager = projectileManager;
    if (toolSystem) this.toolSystem = toolSystem;
    if (pickupManager) this.pickupManager = pickupManager;
    if (missionDirector) this.missionDirector = missionDirector;
  }

  setEventBus(eventBus) {
    this.eventBus = eventBus;
    this.bindEvents();
  }

  update(deltaTime, nowMs = null) {
    const dt = deltaTime ?? 0;
    if (dt <= 0) return;

    const now = Number.isFinite(nowMs) ? nowMs : performance.now();
    if (this.player?.input?.consumeKeyPress?.('KeyH')) {
      this.eventBus?.emit?.(EVENTS.MISSION_HINT_REQUESTED, { nowMs: now, actorKind: 'player' });
    }
    this.updateFPS(now);
    this.updateCrosshairPulse(dt);
    this.updateInteractPrompt(dt);
    this.updateNoiseMeter(dt, now);

    this.hudAccumulator = (this.hudAccumulator || 0) + dt;
    if (this.hudAccumulator >= (this.hudIntervalSeconds || 0.1)) {
      // Keep leftover time to reduce drift on low FPS.
      const interval = Math.max(0.05, this.hudIntervalSeconds || 0.1);
      this.hudAccumulator = this.hudAccumulator % interval;
      this.updateHud();
    }
  }

  updateNoiseMeter(deltaTime, nowMs) {
    if (!this.noiseFillElement) return;
    const now = Number.isFinite(nowMs) ? nowMs : performance.now();
    const lastAt = Number(this.noiseLastAtMs) || 0;
    const lastStrength = Number(this.noiseLastStrength) || 0;

    const ageSec = Math.max(0, (now - lastAt) / 1000);
    const decay = Math.max(0.1, Number(this.noiseDecaySeconds) || 1.2);
    const t = 1 - (ageSec / decay);
    const level = Math.max(0, Math.min(1, lastStrength * t));
    const pct = Math.round(level * 100);
    this.noiseFillElement.style.width = `${pct}%`;
    if (level <= 0.001 && ageSec > decay) {
      this.noiseLastStrength = 0;
    }
    void deltaTime;
  }

  openKeypadInput({ keypadId, codeLength } = {}) {
    const id = String(keypadId || '').trim();
    if (!id) return;
    if (!this.keypadMode?.keypadId) {
      this.keypadPrevAutopilotEnabled = CONFIG.AUTOPILOT_ENABLED;
      CONFIG.AUTOPILOT_ENABLED = false;
    }
    const len = Number.isFinite(codeLength) ? Math.max(1, Math.floor(codeLength)) : 3;
    this.keypadMode = { keypadId: id, codeLength: len };
    this.keypadBuffer = '';
    this.keypadSubmitting = false;
    this.renderInteractPrompt();
  }

  closeKeypadInput() {
    this.keypadMode = null;
    this.keypadBuffer = '';
    this.keypadSubmitting = false;
    if (this.keypadPrevAutopilotEnabled !== null) {
      CONFIG.AUTOPILOT_ENABLED = this.keypadPrevAutopilotEnabled;
      this.keypadPrevAutopilotEnabled = null;
    }
    this.renderInteractPrompt();
  }

  getKeypadPromptText() {
    if (!this.keypadMode?.keypadId) return '';
    const len = Number(this.keypadMode.codeLength) || 0;
    const buf = String(this.keypadBuffer || '');
    const padded = len > 0
      ? (buf + '_'.repeat(Math.max(0, len - buf.length))).slice(0, len)
      : buf;
    const status = this.keypadSubmitting ? 'Submitting…' : 'Enter=OK Backspace=Del E=Exit';
    return `Keypad: ${padded} (${status})`;
  }

  codeToDigit(code) {
    const c = String(code || '');
    if (c.length === 6 && c.startsWith('Digit')) {
      const d = c.slice(5);
      if (d >= '0' && d <= '9') return d;
    }
    if (c.length === 7 && c.startsWith('Numpad')) {
      const d = c.slice(6);
      if (d >= '0' && d <= '9') return d;
    }
    return null;
  }

  onKeypadKeydownCapture(e) {
    if (!this.keypadMode?.keypadId) return;
    if (!e?.code) return;

    if (this.player?.input) {
      this.player.input.lastInputTime = performance.now();
    }

    const codeLength = Number(this.keypadMode.codeLength) || 0;
    const digit = this.codeToDigit(e.code);

    if (digit !== null) {
      if (!this.keypadSubmitting && (this.keypadBuffer.length < codeLength || codeLength <= 0)) {
        this.keypadBuffer += digit;
        if (codeLength > 0) this.keypadBuffer = this.keypadBuffer.slice(0, codeLength);
        this.renderInteractPrompt();
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }

    if (e.code === 'Backspace') {
      if (!this.keypadSubmitting) {
        if (this.keypadBuffer.length > 0) {
          this.keypadBuffer = this.keypadBuffer.slice(0, -1);
          this.renderInteractPrompt();
        } else {
          this.closeKeypadInput();
        }
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }

    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      if (this.keypadSubmitting) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      if (codeLength > 0 && this.keypadBuffer.length !== codeLength) {
        this.eventBus?.emit?.(EVENTS.UI_TOAST, {
          text: `Enter ${codeLength} digits.`,
          seconds: 1.4
        });
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      this.keypadSubmitting = true;
      this.eventBus?.emit?.(EVENTS.KEYPAD_CODE_SUBMITTED, {
        actorKind: 'player',
        keypadId: this.keypadMode.keypadId,
        code: String(this.keypadBuffer || ''),
        nowMs: performance.now()
      });
      this.renderInteractPrompt();
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }

    if (e.code === 'Escape' || e.code === 'KeyE') {
      this.closeKeypadInput();
      e.preventDefault();
      e.stopImmediatePropagation();
    }
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

    const keypadText = this.getKeypadPromptText();
    const baseText = keypadText || this.interactHoverText || '';
    const text = this.interactFlashText || baseText || '';
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

    this.updateDebugCounts();
  }

  updateDebugCounts() {
    const el = this.debugCountsElement;
    if (!el) return;

    const monsters = this.monsterManager?.getMonsters?.() || [];
    let alive = 0;
    let jammed = 0;
    let blinded = 0;
    let stunned = 0;
    for (const m of monsters) {
      if (!m) continue;
      if (m.isDead || m.isDying) continue;
      alive += 1;
      if ((m.perceptionJammedTimer || 0) > 0) jammed += 1;
      if ((m.perceptionBlindedTimer || 0) > 0) blinded += 1;
      if ((m.stunTimer || 0) > 0) stunned += 1;
    }

    const proj = this.projectileManager?.projectiles?.length ?? 0;
    const impacts = this.projectileManager?.impacts?.length ?? 0;
    const explosions = this.projectileManager?.explosions?.length ?? 0;
    const muzzle = this.gun?.muzzleFlashes?.length ?? 0;
    const missionObjects = this.missionDirector?.spawnedObjects?.length ?? 0;
    const devices = this.toolSystem?.devices?.length ?? 0;
    const smokeClouds =
      this.toolSystem?.smokeClouds?.length ??
      (Array.isArray(this.worldState?.smokeClouds) ? this.worldState.smokeClouds.length : 0);
    const pickupMarkers = this.pickupManager?.getPickupMarkers?.() || [];
    const pickupTotal = Array.isArray(pickupMarkers) ? pickupMarkers.length : 0;
    const toolPickupTotal = Array.isArray(pickupMarkers)
      ? pickupMarkers.filter((p) => {
        const k = String(p?.kind || '').trim().toLowerCase();
        return k && k !== 'ammo' && k !== 'health';
      }).length
      : 0;

    let blockedTiles = 0;
    const obstacleMap = this.worldState?.obstacleMap || null;
    if (Array.isArray(obstacleMap)) {
      for (const row of obstacleMap) {
        if (!Array.isArray(row)) continue;
        for (const cell of row) {
          if (cell) blockedTiles += 1;
        }
      }
    }

    const fmt = (count, cap) => {
      const c = Math.max(0, Math.round(Number(count) || 0));
      if (Number.isFinite(cap) && cap >= 0) return `${c}/${cap}`;
      return String(c);
    };

    const renderInfo = this.sceneManager?.renderer?.info || null;
    const fs = this.sceneManager?.frameStats || null;
    const calls = renderInfo?.render?.calls ?? null;
    const tris = renderInfo?.render?.triangles ?? null;
    const tex = renderInfo?.memory?.textures ?? null;
    const geos = renderInfo?.memory?.geometries ?? null;
    const pr = fs?.pixelRatio ?? this.sceneManager?.pixelRatio ?? null;
    const uMs = fs?.updateMs;
    const rMs = fs?.renderMs;
    const fEma = fs?.fpsEma;

    const perfText =
      (Number.isFinite(fEma) ? ` FPS~${fEma.toFixed(0)}` : '') +
      (Number.isFinite(uMs) ? ` U${uMs.toFixed(1)}ms` : '') +
      (Number.isFinite(rMs) ? ` R${rMs.toFixed(1)}ms` : '') +
      (Number.isFinite(pr) ? ` PR${Number(pr).toFixed(2)}` : '') +
      (Number.isFinite(calls) ? ` DC${calls}` : '') +
      (Number.isFinite(tris) ? ` T${Math.round(tris / 1000)}k` : '') +
      (Number.isFinite(geos) ? ` G${geos}` : '') +
      (Number.isFinite(tex) ? ` TX${tex}` : '');

    el.textContent =
      `M ${alive}/${monsters.length} ` +
      `P ${fmt(proj, CONFIG.MAX_ACTIVE_PROJECTILES)} ` +
      `I ${fmt(impacts, CONFIG.MAX_ACTIVE_IMPACTS)} ` +
      `E ${fmt(explosions, CONFIG.MAX_ACTIVE_EXPLOSIONS)} ` +
      `MF ${fmt(muzzle, CONFIG.MAX_ACTIVE_MUZZLE_FLASHES)} ` +
      `MO ${missionObjects} ` +
      `OB ${blockedTiles} ` +
      `PU ${pickupTotal}/${toolPickupTotal} ` +
      `FX Smk${smokeClouds} Dev${devices} Jam${jammed} Bld${blinded} Stn${stunned}` +
      perfText;
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

    const snap = this.gameState?.getInventorySnapshot ? (this.gameState.getInventorySnapshot() || {}) : null;
    if (this.toolsElement) {
      const lure = snap ? (Math.max(0, Math.round(Number(snap.lure) || 0))) : 0;
      const trap = snap ? (Math.max(0, Math.round(Number(snap.trap) || 0))) : 0;
      const jammer = snap ? (Math.max(0, Math.round(Number(snap.jammer) || 0))) : 0;
      const sensor = snap ? (Math.max(0, Math.round(Number(snap.sensor) || 0))) : 0;
      const mine = snap ? (Math.max(0, Math.round(Number(snap.mine) || 0))) : 0;
      this.toolsElement.textContent = `4 Lure:${lure} | 5 Trap:${trap} | 6 Jammer:${jammer} | 0 Sensor:${sensor} | V Mine:${mine}`;
    }
    if (this.throwablesElement) {
      const decoy = snap ? (Math.max(0, Math.round(Number(snap.decoy) || 0))) : 0;
      const smoke = snap ? (Math.max(0, Math.round(Number(snap.smoke) || 0))) : 0;
      const flash = snap ? (Math.max(0, Math.round(Number(snap.flash) || 0))) : 0;
      this.throwablesElement.textContent = `7 Decoy:${decoy} | 8 Smoke:${smoke} | 9 Flash:${flash}`;
    }

    if (this.inventoryElement && snap) {
      const keys = Object.keys(snap);
      if (keys.length === 0) {
        this.inventoryElement.textContent = '—';
      } else {
        const preferred = ['fuse', 'evidence', 'power_on', 'keycard', 'lure', 'trap', 'jammer', 'sensor', 'mine', 'decoy', 'smoke', 'flash'];
        keys.sort((a, b) => {
          const ia = preferred.indexOf(a);
          const ib = preferred.indexOf(b);
          if (ia !== -1 || ib !== -1) {
            return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
          }
          return a.localeCompare(b);
        });
        const parts = [];
        for (const k of keys) {
          const v = snap[k];
          const n = Math.round(Number(v));
          if (!Number.isFinite(n) || n <= 0) continue;
          parts.push(`${k}:${n}`);
        }
        this.inventoryElement.textContent = parts.length > 0 ? parts.join(', ') : '—';
      }
    }
  }

  showGameOver(won, reason = null) {
    if (!this.gameOverElement) return;
    this.closeKeypadInput();

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
    window.removeEventListener('keydown', this._keypadKeydownCapture, true);
  }
}
