import { ROOM_TYPES } from '../world/tileTypes.js';

// Data-driven level catalog (fallback when public/levels cannot be loaded).
// Keep this in sync with `public/levels/*.json` (10-level campaign).
export const LEVEL_CATALOG = [
  {
    id: 1,
    name: 'L1 - Orientation',
    maze: { width: 21, height: 21, roomDensity: 1.9, extraConnectionChance: 0.05 },
    rooms: {
      typeWeights: {
        [ROOM_TYPES.CLASSROOM]: 3.2,
        [ROOM_TYPES.CLASSROOMS_BLOCK]: 1.3,
        [ROOM_TYPES.OFFICE]: 1.5,
        [ROOM_TYPES.BATHROOM]: 0.85,
        [ROOM_TYPES.STORAGE]: 0.7,
        [ROOM_TYPES.LIBRARY]: 0.6,
        [ROOM_TYPES.LAB]: 0.8,
        [ROOM_TYPES.CAFETERIA]: 0.6,
        [ROOM_TYPES.POOL]: 0.25,
        [ROOM_TYPES.GYM]: 0.4,
        [ROOM_TYPES.BEDROOM]: 0.5,
      }
    },
    monsters: {
      count: 2,
      maxCount: 3,
      speedMultiplier: 0.95,
      visionMultiplier: 0.75,
      memoryMultiplier: 0.7,
      typeWeights: { WANDERER: 0.8, HUNTER: 0.2 },
      allowSprintTypes: ['HUNTER'],
    },
    budgets: {
      missionObjectsMax: 25,
    },
    missions: {
      timeLimitSec: 0,
      list: [
        {
          id: 'orientation',
          template: 'enterRoomType',
          required: true,
          params: {
            count: 1,
            roomTypes: [ROOM_TYPES.OFFICE, ROOM_TYPES.LAB],
            hints: [
              'Enter an Office or Lab to get oriented.',
              'Use the minimap to find room blocks quickly.'
            ]
          }
        },
        {
          id: 'evidence',
          template: 'collectEvidence',
          required: true,
          params: {
            count: 3,
            required: 2,
            roomTypes: [ROOM_TYPES.CLASSROOM, ROOM_TYPES.OFFICE, ROOM_TYPES.CLASSROOMS_BLOCK],
            minDistFromSpawn: 6,
            hints: [
              'Collect the evidence pickups.',
              'Stick to Classrooms/Offices for the fastest route.'
            ]
          }
        },
        {
          id: 'kills',
          template: 'killCount',
          required: true,
          params: {
            count: 1,
            hints: [
              'Defeat a monster to learn combat.',
              'Try switching weapons with 1/2/3 and reloading with R.'
            ]
          }
        },
        {
          id: 'unlockExit',
          template: 'unlockExit',
          required: true,
          params: {
            hints: [
              'Go to the exit and press E to unlock it.',
              'After unlocking, press E again to finish the level.'
            ]
          }
        }
      ],
      exit: { requires: ['orientation', 'evidence', 'kills', 'unlockExit'] }
    },
    player: {
      maxHealthMultiplier: 1.0,
      upgradeChoices: ['SPRINT_BOOST', 'EXTRA_HEART'],
      upgradesPerLevel: 1,
    },
    autopilot: {
      avoidRadius: 4,
      replanInterval: 0.6,
      stuckSeconds: 1.2,
      noProgressSeconds: 0.8,
    },
  },
  {
    id: 2,
    name: 'L2 - Keycard Courier',
    maze: { width: 23, height: 23, roomDensity: 2.2, extraConnectionChance: 0.06 },
    rooms: {
      typeWeights: {
        [ROOM_TYPES.CLASSROOM]: 3.0,
        [ROOM_TYPES.CLASSROOMS_BLOCK]: 1.4,
        [ROOM_TYPES.OFFICE]: 1.6,
        [ROOM_TYPES.LAB]: 1.0,
        [ROOM_TYPES.CAFETERIA]: 0.8,
        [ROOM_TYPES.BATHROOM]: 0.75,
        [ROOM_TYPES.STORAGE]: 0.75,
        [ROOM_TYPES.LIBRARY]: 0.65,
        [ROOM_TYPES.POOL]: 0.25,
        [ROOM_TYPES.GYM]: 0.35,
        [ROOM_TYPES.BEDROOM]: 0.45,
      }
    },
    monsters: {
      count: 3,
      maxCount: 4,
      speedMultiplier: 0.98,
      visionMultiplier: 0.85,
      memoryMultiplier: 0.8,
      typeWeights: { WANDERER: 0.55, HUNTER: 0.25, SENTINEL: 0.2 },
      allowSprintTypes: ['HUNTER', 'SENTINEL'],
    },
    budgets: {
      missionObjectsMax: 32,
    },
    missions: {
      timeLimitSec: 0,
      list: [
        {
          id: 'keycard',
          template: 'findKeycard',
          required: true,
          params: {
            roomTypes: [ROOM_TYPES.OFFICE, ROOM_TYPES.LAB],
            minDistFromSpawn: 7,
            label: 'Pick up Keycard',
            hints: [
              'Search Offices and Labs for the keycard.',
              'Once you have it, move on to the upload task.'
            ]
          }
        },
        {
          id: 'upload',
          template: 'uploadEvidence',
          required: true,
          params: {
            count: 4,
            required: 3,
            itemId: 'evidence',
            roomTypesEvidence: [ROOM_TYPES.CLASSROOM, ROOM_TYPES.OFFICE, ROOM_TYPES.CLASSROOMS_BLOCK],
            roomTypesTerminal: [ROOM_TYPES.OFFICE, ROOM_TYPES.LAB],
            minDistFromSpawn: 7,
            hints: [
              'Collect the evidence pickups.',
              'Find the upload terminal and press E to upload (it consumes evidence).'
            ]
          }
        },
        {
          id: 'route',
          template: 'enterRoomType',
          required: false,
          params: {
            count: 1,
            roomTypes: [ROOM_TYPES.CAFETERIA],
            hints: [
              'Visit the Cafeteria to confirm your route through the map.',
              'Stay moving: standing still draws attention.'
            ]
          }
        },
        {
          id: 'unlockExit',
          template: 'unlockExit',
          required: true,
          params: {
            hints: [
              'Go to the exit and press E to unlock it.',
              'After unlocking, press E again to finish the level.'
            ]
          }
        }
      ],
      exit: { requires: ['keycard', 'upload', 'unlockExit'] }
    },
    player: {
      maxHealthMultiplier: 1.0,
      upgradeChoices: ['SPRINT_BOOST', 'EXTRA_HEART', 'MISSION_HINT'],
      upgradesPerLevel: 1,
    },
    autopilot: {
      avoidRadius: 5,
      replanInterval: 0.5,
      stuckSeconds: 1.0,
      noProgressSeconds: 0.6,
    },
  },
  {
    id: 3,
    name: 'L3 - Power & Upload',
    maze: { width: 25, height: 25, roomDensity: 2.5, extraConnectionChance: 0.08 },
    rooms: {
      typeWeights: {
        [ROOM_TYPES.CLASSROOM]: 2.9,
        [ROOM_TYPES.CLASSROOMS_BLOCK]: 1.5,
        [ROOM_TYPES.OFFICE]: 1.4,
        [ROOM_TYPES.LAB]: 1.35,
        [ROOM_TYPES.STORAGE]: 1.1,
        [ROOM_TYPES.CAFETERIA]: 0.75,
        [ROOM_TYPES.BATHROOM]: 0.7,
        [ROOM_TYPES.LIBRARY]: 0.6,
        [ROOM_TYPES.POOL]: 0.2,
        [ROOM_TYPES.GYM]: 0.28,
        [ROOM_TYPES.BEDROOM]: 0.38,
      }
    },
    monsters: {
      count: 4,
      maxCount: 6,
      speedMultiplier: 1.02,
      visionMultiplier: 0.95,
      memoryMultiplier: 0.9,
      typeWeights: { WANDERER: 0.4, HUNTER: 0.35, SENTINEL: 0.2, GREETER: 0.05 },
      allowSprintTypes: ['HUNTER', 'SENTINEL'],
    },
    budgets: {
      missionObjectsMax: 40,
    },
    missions: {
      timeLimitSec: 0,
      list: [
        {
          id: 'power',
          template: 'restorePower',
          required: true,
          params: {
            switches: 2,
            roomTypes: [ROOM_TYPES.LAB, ROOM_TYPES.STORAGE],
            minDistFromSpawn: 7,
            hints: [
              'Find and activate the power switches in Labs/Storage.',
              'Power enables the upload terminal.'
            ]
          }
        },
        {
          id: 'upload',
          template: 'uploadEvidence',
          required: true,
          params: {
            requiresPower: true,
            powerItemId: 'power_on',
            count: 5,
            required: 3,
            itemId: 'evidence',
            roomTypesEvidence: [ROOM_TYPES.CLASSROOM, ROOM_TYPES.OFFICE, ROOM_TYPES.CLASSROOMS_BLOCK],
            roomTypesTerminal: [ROOM_TYPES.OFFICE, ROOM_TYPES.LAB],
            minDistFromSpawn: 7,
            hints: [
              'Collect evidence pickups (you only need 3).',
              'After power is on, find the upload terminal and press E.'
            ]
          }
        },
        {
          id: 'kills',
          template: 'killCount',
          required: true,
          params: {
            count: 3,
            hints: [
              'Defeat monsters to reduce pressure while completing objectives.',
              'Use Q grenade / X EMP if you get surrounded.'
            ]
          }
        },
        {
          id: 'unlockExit',
          template: 'unlockExit',
          required: true,
          params: {
            hints: [
              'Go to the exit and press E to unlock it.',
              'After unlocking, press E again to finish the level.'
            ]
          }
        }
      ],
      exit: { requires: ['power', 'upload', 'kills', 'unlockExit'] }
    },
    player: {
      maxHealthMultiplier: 1.0,
      upgradeChoices: ['SPRINT_BOOST', 'EXTRA_HEART', 'MISSION_HINT', 'SHORT_STEALTH'],
      upgradesPerLevel: 1,
    },
    autopilot: {
      avoidRadius: 5,
      replanInterval: 0.48,
      stuckSeconds: 0.95,
      noProgressSeconds: 0.55,
    },
  },
  {
    id: 4,
    name: 'L4 - Quiet Route',
    maze: { width: 27, height: 27, roomDensity: 2.7, extraConnectionChance: 0.09 },
    rooms: {
      typeWeights: {
        [ROOM_TYPES.CLASSROOM]: 2.7,
        [ROOM_TYPES.CLASSROOMS_BLOCK]: 1.4,
        [ROOM_TYPES.OFFICE]: 1.35,
        [ROOM_TYPES.LAB]: 1.25,
        [ROOM_TYPES.CAFETERIA]: 0.9,
        [ROOM_TYPES.BATHROOM]: 0.75,
        [ROOM_TYPES.STORAGE]: 0.85,
        [ROOM_TYPES.LIBRARY]: 0.75,
        [ROOM_TYPES.POOL]: 0.18,
        [ROOM_TYPES.GYM]: 0.28,
        [ROOM_TYPES.BEDROOM]: 0.38,
      }
    },
    monsters: {
      count: 4,
      maxCount: 6,
      speedMultiplier: 1.04,
      visionMultiplier: 0.98,
      memoryMultiplier: 0.95,
      typeWeights: { WANDERER: 0.35, HUNTER: 0.3, SENTINEL: 0.25, STALKER: 0.1 },
      allowSprintTypes: ['HUNTER', 'SENTINEL'],
    },
    budgets: {
      missionObjectsMax: 35,
    },
    missions: {
      timeLimitSec: 0,
      list: [
        {
          id: 'sequence',
          template: 'enterRoomSequence',
          required: true,
          params: {
            sequence: [ROOM_TYPES.BATHROOM, ROOM_TYPES.OFFICE, ROOM_TYPES.LAB],
            resetOnWrong: true,
            ignoreCorridor: true,
            hints: [
              'Enter the required room types in order.',
              "Corridors won't reset the sequence.",
              'If you step into the wrong sequence room type, it resets.'
            ]
          }
        },
        {
          id: 'quiet',
          template: 'stealthNoise',
          required: true,
          params: {
            seconds: 18,
            resetOnGunshot: true,
            maxGunshotsTotal: 4,
            hints: [
              'Stay quiet until the timer completes.',
              'Gunshots reset the timer, so avoid firing unless you must.'
            ]
          }
        },
        {
          id: 'keycard',
          template: 'findKeycard',
          required: true,
          params: {
            roomTypes: [ROOM_TYPES.LIBRARY, ROOM_TYPES.OFFICE],
            minDistFromSpawn: 6,
            label: 'Pick up Keycard',
            hints: [
              'Search Libraries/Offices for the keycard.',
              'Use cover and break line of sight to keep noise low.'
            ]
          }
        },
        {
          id: 'unlockExit',
          template: 'unlockExit',
          required: true,
          params: {
            hints: [
              'Go to the exit and press E to unlock it.',
              'After unlocking, press E again to finish the level.'
            ]
          }
        }
      ],
      exit: { requires: ['sequence', 'quiet', 'keycard', 'unlockExit'] }
    },
    player: {
      maxHealthMultiplier: 1.0,
      upgradeChoices: ['SPRINT_BOOST', 'EXTRA_HEART', 'SHORT_STEALTH', 'MISSION_HINT'],
      upgradesPerLevel: 1,
    },
    autopilot: {
      avoidRadius: 5,
      replanInterval: 0.5,
      stuckSeconds: 1.0,
      noProgressSeconds: 0.7,
    },
  },
  {
    id: 5,
    name: 'L5 - Code & Fuses',
    maze: { width: 29, height: 29, roomDensity: 2.9, extraConnectionChance: 0.1 },
    rooms: {
      typeWeights: {
        [ROOM_TYPES.CLASSROOM]: 2.9,
        [ROOM_TYPES.CLASSROOMS_BLOCK]: 1.8,
        [ROOM_TYPES.OFFICE]: 1.4,
        [ROOM_TYPES.LAB]: 1.25,
        [ROOM_TYPES.STORAGE]: 1.1,
        [ROOM_TYPES.CAFETERIA]: 0.8,
        [ROOM_TYPES.LIBRARY]: 0.75,
        [ROOM_TYPES.BATHROOM]: 0.65,
        [ROOM_TYPES.POOL]: 0.18,
        [ROOM_TYPES.GYM]: 0.25,
        [ROOM_TYPES.BEDROOM]: 0.3,
      }
    },
    monsters: {
      count: 5,
      maxCount: 7,
      speedMultiplier: 1.06,
      visionMultiplier: 1.06,
      memoryMultiplier: 1.05,
      typeWeights: { WANDERER: 0.3, HUNTER: 0.35, SENTINEL: 0.2, STALKER: 0.1, GREETER: 0.05 },
      allowSprintTypes: ['HUNTER', 'SENTINEL'],
    },
    budgets: {
      missionObjectsMax: 55,
    },
    missions: {
      timeLimitSec: 0,
      list: [
        {
          id: 'power',
          template: 'restorePowerFuses',
          required: true,
          params: {
            fuses: 3,
            itemId: 'fuse',
            roomTypesFuses: [ROOM_TYPES.STORAGE, ROOM_TYPES.LAB, ROOM_TYPES.OFFICE],
            roomTypesPanel: [ROOM_TYPES.LAB, ROOM_TYPES.OFFICE],
            minDistFromSpawn: 7,
            hints: [
              'Collect the fuses.',
              'Install fuses at the power panel (E).',
              'Press E again on the panel to restore power.'
            ]
          }
        },
        {
          id: 'doorCode',
          template: 'codeLock',
          required: true,
          params: {
            clues: 3,
            requiresPower: true,
            powerItemId: 'power_on',
            roomTypesClues: [ROOM_TYPES.CLASSROOM, ROOM_TYPES.OFFICE, ROOM_TYPES.CLASSROOMS_BLOCK],
            roomTypesKeypad: [ROOM_TYPES.OFFICE, ROOM_TYPES.LAB],
            minDistFromSpawn: 7,
            hints: [
              'Find the note clues (A/B/C).',
              'Power must be on before the keypad can be used.',
              'After collecting all clues, use the keypad and enter the code (A→B→C).'
            ]
          }
        },
        {
          id: 'evidence',
          template: 'collectEvidence',
          required: true,
          params: {
            count: 5,
            required: 3,
            roomTypes: [ROOM_TYPES.CLASSROOM, ROOM_TYPES.OFFICE, ROOM_TYPES.CLASSROOMS_BLOCK],
            minDistFromSpawn: 6,
            hints: [
              'Collect at least 3 evidence pickups.',
              'Evidence tends to be in Classrooms/Offices.'
            ]
          }
        },
        {
          id: 'unlockExit',
          template: 'unlockExit',
          required: true,
          params: {
            hints: [
              'Go to the exit and press E to unlock it.',
              'After unlocking, press E again to finish the level.'
            ]
          }
        }
      ],
      exit: { requires: ['power', 'doorCode', 'evidence', 'unlockExit'] }
    },
    player: {
      maxHealthMultiplier: 1.0,
      upgradeChoices: ['SPRINT_BOOST', 'EXTRA_HEART', 'MISSION_HINT', 'SHORT_STEALTH'],
      upgradesPerLevel: 1,
    },
    autopilot: {
      avoidRadius: 5,
      replanInterval: 0.48,
      stuckSeconds: 0.95,
      noProgressSeconds: 0.65,
    },
  },
  {
    id: 6,
    name: 'L6 - Blackout Drill',
    maze: { width: 31, height: 31, roomDensity: 3.0, extraConnectionChance: 0.12 },
    rooms: {
      typeWeights: {
        [ROOM_TYPES.CLASSROOM]: 2.6,
        [ROOM_TYPES.CLASSROOMS_BLOCK]: 1.6,
        [ROOM_TYPES.OFFICE]: 1.5,
        [ROOM_TYPES.LAB]: 1.35,
        [ROOM_TYPES.CAFETERIA]: 0.75,
        [ROOM_TYPES.STORAGE]: 1.15,
        [ROOM_TYPES.LIBRARY]: 0.75,
        [ROOM_TYPES.BATHROOM]: 0.65,
        [ROOM_TYPES.POOL]: 0.2,
        [ROOM_TYPES.GYM]: 0.25,
        [ROOM_TYPES.BEDROOM]: 0.35,
      }
    },
    monsters: {
      count: 6,
      maxCount: 7,
      speedMultiplier: 1.08,
      visionMultiplier: 1.1,
      memoryMultiplier: 1.1,
      typeWeights: { WANDERER: 0.25, HUNTER: 0.38, SENTINEL: 0.2, STALKER: 0.12, GREETER: 0.05 },
      allowSprintTypes: ['HUNTER', 'SENTINEL'],
    },
    budgets: {
      missionObjectsMax: 65,
    },
    missions: {
      timeLimitSec: 0,
      list: [
        {
          id: 'power',
          template: 'restorePowerFuses',
          required: true,
          params: {
            fuses: 4,
            itemId: 'fuse',
            roomTypesFuses: [ROOM_TYPES.STORAGE, ROOM_TYPES.LAB, ROOM_TYPES.OFFICE],
            roomTypesPanel: [ROOM_TYPES.LAB, ROOM_TYPES.OFFICE],
            minDistFromSpawn: 7,
            hints: [
              'Collect the fuses.',
              'Install fuses at the power panel (E), then restore power (E again).',
              'Power enables other devices in the map.'
            ]
          }
        },
        {
          id: 'upload',
          template: 'uploadEvidence',
          required: true,
          params: {
            requiresPower: true,
            powerItemId: 'power_on',
            count: 5,
            required: 4,
            itemId: 'evidence',
            roomTypesEvidence: [ROOM_TYPES.CLASSROOM, ROOM_TYPES.OFFICE, ROOM_TYPES.CLASSROOMS_BLOCK],
            roomTypesTerminal: [ROOM_TYPES.OFFICE, ROOM_TYPES.LAB],
            minDistFromSpawn: 7,
            hints: [
              'Collect evidence pickups (you need 4).',
              'After power is on, find the upload terminal and press E.'
            ]
          }
        },
        {
          id: 'calm',
          template: 'surviveNoDamage',
          required: true,
          params: {
            seconds: 15,
            hints: [
              'Avoid taking damage until the timer completes.',
              'Break line of sight, then wait it out.'
            ]
          }
        },
        {
          id: 'unlockExit',
          template: 'unlockExit',
          required: true,
          params: {
            hints: [
              'Go to the exit and press E to unlock it.',
              'After unlocking, press E again to finish the level.',
              'If it stays locked, you missed a required objective.'
            ]
          }
        }
      ],
      exit: { requires: ['power', 'upload', 'calm', 'unlockExit'] }
    },
    player: {
      maxHealthMultiplier: 1.0,
      upgradeChoices: ['SPRINT_BOOST', 'EXTRA_HEART', 'MISSION_HINT', 'SHORT_STEALTH'],
      upgradesPerLevel: 1,
    },
    autopilot: {
      avoidRadius: 5,
      replanInterval: 0.46,
      stuckSeconds: 1.0,
      noProgressSeconds: 0.7,
    },
  },
  {
    id: 7,
    name: 'L7 - Shrine Network',
    maze: { width: 31, height: 31, roomDensity: 3.1, extraConnectionChance: 0.12 },
    rooms: {
      typeWeights: {
        [ROOM_TYPES.CLASSROOM]: 2.4,
        [ROOM_TYPES.CLASSROOMS_BLOCK]: 1.55,
        [ROOM_TYPES.OFFICE]: 1.45,
        [ROOM_TYPES.LAB]: 1.35,
        [ROOM_TYPES.STORAGE]: 1.0,
        [ROOM_TYPES.CAFETERIA]: 0.75,
        [ROOM_TYPES.BATHROOM]: 0.65,
        [ROOM_TYPES.LIBRARY]: 0.9,
        [ROOM_TYPES.POOL]: 0.45,
        [ROOM_TYPES.GYM]: 0.25,
        [ROOM_TYPES.BEDROOM]: 0.35,
      }
    },
    monsters: {
      count: 6,
      maxCount: 7,
      speedMultiplier: 1.1,
      visionMultiplier: 1.12,
      memoryMultiplier: 1.14,
      typeWeights: { WANDERER: 0.22, HUNTER: 0.35, SENTINEL: 0.2, STALKER: 0.15, WEEPING_ANGEL: 0.08 },
      allowSprintTypes: ['HUNTER', 'SENTINEL', 'WEEPING_ANGEL'],
    },
    budgets: {
      missionObjectsMax: 55,
    },
    missions: {
      timeLimitSec: 0,
      list: [
        {
          id: 'shrines',
          template: 'activateShrines',
          required: true,
          params: {
            shrines: 2,
            roomTypesShrines: [ROOM_TYPES.LAB, ROOM_TYPES.LIBRARY, ROOM_TYPES.CLASSROOMS_BLOCK, ROOM_TYPES.OFFICE],
            minDistFromSpawn: 7,
            hints: [
              'Find and activate the shrines (press E).',
              'Shrines favor Labs/Library/Classrooms Block/Offices.',
              'After all shrines are active, move to the next objective.'
            ]
          }
        },
        {
          id: 'sequence',
          template: 'enterRoomSequence',
          required: true,
          params: {
            sequence: [ROOM_TYPES.LAB, ROOM_TYPES.POOL, ROOM_TYPES.OFFICE],
            resetOnWrong: false,
            ignoreCorridor: true,
            hints: [
              'Enter the room sequence in order.',
              "Corridors won't reset the sequence.",
              'The sequence adapts if a required room type is missing in this map.'
            ]
          }
        },
        {
          id: 'kills',
          template: 'killCount',
          required: true,
          params: {
            count: 6,
            hints: [
              'Defeat monsters to stabilize the route.',
              'Watch for guarding monsters: keep pressure with sustained fire.'
            ]
          }
        },
        {
          id: 'unlockExit',
          template: 'unlockExit',
          required: true,
          params: {
            hints: [
              'Go to the exit and press E to unlock it.',
              'After unlocking, press E again to finish the level.'
            ]
          }
        }
      ],
      exit: { requires: ['shrines', 'sequence', 'kills', 'unlockExit'] }
    },
    player: {
      maxHealthMultiplier: 1.0,
      upgradeChoices: ['SPRINT_BOOST', 'EXTRA_HEART', 'MISSION_HINT', 'SHORT_STEALTH'],
      upgradesPerLevel: 1,
    },
    autopilot: {
      avoidRadius: 5,
      replanInterval: 0.44,
      stuckSeconds: 1.0,
      noProgressSeconds: 0.7,
    },
  },
  {
    id: 8,
    name: 'L8 - Lockdown Protocol',
    maze: { width: 33, height: 33, roomDensity: 3.15, extraConnectionChance: 0.13 },
    rooms: {
      typeWeights: {
        [ROOM_TYPES.CLASSROOM]: 2.55,
        [ROOM_TYPES.CLASSROOMS_BLOCK]: 1.75,
        [ROOM_TYPES.OFFICE]: 1.65,
        [ROOM_TYPES.LAB]: 1.5,
        [ROOM_TYPES.STORAGE]: 1.25,
        [ROOM_TYPES.CAFETERIA]: 0.75,
        [ROOM_TYPES.BATHROOM]: 0.65,
        [ROOM_TYPES.LIBRARY]: 0.75,
        [ROOM_TYPES.POOL]: 0.25,
        [ROOM_TYPES.GYM]: 0.25,
        [ROOM_TYPES.BEDROOM]: 0.35,
      }
    },
    monsters: {
      count: 6,
      maxCount: 7,
      speedMultiplier: 1.11,
      visionMultiplier: 1.14,
      memoryMultiplier: 1.18,
      typeWeights: { WANDERER: 0.18, HUNTER: 0.34, SENTINEL: 0.22, STALKER: 0.16, WEEPING_ANGEL: 0.1 },
      allowSprintTypes: ['HUNTER', 'SENTINEL', 'WEEPING_ANGEL'],
    },
    budgets: {
      missionObjectsMax: 85,
    },
    missions: {
      timeLimitSec: 0,
      list: [
        {
          id: 'power',
          template: 'restorePowerFuses',
          required: true,
          params: {
            fuses: 3,
            itemId: 'fuse',
            roomTypesFuses: [ROOM_TYPES.STORAGE, ROOM_TYPES.LAB, ROOM_TYPES.OFFICE],
            roomTypesPanel: [ROOM_TYPES.LAB, ROOM_TYPES.OFFICE],
            minDistFromSpawn: 7,
            hints: [
              'Collect the fuses.',
              'Install them at the power panel (E), then restore power (E again).'
            ]
          }
        },
        {
          id: 'doorCode',
          template: 'codeLock',
          required: true,
          params: {
            clues: 4,
            requiresPower: true,
            powerItemId: 'power_on',
            roomTypesClues: [ROOM_TYPES.CLASSROOM, ROOM_TYPES.OFFICE, ROOM_TYPES.CLASSROOMS_BLOCK],
            roomTypesKeypad: [ROOM_TYPES.OFFICE, ROOM_TYPES.LAB],
            minDistFromSpawn: 7,
            hints: [
              'Find the note clues (A/B/C/D).',
              'Power must be on before the keypad works.',
              'Enter the code in order A→B→C→D.'
            ]
          }
        },
        {
          id: 'upload',
          template: 'uploadEvidence',
          required: true,
          params: {
            count: 6,
            required: 4,
            itemId: 'evidence',
            requiresPower: true,
            powerItemId: 'power_on',
            roomTypesEvidence: [ROOM_TYPES.CLASSROOM, ROOM_TYPES.OFFICE, ROOM_TYPES.CLASSROOMS_BLOCK],
            roomTypesTerminal: [ROOM_TYPES.OFFICE, ROOM_TYPES.LAB],
            minDistFromSpawn: 7,
            hints: [
              'Collect evidence pickups (you need 4).',
              'After power is on, upload at the terminal (E).'
            ]
          }
        },
        {
          id: 'quiet',
          template: 'stealthNoise',
          required: true,
          params: {
            seconds: 28,
            resetOnGunshot: true,
            maxGunshotsTotal: 5,
            hints: [
              'Stay quiet until the timer completes.',
              'Keep gunshots to a minimum.'
            ]
          }
        },
        {
          id: 'unlockExit',
          template: 'unlockExit',
          required: true,
          params: {
            hints: [
              'Go to the exit and press E to unlock it.',
              'After unlocking, press E again to finish the level.'
            ]
          }
        }
      ],
      exit: { requires: ['power', 'doorCode', 'upload', 'quiet', 'unlockExit'] }
    },
    player: {
      maxHealthMultiplier: 1.0,
      upgradeChoices: ['SPRINT_BOOST', 'EXTRA_HEART', 'MISSION_HINT', 'SHORT_STEALTH'],
      upgradesPerLevel: 1,
    },
    autopilot: {
      avoidRadius: 6,
      replanInterval: 0.42,
      stuckSeconds: 0.95,
      noProgressSeconds: 0.6,
    },
  },
  {
    id: 9,
    name: 'L9 - Shadow Hunt',
    maze: { width: 33, height: 33, roomDensity: 3.2, extraConnectionChance: 0.14 },
    rooms: {
      typeWeights: {
        [ROOM_TYPES.CLASSROOM]: 2.5,
        [ROOM_TYPES.CLASSROOMS_BLOCK]: 1.8,
        [ROOM_TYPES.OFFICE]: 1.7,
        [ROOM_TYPES.LAB]: 1.55,
        [ROOM_TYPES.STORAGE]: 1.25,
        [ROOM_TYPES.CAFETERIA]: 0.75,
        [ROOM_TYPES.BATHROOM]: 0.65,
        [ROOM_TYPES.LIBRARY]: 0.75,
        [ROOM_TYPES.POOL]: 0.22,
        [ROOM_TYPES.GYM]: 0.25,
        [ROOM_TYPES.BEDROOM]: 0.35,
      }
    },
    monsters: {
      count: 7,
      maxCount: 9,
      speedMultiplier: 1.13,
      visionMultiplier: 1.18,
      memoryMultiplier: 1.22,
      typeWeights: { WANDERER: 0.14, HUNTER: 0.34, SENTINEL: 0.22, STALKER: 0.18, WEEPING_ANGEL: 0.12 },
      allowSprintTypes: ['HUNTER', 'SENTINEL', 'WEEPING_ANGEL'],
    },
    budgets: {
      missionObjectsMax: 75,
    },
    missions: {
      timeLimitSec: 720,
      list: [
        {
          id: 'power',
          template: 'restorePowerFuses',
          required: true,
          params: {
            fuses: 4,
            itemId: 'fuse',
            roomTypesFuses: [ROOM_TYPES.STORAGE, ROOM_TYPES.LAB, ROOM_TYPES.OFFICE],
            roomTypesPanel: [ROOM_TYPES.LAB, ROOM_TYPES.OFFICE],
            minDistFromSpawn: 7,
            hints: [
              'Collect the fuses and restore power at the panel.',
              'Keep moving: late-game monsters punish hesitation.'
            ]
          }
        },
        {
          id: 'doorCode',
          template: 'codeLock',
          required: true,
          params: {
            clues: 4,
            roomTypesClues: [ROOM_TYPES.CLASSROOM, ROOM_TYPES.OFFICE, ROOM_TYPES.CLASSROOMS_BLOCK],
            roomTypesKeypad: [ROOM_TYPES.OFFICE, ROOM_TYPES.LAB],
            minDistFromSpawn: 7,
            hints: [
              'Find the note clues (A/B/C/D).',
              'Enter the code in order A→B→C→D.'
            ]
          }
        },
        {
          id: 'kills',
          template: 'killCount',
          required: true,
          params: {
            count: 9,
            hints: [
              'Defeat monsters to unlock the exit route.',
              'Use weapon switching to match distance and crowd size.'
            ]
          }
        },
        {
          id: 'survive',
          template: 'surviveTimer',
          required: true,
          params: {
            seconds: 40,
            hints: [
              'Survive until the timer completes.',
              'Break line of sight and keep moving between rooms.'
            ]
          }
        },
        {
          id: 'unlockExit',
          template: 'unlockExit',
          required: true,
          params: {
            hints: [
              'Go to the exit and press E to unlock it.',
              'After unlocking, press E again to finish the level.'
            ]
          }
        }
      ],
      exit: { requires: ['power', 'doorCode', 'kills', 'survive', 'unlockExit'] }
    },
    player: {
      maxHealthMultiplier: 1.0,
      upgradeChoices: ['SPRINT_BOOST', 'EXTRA_HEART', 'MISSION_HINT', 'SHORT_STEALTH'],
      upgradesPerLevel: 1,
    },
    autopilot: {
      avoidRadius: 6,
      replanInterval: 0.4,
      stuckSeconds: 0.9,
      noProgressSeconds: 0.55,
    },
  },
  {
    id: 10,
    name: 'L10 - The Core',
    maze: { width: 27, height: 27, roomDensity: 2.9, extraConnectionChance: 0.16 },
    rooms: {
      typeWeights: {
        [ROOM_TYPES.LAB]: 2.4,
        [ROOM_TYPES.LIBRARY]: 1.2,
        [ROOM_TYPES.CLASSROOMS_BLOCK]: 1.4,
        [ROOM_TYPES.OFFICE]: 1.0,
        [ROOM_TYPES.STORAGE]: 0.9,
        [ROOM_TYPES.CLASSROOM]: 1.0,
        [ROOM_TYPES.CAFETERIA]: 0.55,
        [ROOM_TYPES.BATHROOM]: 0.5,
        [ROOM_TYPES.POOL]: 0.35,
        [ROOM_TYPES.GYM]: 0.3,
        [ROOM_TYPES.BEDROOM]: 0.3,
      }
    },
    monsters: {
      count: 5,
      maxCount: 6,
      speedMultiplier: 1.1,
      visionMultiplier: 1.15,
      memoryMultiplier: 1.2,
      typeWeights: { HUNTER: 0.42, SENTINEL: 0.28, STALKER: 0.18, WEEPING_ANGEL: 0.12 },
      allowSprintTypes: ['HUNTER', 'SENTINEL', 'WEEPING_ANGEL'],
    },
    budgets: {
      missionObjectsMax: 55,
    },
    pickups: {
      maxActive: 16,
      tools: {
        maxDevices: 6,
        start: { lure: 1, trap: 1, jammer: 1, decoy: 1, smoke: 1, flash: 1, sensor: 1, mine: 1 },
        drop: {
          enabled: true,
          chance: 0.06,
          ttl: 45,
          weights: { lure: 0.35, trap: 0.25, jammer: 0.15, decoy: 0.1, smoke: 0.08, flash: 0.06, sensor: 0.06, mine: 0.05 }
        }
      }
    },
    boss: {
      enabled: true,
      shieldNodes: 3,
      escapeSeconds: 35,
      // Boss spawn uses its own monster type and is excluded from SpawnDirector counts.
      typeId: 'BOSS_CORE'
    },
    missions: {
      timeLimitSec: 0,
      list: [
        {
          id: 'bossFinale',
          template: 'bossFinale',
          required: true,
          params: {
            hints: [
              'Phase 1: Destroy the Shield Nodes (follow the markers).',
              'Phase 2: With the shield down, defeat the Core.',
              'Phase 3: Escape before the lockdown timer expires.'
            ]
          }
        }
      ],
      exit: { requires: ['bossFinale'] }
    },
    player: {
      maxHealthMultiplier: 1.0,
      upgradeChoices: ['SPRINT_BOOST', 'EXTRA_HEART', 'MISSION_HINT', 'SHORT_STEALTH'],
      upgradesPerLevel: 1,
    },
    autopilot: {
      avoidRadius: 6,
      replanInterval: 0.38,
      stuckSeconds: 0.9,
      noProgressSeconds: 0.5,
    },
  }
];
