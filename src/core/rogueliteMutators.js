function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function hashStringSeed(str) {
  // FNV-1a 32-bit
  let h = 2166136261;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return function rand() {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function pickWeighted(list, rand) {
  if (!Array.isArray(list) || list.length === 0) return null;
  const total = list.reduce((acc, e) => acc + Math.max(0, Number(e?.weight) || 0), 0);
  if (!(total > 0)) return list[Math.floor(rand() * list.length)] || list[0];
  let r = rand() * total;
  for (const e of list) {
    r -= Math.max(0, Number(e?.weight) || 0);
    if (r <= 0) return e;
  }
  return list[list.length - 1] || null;
}

export const ROGUELITE_MUTATOR_CATALOG = Object.freeze([
  // ---- Blessings ----
  {
    id: 'blessing_clear_air',
    kind: 'blessing',
    label: 'Clear Air',
    description: 'Better visibility (reduced fog).',
    weight: 1.0,
    unlock: { default: true },
    effects: { fogDensityMult: 0.75 }
  },
  {
    id: 'blessing_loot_gremlin',
    kind: 'blessing',
    label: 'Loot Gremlin',
    description: 'More tool drops.',
    weight: 1.0,
    unlock: { default: true },
    effects: { toolDropChanceMult: 1.55 }
  },
  {
    id: 'blessing_steady_hands',
    kind: 'blessing',
    label: 'Steady Hands',
    description: 'Less recoil, tighter shots.',
    weight: 0.9,
    unlock: { default: false, atLevel: 2 },
    effects: { weaponRecoilMult: 0.78, weaponSpreadMult: 0.85 }
  },
  {
    id: 'blessing_myopic_hunters',
    kind: 'blessing',
    label: 'Myopic Hunters',
    description: 'Monsters see less (easier to break line-of-sight).',
    weight: 0.55,
    unlock: { default: false, atLevel: 2 },
    effects: { aiVisionGlobalMult: 0.82 }
  },

  // ---- Curses ----
  {
    id: 'curse_low_visibility',
    kind: 'curse',
    label: 'Low Visibility',
    description: 'Thicker fog.',
    weight: 1.0,
    unlock: { default: true },
    effects: { fogDensityMult: 1.55 }
  },
  {
    id: 'curse_fragile',
    kind: 'curse',
    label: 'Fragile',
    description: 'Take more damage.',
    weight: 1.0,
    unlock: { default: true },
    effects: { playerDamageTakenMult: 1.25 }
  },
  {
    id: 'curse_loud_guns',
    kind: 'curse',
    label: 'Loud Guns',
    description: 'Gunshots attract from farther away.',
    weight: 0.85,
    unlock: { default: false, atLevel: 3 },
    effects: { gunshotNoiseRadiusMult: 1.35 }
  },
  {
    id: 'curse_noise_matters',
    kind: 'curse',
    label: 'Noise Matters',
    description: 'All noises travel farther (more investigation pressure).',
    weight: 0.75,
    unlock: { default: false, atLevel: 2 },
    effects: { globalNoiseRadiusMult: 1.35 }
  },
  {
    id: 'curse_no_minimap',
    kind: 'curse',
    label: 'No Minimap',
    description: 'Minimap is disabled for this level.',
    weight: 0.55,
    unlock: { default: false, atLevel: 2 },
    effects: { minimapDisabled: true }
  },
  {
    id: 'curse_hunt',
    kind: 'curse',
    label: 'Hunt',
    description: 'More hunters, less mercy.',
    weight: 0.6,
    unlock: { default: false, atLevel: 3 },
    effects: { monsterCountMult: 1.25, aiMaxChasersBonus: 1 }
  },
  {
    id: 'curse_swarm',
    kind: 'curse',
    label: 'Swarm',
    description: 'More enemies roam the halls.',
    weight: 0.45,
    unlock: { default: false, atLevel: 4 },
    effects: { monsterCountBonus: 3, aiMaxChasersBonus: 1 }
  },
  {
    id: 'curse_darkness',
    kind: 'curse',
    label: 'Darkness',
    description: 'Heavier fog and darker ambience.',
    weight: 0.65,
    unlock: { default: false, atLevel: 1 },
    effects: { fogDensityMult: 1.95 }
  },
  {
    id: 'curse_bloodhounds',
    kind: 'curse',
    label: 'Bloodhounds',
    description: 'Stronger hearing and scent tracking.',
    weight: 0.4,
    unlock: { default: false, atLevel: 4 },
    effects: { aiHearingGlobalMult: 1.3, aiSmellGlobalMult: 1.2, aiVisionGlobalMult: 0.95 }
  },
  {
    id: 'curse_stealth_only',
    kind: 'curse',
    label: 'Stealth Only',
    description: 'No guns. Tools and movement only.',
    weight: 0.15,
    unlock: { default: false, atLevel: 6 },
    effects: { playerGunDisabled: true, minimapDisabled: true, monsterCountMult: 0.9, aiMaxChasersBonus: -1, globalNoiseRadiusMult: 1.15 }
  },

  // ---- Mods (weapon mutators) ----
  {
    id: 'mod_piercing_rounds',
    kind: 'mod',
    label: 'Piercing Rounds',
    description: 'Bullets pierce more, but recoil is worse.',
    weight: 0.9,
    unlock: { default: false, atLevel: 1 },
    effects: { weaponPierceBonus: 1, weaponRecoilMult: 1.18, weaponDamageMult: 0.92 }
  },
  {
    id: 'mod_hot_rounds',
    kind: 'mod',
    label: 'Hot Rounds',
    description: 'More damage, less control.',
    weight: 0.7,
    unlock: { default: false, atLevel: 4 },
    effects: { weaponDamageMult: 1.15, weaponRecoilMult: 1.12, weaponSpreadMult: 1.08 }
  },
  {
    id: 'mod_limited_ammo',
    kind: 'mod',
    label: 'Limited Ammo',
    description: 'Smaller ammo reserves (plan reloads).',
    weight: 0.7,
    unlock: { default: false, atLevel: 1 },
    effects: { ammoReserveMult: 0.65 }
  }
]);

export function getDefaultPermanentUnlocks() {
  return {
    version: 1,
    mutatorsUnlocked: [] // ids (in addition to "default" ones)
  };
}

export function getUnlocksForCatalog(permanent = null, levelIndex = 0) {
  const p = permanent && typeof permanent === 'object' ? permanent : {};
  const unlocked = new Set(Array.isArray(p.mutatorsUnlocked) ? p.mutatorsUnlocked.map(String) : []);
  const at = Math.max(0, Math.round(Number(levelIndex) || 0));

  const allowed = [];
  for (const m of ROGUELITE_MUTATOR_CATALOG) {
    if (!m?.id) continue;
    const unlock = m.unlock || {};
    if (unlock.default === true) {
      allowed.push(m);
      continue;
    }
    const atLevel = Number.isFinite(unlock.atLevel) ? Math.round(unlock.atLevel) : null;
    if (atLevel !== null && at >= atLevel) {
      allowed.push(m);
      continue;
    }
    if (unlocked.has(String(m.id))) {
      allowed.push(m);
    }
  }

  return allowed;
}

export function selectMutatorsForLevel({ runId, levelIndex = 0, permanent = null } = {}) {
  const idx = Math.max(0, Math.round(Number(levelIndex) || 0));
  const seed = hashStringSeed(`mutators:${String(runId || 'run')}:${idx}`);
  const rand = mulberry32(seed);

  const unlockedCatalog = getUnlocksForCatalog(permanent, idx);
  const blessings = unlockedCatalog.filter((m) => m.kind === 'blessing');
  const curses = unlockedCatalog.filter((m) => m.kind === 'curse');
  const mods = unlockedCatalog.filter((m) => m.kind === 'mod');

  const picked = [];

  const pick1 = (pool, avoid = new Set()) => {
    const options = pool.filter((m) => m && !avoid.has(m.id));
    if (options.length === 0) return null;
    return pickWeighted(options, rand);
  };

  const avoid = new Set();
  const blessing = pick1(blessings, avoid);
  if (blessing) {
    picked.push(blessing.id);
    avoid.add(blessing.id);
  }

  const curse = pick1(curses, avoid);
  if (curse) {
    picked.push(curse.id);
    avoid.add(curse.id);
  }

  // Weapon mods appear after L2 (idx>=1), and become more likely later.
  const modChance = clamp(0.25 + idx * 0.06, 0, 0.75);
  if (mods.length > 0 && idx >= 1 && rand() < modChance) {
    const mod = pick1(mods, avoid);
    if (mod) picked.push(mod.id);
  }

  return picked;
}

export function computeMutatorEffects(mutatorIds = [], catalog = ROGUELITE_MUTATOR_CATALOG) {
  const byId = new Map();
  for (const m of catalog) {
    if (m?.id) byId.set(String(m.id), m);
  }

  const out = {
    fogDensityMult: 1.0,
    toolDropChanceMult: 1.0,
    playerDamageTakenMult: 1.0,
    weaponDamageMult: 1.0,
    weaponRecoilMult: 1.0,
    weaponSpreadMult: 1.0,
    weaponPierceBonus: 0,
    gunshotNoiseRadiusMult: 1.0,
    globalNoiseRadiusMult: 1.0,
    ammoReserveMult: 1.0,
    minimapDisabled: false,
    monsterCountMult: 1.0,
    monsterCountBonus: 0,
    aiMaxChasersBonus: 0,
    playerGunDisabled: false,
    aiVisionGlobalMult: 1.0,
    aiHearingGlobalMult: 1.0,
    aiSmellGlobalMult: 1.0
  };

  for (const idRaw of mutatorIds || []) {
    const id = String(idRaw || '');
    const m = byId.get(id);
    if (!m?.effects) continue;
    const e = m.effects;
    if (Number.isFinite(e.fogDensityMult)) out.fogDensityMult *= e.fogDensityMult;
    if (Number.isFinite(e.toolDropChanceMult)) out.toolDropChanceMult *= e.toolDropChanceMult;
    if (Number.isFinite(e.playerDamageTakenMult)) out.playerDamageTakenMult *= e.playerDamageTakenMult;
    if (Number.isFinite(e.weaponDamageMult)) out.weaponDamageMult *= e.weaponDamageMult;
    if (Number.isFinite(e.weaponRecoilMult)) out.weaponRecoilMult *= e.weaponRecoilMult;
    if (Number.isFinite(e.weaponSpreadMult)) out.weaponSpreadMult *= e.weaponSpreadMult;
    if (Number.isFinite(e.weaponPierceBonus)) out.weaponPierceBonus += Math.round(e.weaponPierceBonus);
    if (Number.isFinite(e.gunshotNoiseRadiusMult)) out.gunshotNoiseRadiusMult *= e.gunshotNoiseRadiusMult;
    if (Number.isFinite(e.globalNoiseRadiusMult)) out.globalNoiseRadiusMult *= e.globalNoiseRadiusMult;
    if (Number.isFinite(e.ammoReserveMult)) out.ammoReserveMult *= e.ammoReserveMult;
    if (e.minimapDisabled === true) out.minimapDisabled = true;
    if (Number.isFinite(e.monsterCountMult)) out.monsterCountMult *= e.monsterCountMult;
    if (Number.isFinite(e.monsterCountBonus)) out.monsterCountBonus += Math.round(e.monsterCountBonus);
    if (Number.isFinite(e.aiMaxChasersBonus)) out.aiMaxChasersBonus += Math.round(e.aiMaxChasersBonus);
    if (e.playerGunDisabled === true) out.playerGunDisabled = true;
    if (Number.isFinite(e.aiVisionGlobalMult)) out.aiVisionGlobalMult *= e.aiVisionGlobalMult;
    if (Number.isFinite(e.aiHearingGlobalMult)) out.aiHearingGlobalMult *= e.aiHearingGlobalMult;
    if (Number.isFinite(e.aiSmellGlobalMult)) out.aiSmellGlobalMult *= e.aiSmellGlobalMult;
  }

  out.fogDensityMult = clamp(out.fogDensityMult, 0.3, 3.5);
  out.toolDropChanceMult = clamp(out.toolDropChanceMult, 0.1, 5.0);
  out.playerDamageTakenMult = clamp(out.playerDamageTakenMult, 0.3, 3.0);
  out.weaponDamageMult = clamp(out.weaponDamageMult, 0.3, 3.0);
  out.weaponRecoilMult = clamp(out.weaponRecoilMult, 0.3, 3.0);
  out.weaponSpreadMult = clamp(out.weaponSpreadMult, 0.5, 3.0);
  out.weaponPierceBonus = clamp(out.weaponPierceBonus, 0, 10);
  out.gunshotNoiseRadiusMult = clamp(out.gunshotNoiseRadiusMult, 0.5, 3.0);
  out.globalNoiseRadiusMult = clamp(out.globalNoiseRadiusMult, 0.5, 3.0);
  out.ammoReserveMult = clamp(out.ammoReserveMult, 0.2, 2.0);
  out.monsterCountMult = clamp(out.monsterCountMult, 0.5, 3.0);
  out.monsterCountBonus = clamp(out.monsterCountBonus, -5, 20);
  out.aiMaxChasersBonus = clamp(out.aiMaxChasersBonus, -2, 6);
  out.aiVisionGlobalMult = clamp(out.aiVisionGlobalMult, 0.5, 2.0);
  out.aiHearingGlobalMult = clamp(out.aiHearingGlobalMult, 0.5, 2.0);
  out.aiSmellGlobalMult = clamp(out.aiSmellGlobalMult, 0.5, 2.0);

  return out;
}

export function describeMutators(mutatorIds = [], catalog = ROGUELITE_MUTATOR_CATALOG) {
  const byId = new Map();
  for (const m of catalog) {
    if (m?.id) byId.set(String(m.id), m);
  }
  const out = [];
  for (const idRaw of mutatorIds || []) {
    const m = byId.get(String(idRaw || ''));
    if (!m) continue;
    out.push({
      id: m.id,
      kind: m.kind,
      label: m.label || m.id,
      description: m.description || ''
    });
  }
  return out;
}

export function grantProgressionUnlocks(permanent, levelIndex) {
  const p = permanent && typeof permanent === 'object' ? permanent : getDefaultPermanentUnlocks();
  const next = {
    ...getDefaultPermanentUnlocks(),
    ...p,
    mutatorsUnlocked: Array.isArray(p.mutatorsUnlocked) ? [...p.mutatorsUnlocked] : []
  };

  const idx = Math.max(0, Math.round(Number(levelIndex) || 0));
  const unlockIds = [];
  for (const m of ROGUELITE_MUTATOR_CATALOG) {
    const atLevel = Number.isFinite(m?.unlock?.atLevel) ? Math.round(m.unlock.atLevel) : null;
    if (atLevel === null) continue;
    if (idx >= atLevel) unlockIds.push(String(m.id));
  }

  const set = new Set(next.mutatorsUnlocked.map(String));
  let changed = false;
  for (const id of unlockIds) {
    if (set.has(id)) continue;
    set.add(id);
    changed = true;
  }
  if (changed) next.mutatorsUnlocked = [...set];
  return { next, changed };
}
