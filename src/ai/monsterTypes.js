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
    model: '/models/fuzzlefox__cute_stylized_cartoon_fox_character.glb',

    // Physical stats
    stats: {
      speed: 3.6,              // 120% of base speed
      visionRange: 18,         // Units
      visionFOV: Math.PI * 140 / 180,  // 140 degrees
      hearingRange: 12,        // Units (detects sprinting player)
      scale: 2.5              // Model scale (FIXED: increased for visibility)
    },

    // AI behavior parameters
    behavior: {
      aggressiveness: 'high',
      chaseMemory: 10000,      // 10 seconds
      searchRadius: 5,         // Grid units to search
      searchDuration: 8000,    // 8 seconds search time
      patrolStyle: 'active',   // active, random, zone
      patrolSpeed: 0.8,        // Fast even when patrolling
      pauseChance: 0.1,        // 10% chance to pause
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
    model: '/models/cute_chick.glb',

    stats: {
      speed: 2.1,              // 70% of base speed
      visionRange: 10,
      visionFOV: Math.PI / 2,  // 90 degrees
      hearingRange: 5,         // Poor hearing
      scale: 2.2              // Model scale (FIXED: increased for visibility)
    },

    behavior: {
      aggressiveness: 'low',
      chaseMemory: 3000,       // 3 seconds (gives up quickly)
      searchRadius: 2,
      searchDuration: 3000,
      patrolStyle: 'random',
      patrolSpeed: 0.5,        // Slow patrolling
      pauseChance: 0.3,        // 30% chance to pause
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
    model: '/models/pbr_low-poly_fox_character.glb',

    stats: {
      speed: 2.7,              // 90% of base speed
      visionRange: 20,         // Very long sight
      visionFOV: Math.PI * 160 / 180,  // 160 degrees (nearly 180)
      hearingRange: 15,
      scale: 2.8              // Model scale (FIXED: increased for visibility)
    },

    behavior: {
      aggressiveness: 'medium',
      chaseMemory: 5000,       // 5 seconds
      searchRadius: 3,
      searchDuration: 5000,
      patrolStyle: 'zone',     // Patrols specific area
      patrolSpeed: 0.6,
      pauseChance: 0.2,
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
    model: '/models/fuzzlefox__cute_stylized_cartoon_fox_character.glb',

    stats: {
      speed: 3.0,
      visionRange: 22,         // Excellent vision
      visionFOV: Math.PI * 100 / 180,  // 100 degrees (focused)
      hearingRange: 18,        // Excellent hearing
      scale: 2.3              // Model scale (FIXED: increased for visibility)
    },

    behavior: {
      aggressiveness: 'medium',
      chaseMemory: 15000,      // 15 seconds (persistent)
      searchRadius: 7,
      searchDuration: 12000,   // Long search time
      patrolStyle: 'stealth',  // Follows player at distance
      patrolSpeed: 0.7,
      pauseChance: 0.4,        // Often stops to listen
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
    model: '/models/cute_chick.glb',

    stats: {
      speed: 4.5,              // 150% speed (very fast!)
      visionRange: 12,
      visionFOV: Math.PI * 110 / 180,
      hearingRange: 8,
      scale: 2.0              // Model scale (FIXED: increased for visibility)
    },

    behavior: {
      aggressiveness: 'very_high',
      chaseMemory: 2000,       // 2 seconds (short attention)
      searchRadius: 1,         // Doesn't search much
      searchDuration: 2000,
      patrolStyle: 'active',
      patrolSpeed: 0.9,        // Always moving fast
      pauseChance: 0.05,       // Rarely pauses
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
export function createMonsterMix(count) {
  const mix = [];

  // Ensure at least one of each main type if count >= 3
  if (count >= 3) {
    mix.push(MonsterTypes.HUNTER);
    mix.push(MonsterTypes.WANDERER);
    mix.push(MonsterTypes.SENTINEL);
  }

  // Fill remaining slots randomly
  while (mix.length < count) {
    mix.push(getRandomMonsterType());
  }

  // Shuffle array
  for (let i = mix.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [mix[i], mix[j]] = [mix[j], mix[i]];
  }

  return mix;
}
