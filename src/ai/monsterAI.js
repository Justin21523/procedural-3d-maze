// src/ai/monsterAI.js
//
// Thin factory/aggregator: brains live in `src/ai/brains/*` and reusable logic lives in `src/ai/modules/*`.

import { AutopilotWandererBrain } from './brains/autopilotWanderer.js';
import { RoomHunterBrain } from './brains/roomHunter.js';
import { WanderCritterBrain } from './brains/wanderCritter.js';
import { TeleportStalkerBrain } from './brains/teleportStalker.js';
import { DistanceStalkerBrain } from './brains/distanceStalker.js';
import { SpeedJitterBrain } from './brains/speedJitter.js';
import { CorridorGuardianBrain } from './brains/corridorGuardian.js';
import { ShyGreeterBrain } from './brains/shyGreeter.js';
import { applyBrainModules } from './brainComposer.js';

export { BaseMonsterBrain } from './brains/baseBrain.js';
export {
  AutopilotWandererBrain,
  RoomHunterBrain,
  WanderCritterBrain,
  TeleportStalkerBrain,
  DistanceStalkerBrain,
  SpeedJitterBrain,
  CorridorGuardianBrain,
  ShyGreeterBrain
};

/**
 * Factory helper for MonsterManager
 *
 * Usage:
 *   import { createMonsterBrain } from './monsterAI.js';
 *
 *   const brain = createMonsterBrain({
 *     type: 'roomHunter', // or 'autopilotWanderer', 'wanderCritter', 'teleportStalker', ...
 *     worldState,
 *     pathfinder,
 *     monster,
 *     playerRef,
 *     config: { ...overrides }
 *   });
 *
 *   const command = brain.tick(deltaTime);
 */
export function createMonsterBrain(options) {
  const {
    type,
    worldState,
    pathfinder,
    monster,
    playerRef,
    config
  } = options || {};

  const postProcess = (brain) => applyBrainModules(brain, { worldState, config });

  switch (type) {
    case 'autopilotWanderer':
    case 'autopilot':
      return postProcess(new AutopilotWandererBrain(worldState, pathfinder, monster, playerRef, config));

    case 'roomHunter':
    case 'hunter':
      return postProcess(new RoomHunterBrain(worldState, pathfinder, monster, playerRef, config));

    case 'wanderCritter':
    case 'critter':
      return postProcess(new WanderCritterBrain(worldState, pathfinder, monster, playerRef, config));

    case 'teleportStalker':
    case 'stalker':
      return postProcess(new TeleportStalkerBrain(worldState, pathfinder, monster, playerRef, config));

    case 'distanceStalker':
    case 'stalkerDistance':
      return postProcess(new DistanceStalkerBrain(worldState, pathfinder, monster, playerRef, config));

    case 'speedJitter':
    case 'jitter':
      return postProcess(new SpeedJitterBrain(worldState, pathfinder, monster, playerRef, config));

    case 'corridorGuardian':
    case 'guardian':
      return postProcess(new CorridorGuardianBrain(worldState, pathfinder, monster, playerRef, config));

    case 'shyGreeter':
    case 'greeter':
      return postProcess(new ShyGreeterBrain(worldState, pathfinder, monster, playerRef, config));

    default:
      return postProcess(new AutopilotWandererBrain(worldState, pathfinder, monster, playerRef, config));
  }
}
