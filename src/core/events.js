export const EVENTS = Object.freeze({
  // Weapon / player actions
  WEAPON_SWITCHED: 'weapon:switched',
  WEAPON_RELOAD_START: 'weapon:reloadStart',
  WEAPON_RELOAD_FINISH: 'weapon:reloadFinish',
  WEAPON_FIRED: 'weapon:fired',

  // Player defense
  PLAYER_BLOCK_START: 'player:blockStart',
  PLAYER_BLOCK_END: 'player:blockEnd',
  PLAYER_BLOCK_BROKEN: 'player:blockBroken',

  // Combat
  PLAYER_HIT_MONSTER: 'combat:playerHitMonster',
  MONSTER_HIT_PLAYER: 'combat:monsterHitPlayer',
  PROJECTILE_HIT_WALL: 'combat:projectileHitWall',
  PLAYER_USED_SKILL: 'combat:playerUsedSkill',

  // Monsters
  MONSTER_KILLED: 'monster:killed',

  // Pickups
  PICKUP_SPAWN_REQUESTED: 'pickup:spawnRequested',
  PICKUP_SPAWNED: 'pickup:spawned',
  PICKUP_COLLECTED: 'pickup:collected',

  // Spawning
  WAVE_PLANNED: 'spawn:wavePlanned',
  WAVE_SPAWNED: 'spawn:waveSpawned',

  // Game state
  PLAYER_DAMAGED: 'player:damaged',
  PLAYER_HEALED: 'player:healed',
  GAME_WON: 'game:won',
  GAME_LOST: 'game:lost',

  // World / navigation
  ROOM_ENTERED: 'room:entered',
  TIMER_TICK: 'timer:tick',
  NOISE_EMITTED: 'noise:emitted',

  // Interactions
  INTERACTABLE_HOVER: 'interact:hover',
  INTERACT: 'interact:performed',
  ITEM_PICKED: 'item:picked',

  // Missions / objectives
  MISSION_STARTED: 'mission:started',
  MISSION_UPDATED: 'mission:updated',
  MISSION_COMPLETED: 'mission:completed',
  MISSION_FAILED: 'mission:failed',

  // Exit gating
  EXIT_UNLOCKED: 'exit:unlocked',
  EXIT_LOCKED: 'exit:locked',
});
