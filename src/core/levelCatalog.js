import { ROOM_TYPES } from '../world/tileTypes.js';

// Data-driven level catalog:
// - rooms.typeWeights steers the room archetype mix (higher => more common)
// - missions.list defines objective templates (MissionDirector consumes this directly)
export const LEVEL_CATALOG = [
  {
    id: 1,
    name: 'L1 - Tutorial',
    maze: { width: 21, height: 21, roomDensity: 1.8, extraConnectionChance: 0.04 },
    rooms: {
      typeWeights: {
        [ROOM_TYPES.CLASSROOM]: 3.0,
        [ROOM_TYPES.CLASSROOMS_BLOCK]: 1.2,
        [ROOM_TYPES.OFFICE]: 1.2,
        [ROOM_TYPES.BATHROOM]: 0.8,
        [ROOM_TYPES.STORAGE]: 0.7,
        [ROOM_TYPES.LIBRARY]: 0.6,
        [ROOM_TYPES.LAB]: 0.7,
        [ROOM_TYPES.CAFETERIA]: 0.6,
        [ROOM_TYPES.POOL]: 0.25,
        [ROOM_TYPES.GYM]: 0.4,
        [ROOM_TYPES.BEDROOM]: 0.5,
      }
    },
    monsters: {
      count: 4,
      maxCount: 6,
      speedMultiplier: 1.0,
      visionMultiplier: 0.85,
      memoryMultiplier: 0.7,
      typeWeights: { WANDERER: 0.7, HUNTER: 0.3 },
      allowSprintTypes: ['HUNTER'],
    },
    missions: {
      timeLimitSec: 0,
      list: [
        {
          id: 'evidence',
          template: 'collectEvidence',
          required: true,
          params: {
            count: 3,
            required: 3,
            roomTypes: [ROOM_TYPES.CLASSROOM, ROOM_TYPES.OFFICE, ROOM_TYPES.CLASSROOMS_BLOCK]
          }
        }
      ],
      exit: { requires: ['evidence'] }
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
    name: 'L2 - Keycard',
    maze: { width: 25, height: 25, roomDensity: 2.2, extraConnectionChance: 0.07 },
    rooms: {
      typeWeights: {
        [ROOM_TYPES.CLASSROOM]: 3.2,
        [ROOM_TYPES.CLASSROOMS_BLOCK]: 1.6,
        [ROOM_TYPES.OFFICE]: 1.4,
        [ROOM_TYPES.LAB]: 0.8,
        [ROOM_TYPES.CAFETERIA]: 0.7,
        [ROOM_TYPES.BATHROOM]: 0.7,
        [ROOM_TYPES.STORAGE]: 0.8,
        [ROOM_TYPES.LIBRARY]: 0.6,
        [ROOM_TYPES.POOL]: 0.25,
        [ROOM_TYPES.GYM]: 0.35,
        [ROOM_TYPES.BEDROOM]: 0.45,
      }
    },
    monsters: {
      count: 6,
      maxCount: 6,
      speedMultiplier: 1.0,
      visionMultiplier: 1.0,
      memoryMultiplier: 1.0,
      typeWeights: { WANDERER: 0.45, HUNTER: 0.25, SENTINEL: 0.2, GREETER: 0.1 },
      allowSprintTypes: ['HUNTER', 'SENTINEL'],
    },
    missions: {
      timeLimitSec: 0,
      list: [
        {
          id: 'keycard',
          template: 'findKeycard',
          required: true,
          params: {
            roomTypes: [ROOM_TYPES.OFFICE, ROOM_TYPES.CLASSROOM, ROOM_TYPES.CLASSROOMS_BLOCK],
            label: 'Pick up Keycard'
          }
        },
        {
          id: 'evidence',
          template: 'collectEvidence',
          required: true,
          params: {
            count: 4,
            required: 3,
            roomTypes: [ROOM_TYPES.CLASSROOM, ROOM_TYPES.OFFICE, ROOM_TYPES.CAFETERIA]
          }
        }
      ],
      exit: { requires: ['keycard', 'evidence'] }
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
    name: 'L3 - Restore Power',
    maze: { width: 29, height: 29, roomDensity: 2.8, extraConnectionChance: 0.1 },
    rooms: {
      typeWeights: {
        [ROOM_TYPES.CLASSROOM]: 2.8,
        [ROOM_TYPES.CLASSROOMS_BLOCK]: 1.6,
        [ROOM_TYPES.OFFICE]: 1.2,
        [ROOM_TYPES.LAB]: 1.2,
        [ROOM_TYPES.STORAGE]: 1.0,
        [ROOM_TYPES.CAFETERIA]: 0.75,
        [ROOM_TYPES.BATHROOM]: 0.7,
        [ROOM_TYPES.LIBRARY]: 0.55,
        [ROOM_TYPES.POOL]: 0.2,
        [ROOM_TYPES.GYM]: 0.3,
        [ROOM_TYPES.BEDROOM]: 0.4,
      }
    },
    monsters: {
      count: 8,
      maxCount: 6,
      speedMultiplier: 1.05,
      visionMultiplier: 1.1,
      memoryMultiplier: 1.2,
      typeWeights: { WANDERER: 0.3, HUNTER: 0.4, SENTINEL: 0.2, STALKER: 0.1 },
      allowSprintTypes: ['HUNTER', 'SENTINEL'],
    },
    missions: {
      timeLimitSec: 300,
      list: [
        {
          id: 'power',
          template: 'restorePower',
          required: true,
          params: {
            switches: 3,
            roomTypes: [ROOM_TYPES.LAB, ROOM_TYPES.STORAGE]
          }
        },
        {
          id: 'evidence',
          template: 'collectEvidence',
          required: true,
          params: {
            count: 5,
            required: 4,
            roomTypes: [ROOM_TYPES.CLASSROOM, ROOM_TYPES.OFFICE, ROOM_TYPES.CLASSROOMS_BLOCK]
          }
        }
      ],
      exit: { requires: ['power', 'evidence'] }
    },
    player: {
      maxHealthMultiplier: 1.0,
      upgradeChoices: ['SPRINT_BOOST', 'EXTRA_HEART', 'MISSION_HINT', 'SHORT_STEALTH'],
      upgradesPerLevel: 1,
    },
    autopilot: {
      avoidRadius: 5,
      replanInterval: 0.45,
      stuckSeconds: 0.9,
      noProgressSeconds: 0.5,
    },
  }
];

