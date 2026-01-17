import { CONFIG } from './config.js';

function toNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function vecDistSqXZ(a, b) {
  if (!a || !b) return Infinity;
  const dx = (a.x || 0) - (b.x || 0);
  const dz = (a.z || 0) - (b.z || 0);
  return dx * dx + dz * dz;
}

export class PlayerToolAISystem {
  constructor(options = {}) {
    this.player = options.player || null;
    this.toolSystem = options.toolSystem || null;
    this.monsterManager = options.monsterManager || null;
    this.worldState = options.worldState || null;
    this.gameState = options.gameState || null;
    this.missionDirector = options.missionDirector || null;
    this.autopilot = options.autopilot || null;
    this.gun = options.gun || null;

    this.enabled = options.enabled ?? true;

    this.globalCooldown = 0;
    this.cooldowns = {
      flash: 0,
      smoke: 0,
      scent: 0,
      jammer: 0,
      trap: 0,
      mine: 0,
      sensor: 0,
      decoy: 0,
      fakeHack: 0,
      sonar: 0,
      glowstick: 0,
      wedge: 0,
      lure: 0
    };

    this.lastGlowstickGridKey = null;
    this.lastGlowstickAtSec = 0;
    this.lastGridKey = null;
    this.stillSeconds = 0;
  }

  setRefs({ player, toolSystem, monsterManager, worldState, gameState, missionDirector, autopilot, gun } = {}) {
    if (player) this.player = player;
    if (toolSystem) this.toolSystem = toolSystem;
    if (monsterManager) this.monsterManager = monsterManager;
    if (worldState) this.worldState = worldState;
    if (gameState) this.gameState = gameState;
    if (missionDirector) this.missionDirector = missionDirector;
    if (autopilot) this.autopilot = autopilot;
    if (gun) this.gun = gun;
  }

  tickCooldowns(dt) {
    const d = Math.max(0, dt || 0);
    this.globalCooldown = Math.max(0, (this.globalCooldown || 0) - d);
    for (const key of Object.keys(this.cooldowns)) {
      this.cooldowns[key] = Math.max(0, (this.cooldowns[key] || 0) - d);
    }
  }

  getInventoryCount(snapshot, id) {
    if (!snapshot || !id) return 0;
    return Math.max(0, Math.round(toNum(snapshot[id], 0)));
  }

  getAutopilotObjectiveState() {
    return this.missionDirector?.getAutopilotState ? this.missionDirector.getAutopilotState() : null;
  }

  isNoiseSensitiveObjective(state) {
    const objective = state?.objective || null;
    const template = String(objective?.template || '').trim();
    if (template !== 'stealthNoise') return false;
    const completed = !!objective?.progress?.completed;
    const failed = !!objective?.progress?.failed;
    const remaining = toNum(objective?.progress?.remaining, 0);
    return !completed && !failed && remaining > 0;
  }

  isHoldingPositionObjective(state) {
    const objective = state?.objective || null;
    const template = String(objective?.template || '').trim();
    if (!template) return false;

    if (template === 'stealthNoise') {
      return this.isNoiseSensitiveObjective(state);
    }
    if (template === 'hideForSeconds') {
      const completed = !!objective?.progress?.completed;
      const hidden = !!objective?.progress?.hidden;
      const remaining = toNum(objective?.progress?.remaining, 0);
      return !completed && hidden && remaining > 0;
    }
    if (template === 'hideUntilClear') {
      const completed = !!objective?.progress?.completed;
      const hidden = !!objective?.progress?.hidden;
      return !completed && hidden;
    }
    return false;
  }

  getActiveDevices() {
    const list = this.toolSystem?.devices;
    return Array.isArray(list) ? list : [];
  }

  hasDeviceNear(kind, playerPos, distWorld) {
    const want = Array.isArray(kind) ? kind.map(String) : [String(kind || '').trim()];
    const maxDist = Math.max(0, toNum(distWorld, 0));
    const maxDistSq = maxDist * maxDist;
    for (const d of this.getActiveDevices()) {
      if (!d || !d.position) continue;
      const k = String(d.kind || '').trim();
      if (!k) continue;
      const isMatch = want.includes(k) || (want.includes('lure') && k === 'lure_sticky');
      if (!isMatch) continue;
      if (vecDistSqXZ(d.position, playerPos) <= maxDistSq) return true;
    }
    return false;
  }

  isPlayerInSmoke(playerPos) {
    const clouds = typeof this.worldState?.getSmokeClouds === 'function'
      ? this.worldState.getSmokeClouds()
      : (Array.isArray(this.worldState?.smokeClouds) ? this.worldState.smokeClouds : []);
    if (!Array.isArray(clouds) || clouds.length === 0) return false;

    for (const cloud of clouds) {
      if (!cloud) continue;
      const life = toNum(cloud.life, 0);
      if (!(life > 0)) continue;
      const radius = toNum(cloud.radius, 0);
      if (!(radius > 0)) continue;
      const cx = Number.isFinite(cloud.x) ? cloud.x : (Number.isFinite(cloud.position?.x) ? cloud.position.x : 0);
      const cz = Number.isFinite(cloud.z) ? cloud.z : (Number.isFinite(cloud.position?.z) ? cloud.position.z : 0);
      const dx = (playerPos.x || 0) - cx;
      const dz = (playerPos.z || 0) - cz;
      if (dx * dx + dz * dz <= radius * radius) return true;
    }
    return false;
  }

  scanThreat(playerGrid, playerPos) {
    const monsters = this.monsterManager?.getMonsters ? this.monsterManager.getMonsters() : [];
    let nearest = null;
    let nearestSeer = null;
    let seenCount = 0;

    for (const monster of monsters) {
      if (!monster || monster.isDead || monster.isDying) continue;
      const grid = monster.getGridPosition?.();
      if (!grid || !playerGrid) continue;
      const distTiles = Math.abs(grid.x - playerGrid.x) + Math.abs(grid.y - playerGrid.y);

      const seesPlayer = this.monsterManager?.canMonsterSeePlayer
        ? this.monsterManager.canMonsterSeePlayer(monster, playerGrid)
        : false;
      if (seesPlayer) seenCount += 1;

      const mPos = monster.getWorldPosition?.() || null;
      const distWorldSq = mPos ? vecDistSqXZ(mPos, playerPos) : Infinity;

      if (!nearest || distTiles < nearest.distTiles || (distTiles === nearest.distTiles && distWorldSq < nearest.distWorldSq)) {
        nearest = { monster, grid, distTiles, distWorldSq, seesPlayer };
      }
      if (seesPlayer) {
        if (!nearestSeer || distTiles < nearestSeer.distTiles || (distTiles === nearestSeer.distTiles && distWorldSq < nearestSeer.distWorldSq)) {
          nearestSeer = { monster, grid, distTiles, distWorldSq, seesPlayer: true };
        }
      }
    }

    return {
      nearest,
      nearestSeer,
      seenCount,
      seenByAny: seenCount > 0
    };
  }

  getMonsterTypeId(monster) {
    const id = monster?.typeConfig?.id || monster?.typeConfig?.name || monster?.type || '';
    return String(id || '').trim().toUpperCase();
  }

  getNeighborCount(gridPos) {
    const ws = this.worldState;
    if (!ws?.isWalkable) return 0;
    const x = Number(gridPos?.x);
    const y = Number(gridPos?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return 0;
    let n = 0;
    if (ws.isWalkable(x + 1, y)) n += 1;
    if (ws.isWalkable(x - 1, y)) n += 1;
    if (ws.isWalkable(x, y + 1)) n += 1;
    if (ws.isWalkable(x, y - 1)) n += 1;
    return n;
  }

  throwSmokePrefer(toolSystem, inv, { preferStrong = false } = {}) {
    if (!toolSystem) return false;
    const strong = this.getInventoryCount(inv, 'smoke_strong') > 0;
    const normal = this.getInventoryCount(inv, 'smoke') > 0;
    const weak = this.getInventoryCount(inv, 'smoke_weak') > 0;
    if (preferStrong && strong && toolSystem.throwSmokeStrong) return !!toolSystem.throwSmokeStrong();
    if (normal && toolSystem.throwSmoke) return !!toolSystem.throwSmoke();
    if (weak && toolSystem.throwSmokeWeak) return !!toolSystem.throwSmokeWeak();
    if (strong && toolSystem.throwSmokeStrong) return !!toolSystem.throwSmokeStrong();
    if (toolSystem.throwSmoke) return !!toolSystem.throwSmoke();
    return false;
  }

  throwDecoyPrefer(toolSystem, inv, { preferDelay = false } = {}) {
    if (!toolSystem) return false;
    const delay = this.getInventoryCount(inv, 'decoy_delay') > 0;
    const normal = this.getInventoryCount(inv, 'decoy') > 0;
    if (preferDelay && delay && toolSystem.throwDecoyDelay) return !!toolSystem.throwDecoyDelay();
    if (normal && toolSystem.throwDecoy) return !!toolSystem.throwDecoy();
    if (delay && toolSystem.throwDecoyDelay) return !!toolSystem.throwDecoyDelay();
    if (toolSystem.throwDecoy) return !!toolSystem.throwDecoy();
    return false;
  }

  tryUseTool(kind, fn, cooldownSeconds) {
    const key = String(kind || '').trim();
    if (!key) return false;
    if ((this.cooldowns[key] || 0) > 0) return false;
    const ok = !!fn?.();
    if (ok) {
      const cd = Math.max(0.1, toNum(cooldownSeconds, 0.5));
      this.cooldowns[key] = cd;
      this.globalCooldown = Math.max(this.globalCooldown, Math.min(1.0, cd * 0.15));
    }
    return ok;
  }

  update(deltaTime, ctx = null) {
    const dt = deltaTime ?? 0;
    this.tickCooldowns(dt);

    if (!this.enabled) return;
    if (!CONFIG.AUTOPILOT_ENABLED) return;
    if (CONFIG.AUTOPILOT_TOOL_AI_ENABLED === false) return;
    if (!ctx?.autopilotActive) return;
    if (this.globalCooldown > 0) return;
    if (this.gameState?.gameOver) return;

    const player = this.player;
    const toolSystem = this.toolSystem;
    if (!player || !toolSystem || !this.gameState) return;

    const playerPos = player.getPosition?.() || player.position || null;
    const playerGrid = player.getGridPosition?.() || null;
    if (!playerPos || !playerGrid) return;

    const gridKey = `${playerGrid.x},${playerGrid.y}`;
    if (this.lastGridKey === gridKey) {
      this.stillSeconds = (this.stillSeconds || 0) + Math.max(0, dt);
    } else {
      this.stillSeconds = 0;
      this.lastGridKey = gridKey;
    }

    const inv = this.gameState.getInventorySnapshot?.() || {};
    const hasFlash = this.getInventoryCount(inv, 'flash') > 0;
    const hasSmoke =
      this.getInventoryCount(inv, 'smoke') > 0 ||
      this.getInventoryCount(inv, 'smoke_weak') > 0 ||
      this.getInventoryCount(inv, 'smoke_strong') > 0;
    const hasJammer = this.getInventoryCount(inv, 'jammer') > 0;
    const hasTrap = this.getInventoryCount(inv, 'trap') > 0;
    const hasMine = this.getInventoryCount(inv, 'mine') > 0;
    const hasSensor = this.getInventoryCount(inv, 'sensor') > 0;
    const hasDecoy = this.getInventoryCount(inv, 'decoy') > 0 || this.getInventoryCount(inv, 'decoy_delay') > 0;
    const hasLure = this.getInventoryCount(inv, 'lure') > 0 || this.getInventoryCount(inv, 'lure_sticky') > 0;
    const hasScentSpray = this.getInventoryCount(inv, 'scent_spray') > 0;
    const hasDoorWedge = this.getInventoryCount(inv, 'door_wedge') > 0;
    const hasGlowstick = this.getInventoryCount(inv, 'glowstick') > 0;
    const hasSonar = this.getInventoryCount(inv, 'sonar_pulse') > 0;
    const hasFakeHack = this.getInventoryCount(inv, 'fake_hack') > 0;

    const state = this.getAutopilotObjectiveState();
    const avoidNoise = this.isNoiseSensitiveObjective(state);
    const holdingObjective = this.isHoldingPositionObjective(state);
    const objectiveTemplate = String(state?.objective?.template || '').trim();
    const bossPhase = Math.max(0, Math.round(Number(state?.objective?.progress?.phase) || 0));
    const moveCmd = ctx?.externalCommand?.move || null;
    const holdingStill = holdingObjective || (moveCmd && Math.hypot(toNum(moveCmd.x, 0), toNum(moveCmd.y, 0)) < 0.05);
    const wantsInteract = !!ctx?.externalCommand?.interact;

    const inSmoke = this.isPlayerInSmoke(playerPos);
    const threat = this.scanThreat(playerGrid, playerPos);
    const nearest = threat.nearest;
    const nearestDist = nearest?.distTiles ?? Infinity;
    const nearestTypeId = this.getMonsterTypeId(nearest?.monster);
    const isHearingHunter = nearestTypeId === 'HEARING_HUNTER';
    const isScentHound = nearestTypeId === 'SCENT_HOUND';

    const tileSize = CONFIG.TILE_SIZE || 1;
    const jammerRadius = toNum(CONFIG.TOOL_JAMMER_RADIUS, 6.5);
    const sensorRadius = toNum(CONFIG.TOOL_SENSOR_RADIUS, 7.5);

    // Emergency: melee-range => flash or smoke, then trap/mine.
    if (nearest && nearestDist <= 2) {
      if (hasFlash) {
        const used = this.tryUseTool('flash', () => toolSystem.throwFlash?.(), 4.5);
        if (used) return;
      }
      if (hasSmoke && !inSmoke) {
        const used = this.tryUseTool('smoke', () => this.throwSmokePrefer(toolSystem, inv, { preferStrong: true }), 7.0);
        if (used) return;
      }
      if (hasDoorWedge) {
        const used = this.tryUseTool('wedge', () => toolSystem.deployDoorWedge?.(), 9.5);
        if (used) return;
      }
      if (hasTrap && !this.hasDeviceNear('trap', playerPos, tileSize * 1.8)) {
        const used = this.tryUseTool('trap', () => toolSystem.deployTrap?.(), 4.0);
        if (used) return;
      }
      if (hasMine && !avoidNoise && !this.hasDeviceNear('mine', playerPos, tileSize * 1.8)) {
        const used = this.tryUseTool('mine', () => toolSystem.deployMine?.(), 6.0);
        if (used) return;
      }
      if (!avoidNoise && hasDecoy) {
        const used = this.tryUseTool('decoy', () => this.throwDecoyPrefer(toolSystem, inv, { preferDelay: true }), 6.0);
        if (used) return;
      }
    }

    // If we are actively reloading under pressure, create a short safety window (space -> reload).
    const hud = this.gun?.getHudState ? this.gun.getHudState() : null;
    const isReloading = !!hud?.isReloading;
    if (isReloading && (nearestDist <= 6 || threat.seenByAny)) {
      if (hasSmoke && !inSmoke) {
        const used = this.tryUseTool('smoke', () => this.throwSmokePrefer(toolSystem, inv, { preferStrong: true }), 6.5);
        if (used) return;
      }
      if (hasDoorWedge && nearestDist <= 5) {
        const used = this.tryUseTool('wedge', () => toolSystem.deployDoorWedge?.(), 10.0);
        if (used) return;
      }
      if (hasFlash && nearestDist <= 3) {
        const used = this.tryUseTool('flash', () => toolSystem.throwFlash?.(), 4.5);
        if (used) return;
      }
    }

    // Objective interaction under pressure: create a safe bubble before interacting.
    if (wantsInteract && (nearestDist <= 7 || threat.seenByAny)) {
      if (hasJammer && !this.hasDeviceNear('jammer', playerPos, jammerRadius * 0.6)) {
        const used = this.tryUseTool('jammer', () => toolSystem.deployJammer?.(), 10.0);
        if (used) return;
      }
      if (hasSmoke && !inSmoke && nearestDist <= 7) {
        const used = this.tryUseTool('smoke', () => this.throwSmokePrefer(toolSystem, inv, { preferStrong: nearestDist <= 5 }), 7.5);
        if (used) return;
      }
      if (hasDoorWedge && nearestDist <= 5) {
        const used = this.tryUseTool('wedge', () => toolSystem.deployDoorWedge?.(), 10.0);
        if (used) return;
      }
    }

    // Scent counterplay: if the nearest threat is scent-driven, apply scent spray proactively.
    if (hasScentSpray && isScentHound && nearestDist <= 8) {
      const pm = this.player?.getPerceptionModifiers?.() || null;
      const active = Number(pm?.scentStrengthMult) < 0.95 || Number(pm?.scentRadiusMult) < 0.95;
      if (!active) {
        const used = this.tryUseTool('scent', () => toolSystem.useScentSpray?.(), 18.0);
        if (used) return;
      }
    }

    // During noise-sensitive objectives, prefer scent-based stealth over loud tools.
    if (avoidNoise && hasScentSpray && nearestDist <= 8) {
      const pm = this.player?.getPerceptionModifiers?.() || null;
      const active = Number(pm?.scentStrengthMult) < 0.95 || Number(pm?.scentRadiusMult) < 0.95;
      if (!active) {
        const used = this.tryUseTool('scent', () => toolSystem.useScentSpray?.(), 18.0);
        if (used) return;
      }
    }

    // Boss finale: spend tools a bit more aggressively during phases 1-2 to keep momentum.
    if (objectiveTemplate === 'bossFinale' && (bossPhase === 1 || bossPhase === 2)) {
      if (threat.seenByAny && hasSmoke && !inSmoke && nearestDist <= 9) {
        const used = this.tryUseTool('smoke', () => this.throwSmokePrefer(toolSystem, inv, { preferStrong: true }), 6.0);
        if (used) return;
      }
      if (hasFlash && threat.seenByAny && nearestDist <= 4) {
        const used = this.tryUseTool('flash', () => toolSystem.throwFlash?.(), 4.0);
        if (used) return;
      }
      if (!avoidNoise && hasDecoy && threat.seenByAny && nearestDist <= 10) {
        const used = this.tryUseTool('decoy', () => this.throwDecoyPrefer(toolSystem, inv, { preferDelay: true }), 6.0);
        if (used) return;
      }
    }

    // Boss escape: prioritize LOS breaks while running to exit.
    if (objectiveTemplate === 'bossFinale' && bossPhase >= 3) {
      if (threat.seenByAny && hasSmoke && !inSmoke && nearestDist <= 10) {
        const used = this.tryUseTool('smoke', () => this.throwSmokePrefer(toolSystem, inv, { preferStrong: true }), 6.5);
        if (used) return;
      }
      if (!avoidNoise && hasDecoy && threat.seenByAny && nearestDist <= 10) {
        const used = this.tryUseTool('decoy', () => this.throwDecoyPrefer(toolSystem, inv, { preferDelay: true }), 6.0);
        if (used) return;
      }
      if (hasJammer && !this.hasDeviceNear('jammer', playerPos, jammerRadius * 0.55) && nearestDist <= 8) {
        const used = this.tryUseTool('jammer', () => toolSystem.deployJammer?.(), 10.0);
        if (used) return;
      }
    }

    // Distraction: drop a lure to pull monsters off our line (when allowed) and keep moving.
    if (!avoidNoise && !holdingStill && threat.seenByAny && nearestDist <= 10) {
      if (hasLure && !this.hasDeviceNear('lure', playerPos, tileSize * 2.4)) {
        const preferSticky = this.getInventoryCount(inv, 'lure_sticky') > 0 && this.getNeighborCount(playerGrid) <= 2;
        const used = this.tryUseTool('lure', () => {
          if (preferSticky && toolSystem.deployLureSticky) return toolSystem.deployLureSticky();
          return toolSystem.deployLure?.();
        }, 12.0);
        if (used) return;
      }
    }

    // If any monster has vision on us, break LOS with smoke when possible.
    if (threat.seenByAny && hasSmoke && !inSmoke && nearestDist <= 7) {
      const used = this.tryUseTool('smoke', () => this.throwSmokePrefer(toolSystem, inv, { preferStrong: nearestDist <= 5 }), 7.0);
      if (used) return;
    }

    // Holding position for an objective: deploy jammer/sensor to create a safer bubble.
    if (holdingStill) {
      if (hasJammer && !this.hasDeviceNear('jammer', playerPos, jammerRadius * 0.6)) {
        const used = this.tryUseTool('jammer', () => toolSystem.deployJammer?.(), 10.0);
        if (used) return;
      }
      if (hasSensor && !this.hasDeviceNear('sensor', playerPos, sensorRadius * 0.6)) {
        const used = this.tryUseTool('sensor', () => toolSystem.deploySensor?.(), 12.0);
        if (used) return;
      }
    }

    // Low-risk utility: drop a sensor when surrounded (even while moving) for early warning pings.
    if (!holdingStill && hasSensor && threat.seenCount === 0 && nearestDist <= 8) {
      if (!this.hasDeviceNear('sensor', playerPos, sensorRadius * 0.45)) {
        const used = this.tryUseTool('sensor', () => toolSystem.deploySensor?.(), 14.0);
        if (used) return;
      }
    }

    // Optional distraction: only when not noise-sensitive, and only if already spotted.
    if (!avoidNoise && threat.seenByAny && nearestDist <= 9) {
      if (hasDecoy) {
        const used = this.tryUseTool('decoy', () => {
          const ok = this.throwDecoyPrefer(toolSystem, inv, { preferDelay: isHearingHunter });
          if (ok) {
            const sec = Number(CONFIG.AUTOPILOT_DIVERSION_DEFAULT_SECONDS) || 5;
            this.autopilot?.requestDiversion?.(sec, 'decoy');
          }
          return ok;
        }, 6.0);
        if (used) return;
      }
    }

    // Route control: wedge an adjacent door when chased to create spacing (if available).
    if (!avoidNoise && hasDoorWedge && threat.seenByAny && nearestDist <= 5) {
      const used = this.tryUseTool('wedge', () => toolSystem.deployDoorWedge?.(), 12.0);
      if (used) return;
    }

    // Fake objective beacon: when chased (esp. by noise hunters), drop it and rotate path.
    if (!avoidNoise && hasFakeHack && threat.seenByAny && nearestDist <= 10) {
      const used = this.tryUseTool('fakeHack', () => {
        const ok = toolSystem.deployFakeHack?.();
        if (ok) {
          const sec = Math.max(4, Number(CONFIG.AUTOPILOT_DIVERSION_DEFAULT_SECONDS) || 5);
          this.autopilot?.requestDiversion?.(sec, 'fakeHack');
        }
        return ok;
      }, 22.0);
      if (used) return;
    }

    // Navigation breadcrumb: drop glowsticks at junctions when safe.
    if (hasGlowstick && !holdingStill && nearestDist >= 10) {
      const nowSec = this.gameState?.getElapsedTime?.() ?? 0;
      const neighbors = this.getNeighborCount(playerGrid);
      if (neighbors >= 3 && nowSec - (this.lastGlowstickAtSec || 0) >= 14) {
        const last = this.lastGlowstickGridKey;
        if (last !== gridKey) {
          const used = this.tryUseTool('glowstick', () => toolSystem.deployGlowstick?.(), 14.0);
          if (used) {
            this.lastGlowstickAtSec = nowSec;
            this.lastGlowstickGridKey = gridKey;
            return;
          }
        }
      }
    }

    // Stuck recovery: if we're stationary while trying to move, pulse sonar to re-orient (costs noise).
    if (!avoidNoise && hasSonar && !holdingStill && (this.stillSeconds || 0) >= 3.0 && nearestDist >= 8) {
      const used = this.tryUseTool('sonar', () => toolSystem.useSonarPulse?.(), 18.0);
      if (used) return;
    }
  }
}
