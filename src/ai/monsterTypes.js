/**
 * Monster Type Configurations
 * Defines different monster behaviors and characteristics
 */

export const MonsterTypes = {
  /**
   * HUNTER - Fast, aggressive, persistent tracker
   */
  HUNTER: {
    id: 'HUNTER',
    name: 'Hunter',
    aiType: 'hunter',
    model: '/models/monster.png',
    sprite: '/models/monster.png',
    spriteFramesPath: '../assets/moonman-sequence',
    spriteFrameRate: 10,

    // Physical stats
    stats: {
      speedFactor: 1.1,        // 相對於玩家基礎速度 * MONSTER_BASE_SPEED_FACTOR
      visionRange: 18,         // Units
      visionFOV: Math.PI * 140 / 180,  // 140 degrees
      hearingRange: 12,        // Units (detects sprinting player)
      smellRange: 12,          // Grid tiles (scaled by CONFIG.AI_BASE_SMELL)
      scale: 1,              // Model scale (FIXED: increased for visibility)
    },

    // AI behavior parameters
    behavior: {
      aggressiveness: 'high',
      chaseMemory: 10000,      // 10 seconds
      chaseCooldown: 8000,     // 8s cooldown before re-engaging after giving up
      searchRadius: 5,         // Grid units to search
      searchDuration: 8000,    // 8 seconds search time
      patrolStyle: 'active',   // active, random, zone
      patrolSpeed: 0.85,       // 略降巡航，減少頻繁重算
      pauseChance: 0.02,
      preferredMode: 'chase'
    },

    combat: {
      contactDamage: 10,
      contactCooldown: 1.7,
      contactChance: 0.65,
      ranged: {
        enabled: true,
        kind: 'bolt',
        damage: 8,
        cooldown: 1.05,
        fireChance: 0.75,
        range: 14,
        minRange: 4,
        spread: 0.045,
        color: 0xff8844
      }
    },

    // Animation mappings
    animations: {
      idle: ['Idle', 'idle'],
      walk: ['Walk', 'walk', 'Walking'],
      run: ['Run', 'run', 'Running'],
      attack: ['Attack', 'attack']
    },

    // Visual appearance
    appearance: {
      emissiveColor: 0xff0000,  // Red glow
      emissiveIntensity: 0.3
    }
  },

  /**
   * WANDERER - Slow, oblivious, autonomous
   */
  WANDERER: {
    id: 'WANDERER',
    name: 'Wanderer',
    aiType: 'autopilotWanderer',
    model: '/models/monster.png',
    sprite: '/models/monster.png',
    spriteFramesPath: '../assets/moonman-sequence',
    spriteFrameRate: 8,

    stats: {
      speedFactor: 0.8,        // 低於基準
      visionRange: 10,
      visionFOV: Math.PI / 2,  // 90 degrees
      hearingRange: 5,         // Poor hearing
      smellRange: 5,           // Poor smell
      scale: 1,                // Model scale (FIXED: increased for visibility)
    },

    behavior: {
      aggressiveness: 'low',
      chaseMemory: 3000,       // 3 seconds (gives up quickly)
      chaseCooldown: 5000,     // cooldown before re-engaging
      searchRadius: 2,
      searchDuration: 3000,
      patrolStyle: 'random',
      patrolSpeed: 0.75,       // 略降巡航
      pauseChance: 0.05,
      preferredMode: 'wander'
    },

    combat: {
      contactDamage: 10,
      contactCooldown: 2.6,
      contactChance: 0.35
    },

    animations: {
      idle: ['Idle', 'idle'],
      walk: ['Walk', 'walk'],
      run: ['Run', 'run']
    },

    appearance: {
      emissiveColor: 0xffff00,  // Yellow glow
      emissiveIntensity: 0.2
    }
  },

  /**
   * SENTINEL - Zone guardian with wide vision
   */
  SENTINEL: {
    id: 'SENTINEL',
    name: 'Sentinel',
    aiType: 'roomHunter',
    model: '/models/monster.png',
    sprite: '/models/monster.png',
    spriteFramesPath: '../assets/moonman-sequence',
    spriteFrameRate: 6,

    stats: {
      speedFactor: 1.0,        // 巡邏基準
      visionRange: 20,         // Very long sight
      visionFOV: Math.PI * 160 / 180,  // 160 degrees (nearly 180)
      hearingRange: 15,
      smellRange: 8,
      scale: 1,                 // Model scale (FIXED: increased for visibility)
    },

    behavior: {
      aggressiveness: 'medium',
      chaseMemory: 5000,       // 5 seconds
      chaseCooldown: 6000,
      searchRadius: 3,
      searchDuration: 5000,
      patrolStyle: 'zone',     // Patrols specific area
      patrolSpeed: 0.8,
      pauseChance: 0.05,
      returnToZone: true,      // Returns to assigned area after chase
      preferredMode: 'patrol'
    },

    combat: {
      contactDamage: 10,
      contactCooldown: 2.0,
      contactChance: 0.55,
      ranged: {
        enabled: true,
        kind: 'bolt',
        damage: 7,
        cooldown: 1.5,
        fireChance: 0.72,
        range: 18,
        minRange: 5,
        spread: 0.02,
        color: 0x66ccff
      }
    },

    animations: {
      idle: ['Idle', 'idle'],
      walk: ['Walk', 'walk'],
      run: ['Run', 'run']
    },

    appearance: {
      emissiveColor: 0x00ff00,  // Green glow
      emissiveIntensity: 0.25
    }
  },

  /**
   * STALKER - Follows at distance, sneaky
   */
  STALKER: {
    id: 'STALKER',
    name: 'Stalker',
    aiType: 'distanceStalker',
    model: '/models/monster.png',
    sprite: '/models/monster.png',
    spriteFramesPath: '../assets/moonman-sequence',
    spriteFrameRate: 9,

    stats: {
      speedFactor: 1.1,
      visionRange: 22,         // Excellent vision
      visionFOV: Math.PI * 100 / 180,  // 100 degrees (focused)
      hearingRange: 18,        // Excellent hearing
      smellRange: 16,          // Excellent smell
      scale: 1,               // Model scale (FIXED: increased for visibility)
    },

    behavior: {
      aggressiveness: 'medium',
      chaseMemory: 15000,      // 15 seconds (persistent)
      chaseCooldown: 8000,
      searchRadius: 7,
      searchDuration: 12000,   // Long search time
      patrolStyle: 'stealth',  // Follows player at distance
      patrolSpeed: 0.9,
      pauseChance: 0.08,
      preferredMode: 'stalk',
      followDistance: 8        // Stays 8 units away
    },

    combat: {
      contactDamage: 10,
      contactCooldown: 2.2,
      contactChance: 0.45,
      ranged: {
        enabled: true,
        kind: 'bolt',
        damage: 6,
        cooldown: 1.8,
        range: 16,
        minRange: 6,
        spread: 0.03,
        fireChance: 0.55,
        color: 0xaa66ff
      }
    },

    animations: {
      idle: ['Idle', 'idle'],
      walk: ['Walk', 'walk'],
      run: ['Run', 'run']
    },

    appearance: {
      emissiveColor: 0x8800ff,  // Purple glow
      emissiveIntensity: 0.2
    }
  },

  /**
   * RUSHER - Extremely fast but short memory
   */
  RUSHER: {
    id: 'RUSHER',
    name: 'Rusher',
    aiType: 'speedJitter',
    model: '/models/monster.png',
    sprite: '/models/monster.png',
    spriteFramesPath: '../assets/moonman-sequence',
    spriteFrameRate: 12,

    stats: {
      speedFactor: 1.0,        // 基準，靠衝刺／jitter 拉高
      visionRange: 12,
      visionFOV: Math.PI * 110 / 180,
      hearingRange: 8,
      smellRange: 10,
      scale: 1,                  // Model scale (FIXED: increased for visibility)
    },

    behavior: {
      aggressiveness: 'very_high',
      chaseMemory: 2000,       // 2 seconds (short attention)
      chaseCooldown: 4000,
      searchRadius: 1,         // Doesn't search much
      searchDuration: 2000,
      patrolStyle: 'active',
      patrolSpeed: 1.0,        // 略降巡航
      pauseChance: 0.01,
      preferredMode: 'chase'
    },

    combat: {
      contactDamage: 10,
      contactCooldown: 1.25,
      contactChance: 0.9
    },

    // Optional modular AI additions (composed in createMonsterBrain)
    brain: {
      modules: {
        noiseInvestigation: true,
        flankCoverTactics: true
      }
    },

    animations: {
      idle: ['Idle', 'idle'],
      walk: ['Run', 'run'],    // Always runs
      run: ['Run', 'run']
    },

    appearance: {
      emissiveColor: 0xff6600,  // Orange glow
      emissiveIntensity: 0.4
    }
  },

  /**
   * WEEPING_ANGEL - "木頭人": freezes when the player looks at it
   */
  WEEPING_ANGEL: {
    id: 'WEEPING_ANGEL',
    name: 'Weeping Angel',
    aiType: 'weepingAngel',
    model: '/models/monster.png',
    sprite: '/models/monster.png',
    spriteFramesPath: '../assets/moonman-sequence',
    spriteFrameRate: 10,

    stats: {
      speedFactor: 0.95,
      visionRange: 14,
      visionFOV: Math.PI * 120 / 180,
      hearingRange: 10,
      smellRange: 14,
      scale: 1,
    },

    behavior: {
      aggressiveness: 'high',
      patrolStyle: 'stalk',
      preferredMode: 'hunt'
    },

    combat: {
      contactDamage: 12,
      contactCooldown: 1.8,
      contactChance: 0.65
    },

    // Brain overrides (merged into config by MonsterManager.buildBrainConfig)
    brain: {
      memorySeconds: 12.0,
      unseenSpeedMultiplier: 2.2,
      wanderSpeedMultiplier: 1.0,
      freezeFovMarginDeg: 7,
      freezeRequiresLineOfSight: true,
      noiseMemorySeconds: 2.4
    },

    animations: {
      idle: ['Idle', 'idle'],
      walk: ['Walk', 'walk'],
      run: ['Run', 'run']
    },

    appearance: {
      emissiveColor: 0xffffff,  // Cold white glow
      emissiveIntensity: 0.22
    }
  },

  /**
   * GREETER - Friendly-ish guide that keeps some distance
   */
  GREETER: {
    id: 'GREETER',
    name: 'Greeter',
    aiType: 'shyGreeter',
    sprite: '/models/greeter.png',
    spriteFramesPath: '../assets/moonman-sequence',
    spriteFrameRate: 7,
    color: 0x33ccff,

    stats: {
      speedFactor: 0.6,
      visionRange: 12,
      visionFOV: Math.PI * 160 / 180,
      hearingRange: 6,
      smellRange: 0,
      scale: 0.9,
    },

    behavior: {
      greetDistance: 4,
      avoidPlayerDistance: 2,
      memoryDuration: 4000,
    },

    combat: {
      contactDamage: 0
    },
  },

  /**
   * BOSS_CORE - L10 boss (shielded until nodes are destroyed).
   * NOTE: boss phases are orchestrated by BossSystem; this config sets baseline combat/presence.
   */
  BOSS_CORE: {
    id: 'BOSS_CORE',
    name: 'The Core',
    aiType: 'roomHunter',
    model: '/models/monster.png',
    sprite: '/models/monster.png',
    spriteFramesPath: '../assets/moonman-sequence',
    spriteFrameRate: 8,

    stats: {
      speedFactor: 0.95,
      visionRange: 24,
      visionFOV: Math.PI * 150 / 180,
      hearingRange: 18,
      smellRange: 18,
      scale: 1.7,
    },

    behavior: {
      aggressiveness: 'high',
      chaseMemory: 18000,
      chaseCooldown: 4000,
      searchRadius: 7,
      searchDuration: 14000,
      patrolStyle: 'zone',
      patrolSpeed: 0.9,
      pauseChance: 0.02,
      preferredMode: 'chase'
    },

    combat: {
      contactDamage: 14,
      contactCooldown: 1.35,
      contactChance: 0.7,
      hitStunSeconds: 0.18,
      ranged: {
        enabled: true,
        kind: 'bolt',
        damage: 10,
        cooldown: 0.7,
        fireChance: 0.85,
        range: 20,
        minRange: 4,
        spread: 0.02,
        color: 0x40c4ff
      }
    },

    appearance: {
      emissiveColor: 0x40c4ff,
      emissiveIntensity: 0.55
    }
  },

  /**
   * SCENT_HOUND - Weak vision, strong scent tracking
   */
  SCENT_HOUND: {
    id: 'SCENT_HOUND',
    name: 'Scent Hound',
    aiType: 'hunter',
    model: '/models/monster.png',
    sprite: '/models/monster.png',
    spriteFramesPath: '../assets/moonman-sequence',
    spriteFrameRate: 11,

    stats: {
      speedFactor: 1.05,
      visionRange: 9,
      visionFOV: Math.PI * 105 / 180,
      hearingRange: 10,
      smellRange: 22,
      scale: 1
    },

    behavior: {
      aggressiveness: 'high',
      chaseMemory: 12000,
      chaseCooldown: 6500,
      searchRadius: 6,
      searchDuration: 9000,
      patrolStyle: 'active',
      patrolSpeed: 0.85,
      pauseChance: 0.03,
      preferredMode: 'chase'
    },

    combat: {
      contactDamage: 10,
      contactCooldown: 1.9,
      contactChance: 0.6
    },

    appearance: {
      emissiveColor: 0x8bc34a,
      emissiveIntensity: 0.25
    }
  },

  /**
   * HEARING_HUNTER - Very sensitive to noise
   */
  HEARING_HUNTER: {
    id: 'HEARING_HUNTER',
    name: 'Hearing Hunter',
    aiType: 'hunter',
    model: '/models/monster.png',
    sprite: '/models/monster.png',
    spriteFramesPath: '../assets/moonman-sequence',
    spriteFrameRate: 10,

    stats: {
      speedFactor: 1.0,
      visionRange: 14,
      visionFOV: Math.PI * 130 / 180,
      hearingRange: 22,
      smellRange: 8,
      scale: 1
    },

    behavior: {
      aggressiveness: 'high',
      chaseMemory: 9000,
      chaseCooldown: 6000,
      searchRadius: 5,
      searchDuration: 7000,
      patrolStyle: 'active',
      patrolSpeed: 0.85,
      pauseChance: 0.02,
      preferredMode: 'chase'
    },

    combat: {
      contactDamage: 10,
      contactCooldown: 1.8,
      contactChance: 0.6
    },

    appearance: {
      emissiveColor: 0xffc107,
      emissiveIntensity: 0.28
    }
  },

  /**
   * SECURITY_GUARD - Zone guardian that tends to hold its ground
   */
  SECURITY_GUARD: {
    id: 'SECURITY_GUARD',
    name: 'Security Guard',
    aiType: 'roomHunter',
    model: '/models/monster.png',
    sprite: '/models/monster.png',
    spriteFramesPath: '../assets/moonman-sequence',
    spriteFrameRate: 7,

    stats: {
      speedFactor: 0.9,
      visionRange: 18,
      visionFOV: Math.PI * 150 / 180,
      hearingRange: 14,
      smellRange: 10,
      scale: 1
    },

    behavior: {
      aggressiveness: 'medium',
      chaseMemory: 4500,
      chaseCooldown: 7000,
      searchRadius: 3,
      searchDuration: 4500,
      patrolStyle: 'zone',
      patrolSpeed: 0.8,
      pauseChance: 0.05,
      returnToZone: true,
      preferredMode: 'patrol'
    },

    combat: {
      contactDamage: 10,
      contactCooldown: 2.2,
      contactChance: 0.5
    },

    appearance: {
      emissiveColor: 0x00e676,
      emissiveIntensity: 0.22
    }
  },

  /**
   * SPLITTER - Splits into smaller monsters when killed
   */
  SPLITTER: {
    id: 'SPLITTER',
    name: 'Splitter',
    aiType: 'hunter',
    model: '/models/monster.png',
    sprite: '/models/monster.png',
    spriteFramesPath: '../assets/moonman-sequence',
    spriteFrameRate: 10,

    stats: {
      speedFactor: 0.95,
      visionRange: 14,
      visionFOV: Math.PI * 120 / 180,
      hearingRange: 12,
      smellRange: 12,
      health: 9,
      scale: 1
    },

    behavior: {
      aggressiveness: 'medium',
      chaseMemory: 8000,
      chaseCooldown: 7000,
      searchRadius: 5,
      searchDuration: 7000,
      patrolStyle: 'active',
      patrolSpeed: 0.82,
      pauseChance: 0.03,
      preferredMode: 'chase'
    },

    special: {
      splitOnDeath: {
        count: 2,
        childType: 'RUSHER',
        childScaleMult: 0.75,
        childHealthMult: 0.6
      }
    },

    combat: {
      contactDamage: 10,
      contactCooldown: 1.9,
      contactChance: 0.55
    },

    appearance: {
      emissiveColor: 0xff1744,
      emissiveIntensity: 0.25
    }
  },

  /**
   * SHADOW - Weeping-angel style stalker (fast when unseen)
   */
  SHADOW: {
    id: 'SHADOW',
    name: 'Shadow',
    aiType: 'weepingAngel',
    model: '/models/monster.png',
    sprite: '/models/monster.png',
    spriteFramesPath: '../assets/moonman-sequence',
    spriteFrameRate: 10,

    stats: {
      speedFactor: 0.9,
      visionRange: 12,
      visionFOV: Math.PI * 120 / 180,
      hearingRange: 12,
      smellRange: 12,
      scale: 1
    },

    behavior: {
      aggressiveness: 'high',
      patrolStyle: 'stalk',
      preferredMode: 'hunt'
    },

    brain: {
      memorySeconds: 10.0,
      unseenSpeedMultiplier: 2.5,
      wanderSpeedMultiplier: 0.95,
      freezeFovMarginDeg: 6,
      freezeRequiresLineOfSight: true,
      noiseMemorySeconds: 2.2
    },

    combat: {
      contactDamage: 12,
      contactCooldown: 1.7,
      contactChance: 0.65
    },

    appearance: {
      emissiveColor: 0xb388ff,
      emissiveIntensity: 0.18
    }
  },

  /**
   * AMBUSHER - Reacts aggressively to player movement/noise
   */
  AMBUSHER: {
    id: 'AMBUSHER',
    name: 'Ambusher',
    aiType: 'speedJitter',
    model: '/models/monster.png',
    sprite: '/models/monster.png',
    spriteFramesPath: '../assets/moonman-sequence',
    spriteFrameRate: 12,

    stats: {
      speedFactor: 1.0,
      visionRange: 10,
      visionFOV: Math.PI * 110 / 180,
      hearingRange: 18,
      smellRange: 10,
      scale: 1
    },

    behavior: {
      aggressiveness: 'very_high',
      chaseMemory: 3500,
      chaseCooldown: 4500,
      searchRadius: 2,
      searchDuration: 2500,
      patrolStyle: 'active',
      patrolSpeed: 0.95,
      pauseChance: 0.01,
      preferredMode: 'chase'
    },

    combat: {
      contactDamage: 10,
      contactCooldown: 1.35,
      contactChance: 0.8
    },

    appearance: {
      emissiveColor: 0xff6f00,
      emissiveIntensity: 0.3
    }
  },

  /**
   * COMMANDER - Buffs nearby monsters (speed aura)
   */
  COMMANDER: {
    id: 'COMMANDER',
    name: 'Commander',
    aiType: 'roomHunter',
    model: '/models/monster.png',
    sprite: '/models/monster.png',
    spriteFramesPath: '../assets/moonman-sequence',
    spriteFrameRate: 8,

    stats: {
      speedFactor: 0.9,
      visionRange: 16,
      visionFOV: Math.PI * 140 / 180,
      hearingRange: 14,
      smellRange: 12,
      health: 14,
      scale: 1.05
    },

    behavior: {
      aggressiveness: 'medium',
      chaseMemory: 7500,
      chaseCooldown: 7000,
      searchRadius: 4,
      searchDuration: 6500,
      patrolStyle: 'zone',
      patrolSpeed: 0.85,
      pauseChance: 0.03,
      returnToZone: true,
      preferredMode: 'patrol'
    },

    special: {
      commanderAura: {
        radiusTiles: 8,
        speedMult: 1.25
      }
    },

    combat: {
      contactDamage: 10,
      contactCooldown: 2.0,
      contactChance: 0.5
    },

    appearance: {
      emissiveColor: 0x40c4ff,
      emissiveIntensity: 0.24
    }
  },

  /**
   * DREAD - Emits a fear aura (camera jitter/pressure)
   */
  DREAD: {
    id: 'DREAD',
    name: 'Dread',
    aiType: 'distanceStalker',
    model: '/models/monster.png',
    sprite: '/models/monster.png',
    spriteFramesPath: '../assets/moonman-sequence',
    spriteFrameRate: 9,

    stats: {
      speedFactor: 0.95,
      visionRange: 18,
      visionFOV: Math.PI * 110 / 180,
      hearingRange: 14,
      smellRange: 14,
      scale: 1
    },

    behavior: {
      aggressiveness: 'medium',
      chaseMemory: 12000,
      chaseCooldown: 8000,
      searchRadius: 6,
      searchDuration: 9000,
      patrolStyle: 'stealth',
      patrolSpeed: 0.85,
      pauseChance: 0.06,
      preferredMode: 'stalk',
      followDistance: 7
    },

    special: {
      fearAura: {
        radiusTiles: 8,
        maxIntensity: 0.9
      }
    },

    combat: {
      contactDamage: 10,
      contactCooldown: 2.1,
      contactChance: 0.5
    },

    appearance: {
      emissiveColor: 0x7c4dff,
      emissiveIntensity: 0.2
    }
  },

  /**
   * NEST_GUARDIAN - Tough guardian archetype
   */
  NEST_GUARDIAN: {
    id: 'NEST_GUARDIAN',
    name: 'Nest Guardian',
    aiType: 'roomHunter',
    model: '/models/monster.png',
    sprite: '/models/monster.png',
    spriteFramesPath: '../assets/moonman-sequence',
    spriteFrameRate: 7,

    stats: {
      speedFactor: 0.85,
      visionRange: 16,
      visionFOV: Math.PI * 150 / 180,
      hearingRange: 12,
      smellRange: 12,
      health: 18,
      scale: 1.1
    },

    behavior: {
      aggressiveness: 'medium',
      chaseMemory: 8000,
      chaseCooldown: 8000,
      searchRadius: 4,
      searchDuration: 7000,
      patrolStyle: 'zone',
      patrolSpeed: 0.78,
      pauseChance: 0.05,
      returnToZone: true,
      preferredMode: 'patrol'
    },

    combat: {
      contactDamage: 12,
      contactCooldown: 2.2,
      contactChance: 0.55,
      hitStunSeconds: 0.2
    },

    appearance: {
      emissiveColor: 0xa1887f,
      emissiveIntensity: 0.2
    }
  }
};

/**
 * Get a random monster type
 * @returns {Object} Monster type configuration
 */
export function getRandomMonsterType() {
  const types = Object.values(MonsterTypes);
  const randomIndex = Math.floor(Math.random() * types.length);
  return types[randomIndex];
}

/**
 * Get monster type by name
 * @param {string} typeName - Type name (HUNTER, WANDERER, etc.)
 * @returns {Object} Monster type configuration
 */
export function getMonsterType(typeName) {
  return MonsterTypes[typeName] || MonsterTypes.HUNTER;
}

/**
 * Create a balanced mix of monster types
 * @param {number} count - Total number of monsters
 * @returns {Array<Object>} Array of monster type configurations
 */
export function createMonsterMix(count, weights = null) {
  const mix = [];
  const desired = Math.max(0, Math.round(count || 0));
  if (desired <= 0) return mix;

  if (!weights) {
    // Legacy behavior: ensure at least one of each main type if count >= 3
    if (desired >= 3) {
      mix.push(MonsterTypes.HUNTER);
      mix.push(MonsterTypes.WANDERER);
      mix.push(MonsterTypes.SENTINEL);
    }
    while (mix.length < desired) {
      mix.push(getRandomMonsterType());
    }
    for (let i = mix.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [mix[i], mix[j]] = [mix[j], mix[i]];
    }
    return mix;
  }

  const candidates = [];
  for (const [name, w] of Object.entries(weights || {})) {
    const type = MonsterTypes[name];
    const weight = Number(w);
    if (!type) continue;
    if (!Number.isFinite(weight) || weight <= 0) continue;
    candidates.push({ name, type, weight });
  }

  // If a bad/too-narrow weight table is provided, fall back to a sensible default mix.
  if (candidates.length === 0) {
    return createMonsterMix(desired, null);
  }

  // Enforce at least 2 distinct types when spawning 2+ monsters (protects against "all Hunter" tables).
  if (desired >= 2 && candidates.length < 2) {
    const avoid = candidates[0]?.type?.id || null;
    const fallback = ['STALKER', 'SENTINEL', 'RUSHER', 'WANDERER', 'WEEPING_ANGEL'];
    for (const key of fallback) {
      const type = MonsterTypes[key];
      if (!type || type.id === avoid) continue;
      candidates.push({ name: key, type, weight: Math.max(0.1, candidates[0].weight * 0.25) });
      break;
    }
  }

  const pickWeighted = (list) => {
    if (!list || list.length === 0) return null;
    const total = list.reduce((acc, e) => acc + Math.max(0, Number(e?.weight) || 0), 0);
    if (!(total > 0)) {
      return list[Math.floor(Math.random() * list.length)];
    }
    let r = Math.random() * total;
    for (const entry of list) {
      r -= Math.max(0, Number(entry?.weight) || 0);
      if (r <= 0) return entry;
    }
    return list[list.length - 1];
  };

  // Weighted without replacement for the first `distinctCount` picks.
  const remaining = candidates.slice();
  const distinctCount = Math.min(desired, remaining.length);
  for (let i = 0; i < distinctCount; i++) {
    const picked = pickWeighted(remaining) || remaining[0];
    if (!picked) break;
    mix.push(picked.type || MonsterTypes.HUNTER);
    const idx = remaining.indexOf(picked);
    if (idx !== -1) remaining.splice(idx, 1);
  }

  // Fill the rest with replacement.
  while (mix.length < desired) {
    const picked = pickWeighted(candidates) || candidates[0];
    mix.push(picked?.type || MonsterTypes.HUNTER);
  }

  // Shuffle final order to avoid deterministic role ordering.
  for (let i = mix.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [mix[i], mix[j]] = [mix[j], mix[i]];
  }

  return mix;
}
