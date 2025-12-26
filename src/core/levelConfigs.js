// Level configuration table for progressive difficulty
// Each entry defines maze size/density, monster mix, missions, player upgrades, and autopilot tuning.

export const LEVEL_CONFIGS = [
  {
    id: 1,
    name: 'L1 - Tutorial',
    maze: { width: 21, height: 21, roomDensity: 1.5, extraConnectionChance: 0.02 },
    monsters: {
      count: 4,
      speedMultiplier: 1.0,
      visionMultiplier: 0.8,
      memoryMultiplier: 0.7,
      typeWeights: { WANDERER: 0.7, HUNTER: 0.3 },
      allowSprintTypes: ['HUNTER'],
    },
    missions: {
      type: 'collectAndExit',
      missionPointCount: 3,
      requiredToUnlockExit: 3,
      timeLimitSec: 0,
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
    name: 'L2 - Main Maze',
    maze: { width: 25, height: 25, roomDensity: 2.0, extraConnectionChance: 0.05 },
    monsters: {
      count: 6,
      speedMultiplier: 1.0,
      visionMultiplier: 1.0,
      memoryMultiplier: 1.0,
      // 加入一點 GREETER 當作「安全路標」
      typeWeights: { WANDERER: 0.45, HUNTER: 0.25, SENTINEL: 0.2, GREETER: 0.1 },
      allowSprintTypes: ['HUNTER', 'SENTINEL'],
    },
    missions: {
      type: 'collectAndExit',
      missionPointCount: 4,
      requiredToUnlockExit: 3,
      timeLimitSec: 0,
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
    name: 'L3 - Time Pressure',
    maze: { width: 29, height: 29, roomDensity: 2.5, extraConnectionChance: 0.08 },
    monsters: {
      count: 8,
      speedMultiplier: 1.05,
      visionMultiplier: 1.1,
      memoryMultiplier: 1.2,
      typeWeights: { WANDERER: 0.3, HUNTER: 0.4, SENTINEL: 0.2, STALKER: 0.1 },
      allowSprintTypes: ['HUNTER', 'SENTINEL'],
    },
    missions: {
      type: 'timeAttack',
      missionPointCount: 5,
      requiredToUnlockExit: 4,
      timeLimitSec: 300,
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
  },
  {
    id: 4,
    name: 'L4 - Guarded Halls',
    maze: { width: 31, height: 31, roomDensity: 3.0, extraConnectionChance: 0.12 },
    monsters: {
      count: 10,
      speedMultiplier: 1.1,
      visionMultiplier: 1.2,
      memoryMultiplier: 1.3,
      typeWeights: {
        WANDERER: 0.2,
        HUNTER: 0.3,
        SENTINEL: 0.3,
        STALKER: 0.1,
        RUSHER: 0.1,
      },
      allowSprintTypes: ['HUNTER', 'SENTINEL', 'RUSHER'],
    },
    missions: {
      type: 'escort',
      missionPointCount: 0,
      requiredToUnlockExit: 0,
      timeLimitSec: 420,
    },
    player: {
      maxHealthMultiplier: 0.9,
      upgradeChoices: [
        'SPRINT_BOOST',
        'EXTRA_HEART',
        'MISSION_HINT',
        'SHORT_STEALTH',
        'DASH',
      ],
      upgradesPerLevel: 1,
    },
    autopilot: {
      avoidRadius: 4,
      replanInterval: 0.4,
      stuckSeconds: 0.8,
      noProgressSeconds: 0.4,
    },
  },
  {
    id: 5,
    name: 'L5 - Final Maze',
    maze: { width: 35, height: 35, roomDensity: 3.5, extraConnectionChance: 0.15 },
    monsters: {
      count: 12,
      speedMultiplier: 1.15,
      visionMultiplier: 1.3,
      memoryMultiplier: 1.5,
      typeWeights: {
        WANDERER: 0.1,
        HUNTER: 0.35,
        SENTINEL: 0.25,
        STALKER: 0.2,
        RUSHER: 0.1,
      },
      allowSprintTypes: ['HUNTER', 'SENTINEL', 'RUSHER', 'STALKER'],
    },
    missions: {
      type: 'mixed',
      missionPointCount: 6,
      requiredToUnlockExit: 5,
      timeLimitSec: 480,
    },
    player: {
      maxHealthMultiplier: 0.85,
      upgradeChoices: [
        'SPRINT_BOOST',
        'EXTRA_HEART',
        'MISSION_HINT',
        'SHORT_STEALTH',
        'DASH',
      ],
      upgradesPerLevel: 1,
    },
    autopilot: {
      avoidRadius: 4,
      replanInterval: 0.35,
      stuckSeconds: 0.7,
      noProgressSeconds: 0.35,
    },
  },
  // -----------------
  // 新增的高階關卡
  // -----------------
  {
    id: 6,
    name: 'L6 - Phantom Shift',
    maze: { width: 35, height: 35, roomDensity: 3.2, extraConnectionChance: 0.18 },
    monsters: {
      count: 11, // 仍然維持 <=12
      speedMultiplier: 1.18,
      visionMultiplier: 1.35,
      memoryMultiplier: 1.6,
      typeWeights: {
        WANDERER: 0.15,
        GREETER: 0.15,   // 友善路標
        HUNTER: 0.3,
        SENTINEL: 0.2,
        STALKER: 0.1,
        RUSHER: 0.1,
      },
      allowSprintTypes: ['HUNTER', 'SENTINEL', 'STALKER', 'RUSHER'],
    },
    missions: { type: 'mixed', missionPointCount: 7, requiredToUnlockExit: 5, timeLimitSec: 540 },
    player: {
      maxHealthMultiplier: 0.85,
      upgradeChoices: ['SPRINT_BOOST', 'EXTRA_HEART', 'MISSION_HINT', 'SHORT_STEALTH', 'DASH'],
      upgradesPerLevel: 1,
    },
    autopilot: { avoidRadius: 4, replanInterval: 0.33, stuckSeconds: 0.7, noProgressSeconds: 0.35 },
  },
  {
    id: 7,
    name: 'L7 - Extreme Trial',
    maze: { width: 35, height: 35, roomDensity: 3.5, extraConnectionChance: 0.2 },
    monsters: {
      count: 12,
      speedMultiplier: 1.22,
      visionMultiplier: 1.4,
      memoryMultiplier: 1.7,
      typeWeights: {
        WANDERER: 0.05,
        GREETER: 0.1,
        HUNTER: 0.35,
        SENTINEL: 0.2,
        STALKER: 0.2,
        RUSHER: 0.1,
      },
      allowSprintTypes: ['HUNTER', 'SENTINEL', 'STALKER', 'RUSHER'],
    },
    // 終局採用有時間壓力的收集+出口
    missions: { type: 'timeAttack', missionPointCount: 7, requiredToUnlockExit: 6, timeLimitSec: 420 },
    player: {
      maxHealthMultiplier: 0.8,
      upgradeChoices: ['SPRINT_BOOST', 'EXTRA_HEART', 'MISSION_HINT', 'SHORT_STEALTH', 'DASH'],
      upgradesPerLevel: 1,
    },
    autopilot: { avoidRadius: 3.5, replanInterval: 0.3, stuckSeconds: 0.6, noProgressSeconds: 0.3 },
  },
];
