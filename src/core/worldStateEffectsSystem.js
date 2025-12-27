import { EVENTS } from './events.js';

function isPowerMissionTemplate(template) {
  const t = String(template || '').trim();
  return t === 'restorePower' || t === 'restorePowerFuses';
}

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

export class WorldStateEffectsSystem {
  constructor(options = {}) {
    this.eventBus = options.eventBus || null;
    this.gameState = options.gameState || null;
    this.lights = options.lights || null;
    this.audioManager = options.audioManager || null;

    this.powerOffMultiplier = Number.isFinite(options.powerOffMultiplier) ? options.powerOffMultiplier : 0.55;
    this.powerFlagItemId = String(options.powerFlagItemId || 'power_on').trim() || 'power_on';

    // Snapshot of the "powered on" lighting baseline (used as a reference for dim/restore).
    this.powerOnLight = this.readLightState(this.lights);
    this.powerWanted = false;
    this.powerOn = true;

    this.unsubs = [];
    this.bindEvents();
  }

  setRefs({ eventBus, gameState, lights, audioManager } = {}) {
    if (eventBus) this.eventBus = eventBus;
    if (gameState) this.gameState = gameState;
    if (lights) this.lights = lights;
    if (audioManager) this.audioManager = audioManager;

    this.powerOnLight = this.readLightState(this.lights);
    this.bindEvents();
  }

  dispose() {
    this.unsubs.forEach((fn) => fn?.());
    this.unsubs = [];
  }

  bindEvents() {
    this.unsubs.forEach((fn) => fn?.());
    this.unsubs = [];

    const bus = this.eventBus;
    if (!bus?.on) return;

    this.unsubs.push(
      bus.on(EVENTS.MISSION_COMPLETED, (payload) => this.onMissionCompleted(payload))
    );
  }

  readLightState(lights) {
    const ambient = lights?.ambientLight?.intensity;
    const hemi = lights?.hemiLight?.intensity;
    const directional = lights?.directionalLight?.intensity;

    const baseIntensity = lights?.flickerData?.baseIntensity;
    const originalIntensity = lights?.flickerData?.originalIntensity;

    return {
      ambient: Number.isFinite(baseIntensity) ? baseIntensity : (Number.isFinite(ambient) ? ambient : 0.3),
      hemi: Number.isFinite(hemi) ? hemi : 0.25,
      directional: Number.isFinite(originalIntensity) ? originalIntensity : (Number.isFinite(directional) ? directional : 0.7)
    };
  }

  applyLightMultiplier(mult) {
    const lights = this.lights;
    const base = this.powerOnLight || this.readLightState(lights);
    if (!lights || !base) return;

    const m = Number.isFinite(mult) ? Math.max(0, mult) : 1;
    const ambient = base.ambient * m;
    const directional = base.directional * m;
    const hemi = base.hemi * m;

    if (lights.flickerData) {
      lights.flickerData.baseIntensity = ambient;
      lights.flickerData.originalIntensity = directional;
    }
    if (lights.ambientLight) lights.ambientLight.intensity = ambient;
    if (lights.directionalLight) lights.directionalLight.intensity = directional;
    if (lights.hemiLight) lights.hemiLight.intensity = hemi;
  }

  setFlagItemEnabled(enabled) {
    const bus = this.eventBus;
    const itemId = this.powerFlagItemId;
    if (!bus?.emit || !itemId) return;

    const query = { itemId, result: null };
    bus.emit(EVENTS.INVENTORY_QUERY_ITEM, query);
    const have = Number(query.result?.count) || 0;

    if (enabled) {
      if (have >= 1) return;
      bus.emit(EVENTS.INVENTORY_GIVE_ITEM, { actorKind: 'system', itemId, count: 1 });
      return;
    }

    if (have <= 0) return;
    bus.emit(EVENTS.INVENTORY_CONSUME_ITEM, { actorKind: 'system', itemId, count: have });
  }

  startLevel(levelConfig) {
    const missions = levelConfig?.missions;
    const list = Array.isArray(missions?.list) ? missions.list : [];
    const requires = Array.isArray(missions?.exit?.requires) ? missions.exit.requires : [];
    const requireSet = new Set(requires.map((s) => String(s || '').trim()).filter(Boolean));

    const powerRequired = list.some((m) => {
      if (!isPlainObject(m)) return false;
      const id = String(m.id || '').trim();
      if (!id || (requireSet.size > 0 && !requireSet.has(id))) return false;
      if (m.required === false) return false;
      return isPowerMissionTemplate(m.template);
    });

    this.powerWanted = powerRequired;
    this.powerOn = !powerRequired;

    // Apply the current power state each level (relative to the initial "powered on" baseline).
    this.applyLightMultiplier(this.powerOn ? 1 : this.powerOffMultiplier);
    this.setFlagItemEnabled(this.powerOn);
  }

  onMissionCompleted(payload) {
    const template = String(payload?.template || '').trim();
    if (!template) return;

    this.audioManager?.playObjectiveChime?.();

    if (isPowerMissionTemplate(template)) {
      if (this.powerOn) return;
      this.powerOn = true;
      this.applyLightMultiplier(1);
      this.setFlagItemEnabled(true);
    }
  }
}
