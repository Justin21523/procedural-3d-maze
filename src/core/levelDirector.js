import { CONFIG } from './config.js';

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function ensureOdd(n) {
  const rounded = Math.round(n);
  return rounded % 2 === 0 ? rounded + 1 : rounded;
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * LevelDirector
 * - Generates endless, room-first levels with rising difficulty.
 * - Adapts next difficulty based on player performance (speed, health, mission completion).
 */
export class LevelDirector {
  constructor(baseLevels = []) {
    this.baseLevels = baseLevels;
    this.generated = [];
    this.lastDifficulty = 1;
  }

  /**
   * Compute a 0-1 performance score.
   */
  scorePerformance(stats = null, outcome = null) {
    if (!stats) return 0.5;

    const healthScore = clamp((stats.healthPercentage ?? 50) / 100, 0, 1);
    const missionScore = stats.missions?.total
      ? clamp((stats.missions.collected || 0) / stats.missions.total, 0, 1)
      : 1;

    const time = stats.time || 0;
    // Faster clear = higher score; 0.75 within 5 min, lower after.
    const timeScore = clamp(1 - (time / 300), 0.2, 1);

    let score = (healthScore * 0.4) + (missionScore * 0.35) + (timeScore * 0.25);
    if (outcome === 'lose') score *= 0.65;
    if (outcome === 'win') score *= 1.05;
    return clamp(score, 0.2, 1.1);
  }

  /**
   * Compute difficulty scalar for the given level index.
   */
  difficultyForLevel(index, stats, outcome) {
    const base = Math.max(this.lastDifficulty + 0.05, 1 + index * 0.15); // monotonic climb
    const perf = this.scorePerformance(stats, outcome);
    const adjustment = (perf - 0.55) * 0.9;
    const diff = clamp(base + adjustment, 0.8, 15);
    this.lastDifficulty = Math.max(this.lastDifficulty, diff);
    return diff;
  }

  /**
   * Public API: fetch config for a level index (0-based).
   */
  getLevelConfig(index, stats = null, outcome = null) {
    if (index < this.baseLevels.length) {
      const tuned = this.tuneForRooms(this.baseLevels[index], index);
      this.lastDifficulty = Math.max(this.lastDifficulty, 1 + index * 0.2);
      return tuned;
    }

    const dynamic = this.generated[index - this.baseLevels.length];
    if (dynamic) {
      return dynamic;
    }

    const difficulty = this.difficultyForLevel(index, stats, outcome);
    const config = this.buildDynamicConfig(index, difficulty);
    this.generated[index - this.baseLevels.length] = config;
    return config;
  }

  tuneForRooms(config, index = 0) {
    const tuned = deepClone(config);
    tuned.id = tuned.id ?? index + 1;
    tuned.name = tuned.name || `AI-L${index + 1}`;
    tuned.maze = tuned.maze || {};
    tuned.maze.roomDensity = Math.max(tuned.maze.roomDensity || 1.5, 2.8);
    tuned.maze.extraConnectionChance = Math.max(tuned.maze.extraConnectionChance || 0.1, 0.2);
    tuned.maze.noDeadEnds = true;
    tuned.maze.minRoomDoors = 2;
    tuned.maze.minRoomSize = Math.max(tuned.maze.minRoomSize || 5, 5);
    tuned.maze.maxRoomSize = Math.max(tuned.maze.maxRoomSize || 8, 8);
    tuned.maze.deadEndPasses = tuned.maze.deadEndPasses ?? 3;
    return tuned;
  }

  buildDynamicConfig(index, difficulty) {
    const baseWidth = CONFIG.MAZE_WIDTH || 31;
    const baseHeight = CONFIG.MAZE_HEIGHT || 31;
    const jitter = () => (Math.random() * 3 - 1.5);

    const width = ensureOdd(baseWidth + difficulty * 3 + jitter());
    const height = ensureOdd(baseHeight + difficulty * 2.5 + jitter());

    const roomDensity = clamp(3.5 + difficulty * 0.45, 3, 12);
    const extraConnectionChance = clamp(0.18 + difficulty * 0.02, 0.18, 0.48);
    const minRoomSize = clamp(5 + Math.floor(difficulty * 0.3), 5, 11);
    const maxRoomSize = clamp(minRoomSize + 3 + Math.floor(difficulty * 0.15), minRoomSize + 2, 14);

    const monsterBase = CONFIG.MONSTER_COUNT || 12;
    const monsterCount = clamp(Math.round(monsterBase * (1 + difficulty * 0.14)), 6, 60);
    const speedMultiplier = clamp(1 + difficulty * 0.05, 1, 1.8);
    const visionMultiplier = clamp(1 + difficulty * 0.04, 1, 2);

    const missions = 3 + Math.floor(difficulty * 0.4);
    const required = clamp(missions - 1, 2, missions);

    return {
      id: index + 1,
      name: `Endless-${index + 1}`,
      maze: {
        width,
        height,
        roomDensity,
        extraConnectionChance,
        noDeadEnds: true,
        minRoomSize,
        maxRoomSize,
        minRoomDoors: 2,
        deadEndPasses: 3
      },
      monsters: {
        count: monsterCount,
        speedMultiplier,
        visionMultiplier,
        memoryMultiplier: 1 + difficulty * 0.04,
        allowSprintTypes: []
      },
      missions: {
        type: 'collectAndExit',
        missionPointCount: missions,
        requiredToUnlockExit: required,
        timeLimitSec: 0
      },
      player: {
        maxHealthMultiplier: clamp(1.0 - difficulty * 0.015, 0.65, 1),
        upgradeChoices: ['SPRINT_BOOST', 'EXTRA_HEART', 'MISSION_HINT', 'SHORT_STEALTH'],
        upgradesPerLevel: 1
      },
      autopilot: {
        avoidRadius: clamp(4 + difficulty * 0.1, 4, 10),
        replanInterval: clamp(0.5 - difficulty * 0.02, 0.25, 0.6),
        stuckSeconds: 1.0,
        noProgressSeconds: 0.6
      }
    };
  }

  /**
   * For UI: how many levels can we jump to (soft cap).
   */
  getMaxJump() {
    return Math.max(200, this.baseLevels.length);
  }
}
