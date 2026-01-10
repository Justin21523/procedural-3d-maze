import * as THREE from 'three';
import { CONFIG } from '../core/config.js';
import { EVENTS } from '../core/events.js';
import { createWeaponCatalog, DEFAULT_WEAPON_ORDER } from './weaponCatalog.js';
import { applyWeaponMetaToCatalog, loadWeaponMetaFile } from './weaponMeta.js';

/**
 * Player weapon system:
 * - Weapon switching (1/2/3)
 * - Magazines + reload (R)
 * - Ammo modes (B) for supported weapons
 * - Skills (Q/E)
 */
export class Gun {
  constructor(scene, camera, input, projectileManager, audioManager = null, weaponView = null, eventBus = null) {
    this.scene = scene;
    this.camera = camera;
    this.input = input;
    this.projectileManager = projectileManager;
    this.audioManager = audioManager;
    this.weaponView = weaponView;
    this.eventBus = eventBus;

    this.muzzleFlashes = [];
    this.muzzleFlashPool = [];

    this.weaponDefs = createWeaponCatalog();
    this.weaponOrder = DEFAULT_WEAPON_ORDER.filter(id => !!this.weaponDefs[id]);
    this.weaponStates = new Map();
    this.initWeaponStates();

    this.activeWeaponId = this.weaponOrder[0] || 'rifle';
    this.weaponSwapCooldown = 0;
    this.syncWeaponViewModel();

    void this.loadWeaponMetaOverrides();

    this.skills = {
      grenade: { cooldown: 0, maxCooldown: 7.5 },
      emp: { cooldown: 0, maxCooldown: 12.0 }
    };
  }

  async loadWeaponMetaOverrides() {
    try {
      const meta = await loadWeaponMetaFile();
      if (!meta) return;
      applyWeaponMetaToCatalog(this.weaponDefs, meta);
      this.syncWeaponViewModel();
    } catch (err) {
      void err;
    }
  }

  async reloadWeaponMetaOverrides() {
    await this.loadWeaponMetaOverrides();
  }

  setWeaponView(weaponView) {
    this.weaponView = weaponView;
    this.syncWeaponViewModel();
  }

  setEventBus(eventBus) {
    this.eventBus = eventBus;
  }

  update(deltaTime, externalCommand = null, autopilotActive = false) {
    const dt = deltaTime ?? 0;
    this.updateMuzzleFlashes(dt);
    this.weaponView?.update?.(dt);

    this.weaponSwapCooldown = Math.max(0, this.weaponSwapCooldown - dt);
    this.updateWeaponTimers(dt);
    this.updateSkillTimers(dt);

    this.handleWeaponInput(externalCommand, autopilotActive);
    this.handleSkillInput(externalCommand, autopilotActive);
    this.handleFireInput(externalCommand, autopilotActive);
  }

  reset() {
    this.clearMuzzleFlashes();
    this.weaponStates.clear();
    this.initWeaponStates();
    this.activeWeaponId = this.weaponOrder[0] || 'rifle';
    this.weaponSwapCooldown = 0;
    for (const skill of Object.values(this.skills)) {
      if (!skill) continue;
      skill.cooldown = 0;
    }
  }

  createPooledMuzzleFlash() {
    const light = new THREE.PointLight(0xffffff, 1, 8, 2);
    light.visible = false;

    const spriteMat = new THREE.SpriteMaterial({
      color: 0xffffff,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.95,
      depthWrite: false
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.visible = false;
    sprite.scale.set(0.6, 0.6, 0.6);

    return {
      light,
      sprite,
      life: 0,
      maxLife: 0,
      maxIntensity: 1.0,
      baseScale: 0.6
    };
  }

  releaseMuzzleFlash(fx) {
    if (!fx) return;
    if (fx.light) {
      this.scene.remove(fx.light);
      fx.light.visible = false;
      fx.light.intensity = 0;
    }
    if (fx.sprite) {
      this.scene.remove(fx.sprite);
      fx.sprite.visible = false;
      fx.sprite.material.opacity = 0;
    }
    fx.life = 0;
    fx.maxLife = 0;

    const limit = Math.max(0, Math.round(CONFIG.MAX_ACTIVE_MUZZLE_FLASHES ?? 24));
    if (this.muzzleFlashPool.length < limit) {
      this.muzzleFlashPool.push(fx);
    }
  }

  clearMuzzleFlashes() {
    for (const fx of this.muzzleFlashes) {
      this.releaseMuzzleFlash(fx);
    }
    this.muzzleFlashes = [];
  }

  initWeaponStates() {
    for (const id of this.weaponOrder) {
      const def = this.weaponDefs[id];
      if (!def) continue;
      const magSize = def.magSize ?? 0;
      const reserve = Number.isFinite(def.reserveStart) ? def.reserveStart : 0;

      this.weaponStates.set(id, {
        ammoInMag: magSize,
        ammoReserve: reserve,
        cooldown: 0,
        reloadTimer: 0,
        reloadTotal: 0,
        mode: def.defaultMode || null
      });
    }
  }

  getActiveWeaponDef() {
    return this.weaponDefs[this.activeWeaponId] || null;
  }

  getWeaponState(id = null) {
    const key = id || this.activeWeaponId;
    return this.weaponStates.get(key) || null;
  }

  addAmmo(amount, weaponId = null) {
    const add = Math.max(0, Math.round(Number(amount) || 0));
    if (add <= 0) return 0;

    const id = weaponId || this.activeWeaponId;
    const def = this.weaponDefs[id];
    const state = this.weaponStates.get(id);
    if (!def || !state) return 0;

    const max = Number.isFinite(def.reserveMax) ? def.reserveMax : Infinity;
    const before = state.ammoReserve || 0;
    state.ammoReserve = Math.max(0, Math.min(max, before + add));
    return state.ammoReserve - before;
  }

  updateWeaponTimers(dt) {
    for (const id of this.weaponOrder) {
      const state = this.weaponStates.get(id);
      const def = this.weaponDefs[id];
      if (!state || !def) continue;

      state.cooldown = Math.max(0, (state.cooldown || 0) - dt);
      if (state.reloadTimer > 0) {
        state.reloadTimer = Math.max(0, state.reloadTimer - dt);
        if (state.reloadTimer <= 0) {
          this.finishReload(def, state);
          if (id === this.activeWeaponId) {
            this.weaponView?.onReloadFinish?.();
            this.audioManager?.playReload?.('finish');
          }
          this.eventBus?.emit?.(EVENTS.WEAPON_RELOAD_FINISH, { weaponId: id });
        }
      }
    }
  }

  updateSkillTimers(dt) {
    for (const skill of Object.values(this.skills)) {
      if (!skill) continue;
      skill.cooldown = Math.max(0, (skill.cooldown || 0) - dt);
    }
  }

  handleWeaponInput(externalCommand = null, autopilotActive = false) {
    const canConsume = !!this.input?.consumeKeyPress;

    if (canConsume) {
      if (this.input.consumeKeyPress('Digit1')) this.switchWeaponByIndex(0);
      if (this.input.consumeKeyPress('Digit2')) this.switchWeaponByIndex(1);
      if (this.input.consumeKeyPress('Digit3')) this.switchWeaponByIndex(2);

      if (this.input.consumeKeyPress('KeyR')) {
        this.tryStartReload();
      }

      if (this.input.consumeKeyPress('KeyB')) {
        this.cycleWeaponMode();
      }
    }

    if (autopilotActive && externalCommand) {
      const idx = Number(externalCommand.weaponIndex);
      if (idx === 1) this.switchWeaponByIndex(0);
      if (idx === 2) this.switchWeaponByIndex(1);
      if (idx === 3) this.switchWeaponByIndex(2);

      const weaponId = typeof externalCommand.weaponId === 'string' ? externalCommand.weaponId : null;
      if (weaponId) this.switchWeapon(weaponId);

      if (externalCommand.reload) this.tryStartReload();
      if (externalCommand.toggleMode) this.cycleWeaponMode();

      const modeKey = typeof externalCommand.weaponMode === 'string' ? externalCommand.weaponMode : null;
      if (modeKey) this.setWeaponMode(modeKey);
    }
  }

  handleSkillInput(externalCommand = null, autopilotActive = false) {
    const canConsume = !!this.input?.consumeKeyPress;

    if (canConsume) {
      if (this.input.consumeKeyPress('KeyQ')) {
        this.tryUseGrenadeSkill();
      }
      if (this.input.consumeKeyPress('KeyX')) {
        this.tryUseEmpSkill();
      }
    }

    if (autopilotActive && externalCommand) {
      if (externalCommand.skillGrenade) this.tryUseGrenadeSkill({ ignorePointerLock: true });
      if (externalCommand.skillEmp) this.tryUseEmpSkill();
    }
  }

  handleFireInput(externalCommand = null, autopilotActive = false) {
    const def = this.getActiveWeaponDef();
    const state = this.getWeaponState();
    if (!def || !state) return;

    const externalFire = !!(autopilotActive && (externalCommand?.fire || externalCommand?.fireHeld || externalCommand?.firePressed));

    const wantsFire = externalFire || (def.fireMode === 'semi'
      ? (this.input?.consumeFirePressed ? this.input.consumeFirePressed() : false)
      : (this.input?.isFiring ? this.input.isFiring() : false));

    if (!wantsFire) return;
    if (this.weaponSwapCooldown > 0) return;
    if (state.reloadTimer > 0) return;
    if (state.cooldown > 0) return;

    if ((state.ammoInMag || 0) <= 0) {
      this.tryStartReload();
      return;
    }

    const damageMult = externalFire ? (CONFIG.AUTOPILOT_COMBAT_DAMAGE_MULT ?? 1.0) : 1.0;
    const fired = this.fireWeapon(def, state, { damageMult });
    if (!fired) {
      // Avoid spamming CPU/audio when we're capped (e.g., too many projectiles).
      state.cooldown = Math.max(state.cooldown || 0, 0.05);
      return;
    }

    state.ammoInMag -= 1;
    state.cooldown = def.fireInterval ?? 0.1;

    // Auto-reload when empty and reserve is available.
    if ((state.ammoInMag || 0) <= 0 && (state.ammoReserve || 0) > 0) {
      this.tryStartReload();
    }
  }

  switchWeaponByIndex(index) {
    const id = this.weaponOrder[index] || null;
    if (!id) return;
    this.switchWeapon(id);
  }

  switchWeapon(id) {
    if (!id || id === this.activeWeaponId) return;
    if (!this.weaponDefs[id]) return;

    const currentState = this.weaponStates.get(this.activeWeaponId);
    if (currentState && currentState.reloadTimer > 0) {
      currentState.reloadTimer = 0;
      currentState.reloadTotal = 0;
    }

    this.activeWeaponId = id;
    this.weaponSwapCooldown = 0.2;
    this.weaponView?.onWeaponSwitch?.();
    this.audioManager?.playWeaponSwitch?.();
    this.syncWeaponViewModel();
    this.eventBus?.emit?.(EVENTS.WEAPON_SWITCHED, {
      weaponId: id,
      weaponDef: this.weaponDefs[id] || null
    });
  }

  syncWeaponViewModel() {
    const def = this.getActiveWeaponDef();
    const path = def?.viewModelPath || null;
    if (this.weaponView?.setViewTransform) {
      this.weaponView.setViewTransform(def?.view || null);
    }
    if (path && this.weaponView?.setModelPath) {
      void this.weaponView.setModelPath(path);
    }
  }

  setWeaponMode(modeKey) {
    const def = this.getActiveWeaponDef();
    const state = this.getWeaponState();
    if (!def || !state) return;
    if (!def.modes || !def.modes[modeKey]) return;
    if (state.mode === modeKey) return;
    state.mode = modeKey;
    this.audioManager?.playWeaponModeToggle?.();
  }

  tryStartReload() {
    const def = this.getActiveWeaponDef();
    const state = this.getWeaponState();
    if (!def || !state) return;

    if (state.reloadTimer > 0) return;
    const magSize = def.magSize ?? 0;
    if (magSize <= 0) return;
    if ((state.ammoInMag || 0) >= magSize) return;
    if ((state.ammoReserve || 0) <= 0) return;

    state.reloadTotal = Math.max(0.1, def.reloadSeconds ?? 1.6);
    state.reloadTimer = state.reloadTotal;
    state.cooldown = Math.max(state.cooldown || 0, 0.15);
    this.weaponView?.onReloadStart?.(state.reloadTotal);
    this.audioManager?.playReload?.('start');
    this.eventBus?.emit?.(EVENTS.WEAPON_RELOAD_START, {
      weaponId: def.id,
      duration: state.reloadTotal
    });
  }

  finishReload(def, state) {
    const magSize = def.magSize ?? 0;
    const need = Math.max(0, magSize - (state.ammoInMag || 0));
    if (need <= 0) return;
    const take = Math.max(0, Math.min(need, state.ammoReserve || 0));
    state.ammoInMag = (state.ammoInMag || 0) + take;
    state.ammoReserve = (state.ammoReserve || 0) - take;
  }

  cycleWeaponMode() {
    const def = this.getActiveWeaponDef();
    const state = this.getWeaponState();
    if (!def || !state) return;
    const modes = def.modes ? Object.keys(def.modes) : [];
    if (modes.length <= 1) return;

    const current = state.mode && def.modes[state.mode] ? state.mode : (def.defaultMode || modes[0]);
    const idx = modes.indexOf(current);
    const next = modes[(idx + 1) % modes.length];
    state.mode = next;
    this.audioManager?.playWeaponModeToggle?.();
  }

  tryUseGrenadeSkill(options = {}) {
    const skill = this.skills.grenade;
    if (!skill || skill.cooldown > 0) return;
    const cam = this.getCameraObject();
    if (!cam || !this.projectileManager?.spawnPlayerProjectile) return;
    const ignorePointerLock = options?.ignorePointerLock === true;
    if (!ignorePointerLock && !this.input?.isPointerLocked?.() && !(this.input?.pointerLocked)) return;

    const { origin, dir } = this.computeShotRay(cam);
    if (!origin || !dir) return;

    this.weaponView?.kick?.(1.15);
    this.spawnMuzzleFlash(origin, dir, 0x66ccff, 1.6);
    this.eventBus?.emit?.(EVENTS.WEAPON_FIRED, {
      weaponId: 'skill_grenade',
      weaponName: 'Grenade',
      mode: null,
      origin: origin.clone(),
      direction: dir.clone()
    });

    this.projectileManager.spawnPlayerProjectile(origin, dir, {
      kind: 'grenade',
      speed: 16,
      lifetime: 2.4,
      damage: 1,
      explosionRadius: 3.8,
      explosionDamage: 8,
      color: 0x66ccff,
      explosionColor: 0x66ccff,
      stunSeconds: 0.35
    });

    this.registerPlayerNoise(origin, 1.0);
    this.audioManager?.playGrenadeLaunch?.();
    skill.cooldown = skill.maxCooldown;
  }

  tryUseEmpSkill() {
    const skill = this.skills.emp;
    if (!skill || skill.cooldown > 0) return;
    const playerPos = this.projectileManager?.playerRef?.getPosition
      ? this.projectileManager.playerRef.getPosition()
      : null;
    if (!playerPos) return;

    // A short-range stun pulse around the player.
    const radius = 4.2;
    const stunSeconds = 1.6;
    const damage = 0;
    this.eventBus?.emit?.(EVENTS.PLAYER_USED_SKILL, {
      kind: 'emp',
      position: playerPos.clone(),
      radius,
      stunSeconds,
      damage,
      color: 0x66aaff
    });

    this.audioManager?.playEmpPulse?.();
    this.registerPlayerNoise(playerPos, 0.6);
    skill.cooldown = skill.maxCooldown;
  }

  fireWeapon(def, state, fireContext = {}) {
    const cam = this.getCameraObject();
    if (!cam || !this.projectileManager) return false;

    if (this.projectileManager?.canSpawnProjectile && !this.projectileManager.canSpawnProjectile('player')) {
      return false;
    }

    const { origin, dir } = this.computeShotRay(cam);
    if (!origin || !dir) return false;

    const modeKey = state.mode && def.modes && def.modes[state.mode] ? state.mode : null;
    const mode = modeKey ? def.modes[modeKey] : null;
    const projBase = def.projectile || {};
    const projMode = mode?.projectile || {};

    const options = {
      ...projBase,
      ...projMode
    };

    const multRaw = fireContext?.damageMult;
    const damageMult = Number.isFinite(multRaw) ? Math.max(0.1, Math.min(5, multRaw)) : 1.0;
    if (damageMult !== 1.0) {
      if (Number.isFinite(options.damage)) {
        options.damage = options.damage * damageMult;
      }
      if (Number.isFinite(options.explosionDamage)) {
        options.explosionDamage = options.explosionDamage * damageMult;
      }
    }

    let spawnedAny = false;
    if (def.pellets && def.pellets > 1) {
      const pellets = Math.max(1, Math.round(def.pellets));
      const spread = def.spread ?? 0.1;
      for (let i = 0; i < pellets; i++) {
        const d = this.applySpread(dir, spread);
        spawnedAny = this.spawnPlayerProjectile(origin, d, options) || spawnedAny;
      }
    } else {
      spawnedAny = this.spawnPlayerProjectile(origin, dir, options) || spawnedAny;
    }

    if (!spawnedAny) return false;

    this.weaponView?.kick?.(def.recoilKick ?? 1.0);
    this.spawnMuzzleFlash(origin, dir, def.muzzleColor ?? 0xffdd88, 2.0);

    this.eventBus?.emit?.(EVENTS.WEAPON_FIRED, {
      weaponId: def.id,
      weaponName: def.name || def.id,
      mode: state.mode || null,
      origin: origin.clone(),
      direction: dir.clone()
    });

    this.registerPlayerNoise(origin, 1.0);
    this.audioManager?.playGunshot?.();
    return true;
  }

  spawnPlayerProjectile(origin, direction, options) {
    if (this.projectileManager?.spawnPlayerProjectile) {
      return this.projectileManager.spawnPlayerProjectile(origin, direction, options);
    } else if (this.projectileManager?.spawnBullet) {
      return this.projectileManager.spawnBullet(origin, direction);
    }
    return false;
  }

  registerPlayerNoise(origin, strength = 1.0) {
    if (!this.projectileManager?.registerNoise) return;
    this.projectileManager.registerNoise(origin, {
      kind: 'gunshot',
      radius: CONFIG.AI_NOISE_GUNSHOT_RADIUS ?? 18,
      ttl: CONFIG.AI_NOISE_TTL_GUNSHOT ?? 1.2,
      strength,
      source: 'player'
    });
  }

  getCameraObject() {
    if (!this.camera) return null;
    return this.camera.getCamera ? this.camera.getCamera() : this.camera;
  }

  computeShotRay(cam) {
    if (!cam) return { origin: null, dir: null };
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    if (dir.lengthSq() <= 1e-8) return { origin: null, dir: null };
    dir.normalize();

    const origin = cam.position.clone();
    origin.addScaledVector(dir, 0.6);
    origin.y -= 0.05;
    return { origin, dir };
  }

  applySpread(direction, spread) {
    const dir = direction.clone().normalize();
    const s = Number.isFinite(spread) ? Math.max(0, spread) : 0;
    if (s <= 0) return dir;

    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(dir, up);
    if (right.lengthSq() <= 1e-8) return dir;
    right.normalize();
    const trueUp = new THREE.Vector3().crossVectors(right, dir).normalize();
    dir.addScaledVector(right, (Math.random() - 0.5) * 2 * s);
    dir.addScaledVector(trueUp, (Math.random() - 0.5) * 2 * s);
    dir.normalize();
    return dir;
  }

  getHudState() {
    const def = this.getActiveWeaponDef();
    const state = this.getWeaponState();
    if (!def || !state) {
      return {
        weaponName: '—',
        ammoInMag: 0,
        magSize: 0,
        ammoReserve: 0,
        isReloading: false,
        reloadProgress: 0,
        modeLabel: null,
        skills: this.getSkillHud()
      };
    }

    const modeKey = state.mode && def.modes && def.modes[state.mode] ? state.mode : null;
    const modeLabel = modeKey ? (def.modes[modeKey]?.label || modeKey) : null;

    const isReloading = state.reloadTimer > 0;
    const reloadProgress = isReloading && state.reloadTotal > 0
      ? 1 - (state.reloadTimer / state.reloadTotal)
      : 0;

    return {
      weaponName: def.name || def.id,
      weaponId: def.id,
      ammoInMag: state.ammoInMag || 0,
      magSize: def.magSize || 0,
      ammoReserve: state.ammoReserve || 0,
      isReloading,
      reloadProgress,
      modeLabel,
      skills: this.getSkillHud()
    };
  }

  getSkillHud() {
    const fmt = (s) => {
      const cd = s?.cooldown || 0;
      return cd > 0 ? cd : 0;
    };
    return {
      grenade: fmt(this.skills.grenade),
      emp: fmt(this.skills.emp)
    };
  }

  spawnMuzzleFlash(origin, direction, color = 0xffdd88, intensity = 2) {
    const maxActive = CONFIG.MAX_ACTIVE_MUZZLE_FLASHES;
    if (Number.isFinite(maxActive) && maxActive >= 0 && this.muzzleFlashes.length >= maxActive) {
      return;
    }

    const fx = this.muzzleFlashPool.length > 0
      ? this.muzzleFlashPool.pop()
      : this.createPooledMuzzleFlash();

    if (!fx?.light || !fx?.sprite) return;

    const flashPos = origin.clone().addScaledVector(direction, 0.2);

    fx.light.color.setHex(color);
    fx.light.intensity = intensity;
    fx.light.position.copy(flashPos);
    fx.light.visible = true;
    this.scene.add(fx.light);

    fx.sprite.material.color.setHex(color);
    fx.sprite.material.opacity = 0.95;
    fx.sprite.position.copy(flashPos);
    fx.sprite.scale.set(fx.baseScale, fx.baseScale, fx.baseScale);
    fx.sprite.visible = true;
    this.scene.add(fx.sprite);

    fx.life = 0.08;
    fx.maxLife = 0.08;
    fx.maxIntensity = intensity;

    this.muzzleFlashes.push(fx);
  }

  updateMuzzleFlashes(dt) {
    for (let i = this.muzzleFlashes.length - 1; i >= 0; i--) {
      const fx = this.muzzleFlashes[i];
      fx.life -= dt;
      const progress = Math.max(0, fx.life / fx.maxLife);
      if (fx.sprite) {
        fx.sprite.material.opacity = progress;
        fx.sprite.scale.setScalar((fx.baseScale || 0.6) + (1 - progress) * 0.3);
      }
      if (fx.light) {
        fx.light.intensity = (fx.maxIntensity || 2) * progress;
      }
      if (fx.life <= 0) {
        this.muzzleFlashes.splice(i, 1);
        this.releaseMuzzleFlash(fx);
      }
    }
  }

  toSaveData() {
    const weaponStates = {};
    for (const id of this.weaponOrder) {
      const state = this.weaponStates.get(id);
      if (!state) continue;
      weaponStates[id] = {
        ammoInMag: Math.max(0, Math.round(Number(state.ammoInMag) || 0)),
        ammoReserve: Math.max(0, Math.round(Number(state.ammoReserve) || 0)),
        cooldown: Math.max(0, Number(state.cooldown) || 0),
        reloadTimer: Math.max(0, Number(state.reloadTimer) || 0),
        reloadTotal: Math.max(0, Number(state.reloadTotal) || 0),
        mode: typeof state.mode === 'string' ? state.mode : null
      };
    }

    return {
      activeWeaponId: this.activeWeaponId,
      weaponSwapCooldown: Math.max(0, Number(this.weaponSwapCooldown) || 0),
      weaponStates,
      skills: {
        grenade: { cooldown: Math.max(0, Number(this.skills?.grenade?.cooldown) || 0) },
        emp: { cooldown: Math.max(0, Number(this.skills?.emp?.cooldown) || 0) }
      }
    };
  }

  applySaveData(data) {
    const d = data && typeof data === 'object' ? data : null;
    if (!d) return false;

    const nextActive = typeof d.activeWeaponId === 'string' ? d.activeWeaponId : null;
    if (nextActive && this.weaponDefs[nextActive]) {
      this.activeWeaponId = nextActive;
    }

    this.weaponSwapCooldown = Math.max(0, Number(d.weaponSwapCooldown) || 0);

    const ws = d.weaponStates && typeof d.weaponStates === 'object' ? d.weaponStates : null;
    if (ws) {
      for (const id of this.weaponOrder) {
        const entry = ws[id];
        if (!entry || typeof entry !== 'object') continue;
        const state = this.weaponStates.get(id);
        if (!state) continue;
        state.ammoInMag = Math.max(0, Math.round(Number(entry.ammoInMag) || 0));
        state.ammoReserve = Math.max(0, Math.round(Number(entry.ammoReserve) || 0));
        state.cooldown = Math.max(0, Number(entry.cooldown) || 0);
        state.reloadTimer = Math.max(0, Number(entry.reloadTimer) || 0);
        state.reloadTotal = Math.max(0, Number(entry.reloadTotal) || 0);
        state.mode = typeof entry.mode === 'string' ? entry.mode : (this.weaponDefs[id]?.defaultMode || null);
      }
    }

    const skills = d.skills && typeof d.skills === 'object' ? d.skills : null;
    if (skills) {
      if (this.skills?.grenade) this.skills.grenade.cooldown = Math.max(0, Number(skills?.grenade?.cooldown) || 0);
      if (this.skills?.emp) this.skills.emp.cooldown = Math.max(0, Number(skills?.emp?.cooldown) || 0);
    }

    this.syncWeaponViewModel();
    return true;
  }
}
