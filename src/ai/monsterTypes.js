/**
 * Monster Type Configurations
 * Defines different monster behaviors and characteristics
 */

export const MonsterTypes = {
  /**
   * HUNTER - Fast, aggressive, persistent tracker
   */
  HUNTER: {
    name: 'Hunter',
    aiType: 'autopilotWanderer',
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
    name: 'Sentinel',
    aiType: 'autopilotWanderer',
    model: '/models/monster.png',
    sprite: '/models/monster.png',
    spriteFramesPath: '../assets/moonman-sequence',
    spriteFrameRate: 6,

    stats: {
      speedFactor: 1.0,        // 巡邏基準
      visionRange: 20,         // Very long sight
      visionFOV: Math.PI * 160 / 180,  // 160 degrees (nearly 180)
      hearingRange: 15,
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
    name: 'Stalker',
    aiType: 'autopilotWanderer',
    model: '/models/monster.png',
    sprite: '/models/monster.png',
    spriteFramesPath: '../assets/moonman-sequence',
    spriteFrameRate: 9,

    stats: {
      speedFactor: 1.1,
      visionRange: 22,         // Excellent vision
      visionFOV: Math.PI * 100 / 180,  // 100 degrees (focused)
      hearingRange: 18,        // Excellent hearing
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
    name: 'Rusher',
    aiType: 'autopilotWanderer',
    model: '/models/monster.png',
    sprite: '/models/monster.png',
    spriteFramesPath: '../assets/moonman-sequence',
    spriteFrameRate: 12,

    stats: {
      speedFactor: 1.0,        // 基準，靠衝刺／jitter 拉高
      visionRange: 12,
      visionFOV: Math.PI * 110 / 180,
      hearingRange: 8,
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
   * GREETER - Friendly-ish guide that keeps some distance
   */
  GREETER: {
    name: 'GREETER',
    aiType: 'autopilotWanderer',
    sprite: '/models/greeter.png',
    spriteFramesPath: '../assets/moonman-sequence',
    spriteFrameRate: 7,
    color: 0x33ccff,

    stats: {
      speedFactor: 0.6,
      visionRange: 12,
      visionFOV: Math.PI * 160 / 180,
      hearingRange: 6,
      scale: 0.9,
    },

    behavior: {
      greetDistance: 4,
      avoidPlayerDistance: 2,
      memoryDuration: 4000,
    },
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

  if (!weights) {
    // Legacy behavior: ensure at least one of each main type if count >= 3
    if (count >= 3) {
      mix.push(MonsterTypes.HUNTER);
      mix.push(MonsterTypes.WANDERER);
      mix.push(MonsterTypes.SENTINEL);
    }
    while (mix.length < count) {
      mix.push(getRandomMonsterType());
    }
    for (let i = mix.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [mix[i], mix[j]] = [mix[j], mix[i]];
    }
    return mix;
  }

  const entries = Object.entries(weights);
  const sum = entries.reduce((acc, [, w]) => acc + w, 0) || 1;
  const normalized = entries.map(([name, w]) => [name, w / sum]);

  for (let i = 0; i < count; i++) {
    const r = Math.random();
    let acc = 0;
    for (const [name, p] of normalized) {
      acc += p;
      if (r <= acc) {
        mix.push(MonsterTypes[name] || MonsterTypes.HUNTER);
        break;
      }
    }
  }

  return mix;
}
