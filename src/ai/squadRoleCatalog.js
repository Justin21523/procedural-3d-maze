import { CONFIG } from '../core/config.js';

function normalizeRole(role) {
  return String(role || '').trim().toLowerCase();
}

export function getSquadRoleBrainDefaults(role) {
  const r = normalizeRole(role);

  const base = {
    modules: {
      squadCoordination: true,
      noiseInvestigation: true
    },
    tactics: null,
    combat: {
      focusFireEnabled: true
    },
    squad: {
      memorySeconds: CONFIG.AI_SQUAD_MEMORY_SECONDS ?? 6.5,
      noiseShareSeconds: CONFIG.AI_SQUAD_NOISE_SHARE_SECONDS ?? 2.0
    }
  };

  if (r === 'leader') {
    return {
      ...base,
      tactics: { enabled: false },
      combat: {
        ...base.combat,
        roleShotIntervalMult: 1.0,
        roleBurstRestMult: 1.0
      }
    };
  }

  if (r === 'flanker' || r === 'scout') {
    return {
      ...base,
      modules: { ...base.modules, flankCoverTactics: true },
      combat: {
        ...base.combat,
        roleShotIntervalMult: 1.15,
        roleBurstRestMult: 1.25
      },
      tactics: {
        enabled: true,
        coverEnabled: false,
        flankSlots: 8,
        flankMinDist: 2,
        flankMaxDist: 4
      },
      squad: {
        ...base.squad,
        flankSlotKeepSeconds: CONFIG.AI_SQUAD_FLANK_SLOT_KEEP_SECONDS ?? 8.0,
        flankTargetKeepSeconds: 2.6
      }
    };
  }

  if (r === 'cover' || r === 'support') {
    return {
      ...base,
      modules: { ...base.modules, flankCoverTactics: true },
      combat: {
        ...base.combat,
        roleShotIntervalMult: 0.95,
        roleBurstRestMult: 0.9,
        coverSuppressEnabled: true,
        coverSuppressFireSeconds: 1.5,
        coverSuppressRestSeconds: 0.9
      },
      tactics: {
        enabled: true,
        coverEnabled: true,
        coverRadius: 8,
        coverHealthThreshold: 0.65,
        coverRecentHitSeconds: 2.2,
        flankSlots: 6,
        flankMinDist: 3,
        flankMaxDist: 5
      },
      squad: {
        ...base.squad,
        coverFireEnabled: true,
        coverFireRadius: 9,
        coverFireMinDist: 6,
        coverFireMaxDist: 16
      }
    };
  }

  if (r === 'rusher') {
    return {
      ...base,
      tactics: { enabled: false },
      combat: {
        ...base.combat,
        roleShotIntervalMult: 0.95,
        roleBurstRestMult: 0.95
      }
    };
  }

  return base;
}
