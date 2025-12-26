import { canSeePlayer } from './components/perception/vision.js';
import { NoiseInvestigationModule } from './components/perception/noiseInvestigation.js';
import { FlankCoverTactics } from './components/tactics/flankCoverTactics.js';
import { SquadCoordinationModule } from './components/tactics/squadCoordination.js';

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function sameGrid(a, b) {
  if (!a || !b) return false;
  return a.x === b.x && a.y === b.y;
}

function getVisionRange(brain) {
  const v =
    (Number.isFinite(brain?.visionRange) ? brain.visionRange : null) ??
    (Number.isFinite(brain?.config?.visionRange) ? brain.config.visionRange : null) ??
    (Number.isFinite(brain?.monster?.visionRange) ? brain.monster.visionRange : null);
  return Number.isFinite(v) ? v : null;
}

function normalizeModules(modules) {
  if (!modules) return null;
  if (Array.isArray(modules)) {
    const next = {};
    for (const name of modules) {
      if (typeof name === 'string' && name) next[name] = true;
    }
    return Object.keys(next).length > 0 ? next : null;
  }
  if (typeof modules === 'object') return modules;
  return null;
}

function moduleEnabled(entry) {
  if (!entry) return false;
  if (entry === true) return true;
  if (isObject(entry)) {
    return entry.enabled ?? true;
  }
  return !!entry;
}

export function applyBrainModules(brain, options = {}) {
  if (!brain) return brain;

  const config = options.config || brain.config || {};
  const modules = normalizeModules(config.modules);
  if (!modules) return brain;

  const worldState = options.worldState || brain.worldState || null;

  const enableSquad = moduleEnabled(modules.squadCoordination);
  const enableNoise = moduleEnabled(modules.noiseInvestigation);
  const enableTactics = moduleEnabled(modules.flankCoverTactics);

  if (enableSquad && !brain.__squadCoordination) {
    const entry = isObject(modules.squadCoordination) ? modules.squadCoordination : null;
    const squadCfg = isObject(config.squad) ? config.squad : null;
    const coordinator = squadCfg?.coordinator || config.squadCoordinator || null;
    brain.__squadCoordination = new SquadCoordinationModule(worldState, brain.monster, {
      enabled: entry?.enabled ?? true,
      coordinator,
      squadId: entry?.squadId ?? squadCfg?.squadId ?? brain.monster?.typeConfig?.squad?.squadId,
      role: entry?.role ?? squadCfg?.role ?? brain.monster?.typeConfig?.squad?.role,
      memorySeconds: entry?.memorySeconds ?? squadCfg?.memorySeconds,
      noiseShareSeconds: entry?.noiseShareSeconds ?? squadCfg?.noiseShareSeconds,
      flankSlotKeepSeconds: entry?.flankSlotKeepSeconds ?? squadCfg?.flankSlotKeepSeconds,
      flankTargetKeepSeconds: entry?.flankTargetKeepSeconds ?? squadCfg?.flankTargetKeepSeconds,
      coverFireEnabled: entry?.coverFireEnabled ?? squadCfg?.coverFireEnabled,
      coverFireRadius: entry?.coverFireRadius ?? squadCfg?.coverFireRadius,
      coverFireMinDist: entry?.coverFireMinDist ?? squadCfg?.coverFireMinDist,
      coverFireMaxDist: entry?.coverFireMaxDist ?? squadCfg?.coverFireMaxDist
    });
  }

  if (enableNoise && !brain.__noiseInvestigation && !brain.investigationModule) {
    const entry = isObject(modules.noiseInvestigation) ? modules.noiseInvestigation : null;
    brain.__noiseInvestigation = new NoiseInvestigationModule({
      enabled: entry?.enabled ?? config.investigateEnabled ?? true,
      noiseMemorySeconds: entry?.noiseMemorySeconds ?? config.noiseMemorySeconds,
      investigateTime: entry?.investigateTime ?? config.investigateTime,
      searchRadius: entry?.searchRadius ?? config.searchRadius,
      visitTTL: brain.visitTTL
    });
  }

  if (enableTactics && !brain.__tactics && !brain.tactics) {
    const entry = isObject(modules.flankCoverTactics) ? modules.flankCoverTactics : null;
    const base = isObject(config.tactics) ? config.tactics : null;
    brain.__tactics = new FlankCoverTactics(worldState, brain.monster, { ...(base || {}), ...(entry || {}) });
  }

  const originalPickTarget = brain.pickTarget?.bind(brain);
  if (typeof originalPickTarget !== 'function') return brain;
  const hasPickTargetModules = !!brain.__noiseInvestigation || !!brain.__tactics || !!brain.__squadCoordination;
  if (!hasPickTargetModules) return brain;

  if (!brain.__modulesPickTargetWrapped) {
    brain.__modulesPickTargetWrapped = true;

    brain.pickTarget = (monsterGrid) => {
      brain.__holdFromTactics = false;
      brain.__holdFromSquad = false;
      brain.__holdLookGrid = null;

      const baseTarget = originalPickTarget(monsterGrid);
      const playerGrid = brain.getPlayerGridPosition?.() || null;

      const visionRange = getVisionRange(brain);
      const canSee = playerGrid ? canSeePlayer(worldState, monsterGrid, playerGrid, visionRange) : false;

      if (brain.__squadCoordination?.getDirective) {
        const directive = brain.__squadCoordination.getDirective({
          now: brain.now?.() ?? performance.now() / 1000,
          monsterGrid,
          playerGrid,
          canSee,
          isWalkableTile: typeof brain.isWalkableTile === 'function' ? (x, y) => brain.isWalkableTile(x, y) : null,
          tactics: brain.__tactics || brain.tactics || null,
          lastHeardNoise: brain.lastHeardNoise
        });

        if (directive?.holdPosition) {
          brain.__holdFromSquad = true;
          brain.__holdLookGrid = directive.lookAtGrid || playerGrid || null;
          return monsterGrid;
        }

        if (directive?.targetGrid) {
          return directive.targetGrid;
        }
      }

      if (!playerGrid || !baseTarget || !sameGrid(baseTarget, playerGrid)) {
        return baseTarget;
      }

      if (!canSee && brain.__noiseInvestigation) {
        const invTarget = brain.__noiseInvestigation.tick({
          now: brain.now?.() ?? performance.now() / 1000,
          monsterGrid,
          lastHeardNoise: brain.lastHeardNoise,
          isWalkableTile: typeof brain.isWalkableTile === 'function' ? (x, y) => brain.isWalkableTile(x, y) : null,
          visitedTiles: brain.visitedTiles,
          posKey: typeof brain.posKey === 'function' ? (pos) => brain.posKey(pos) : null
        });

        if (invTarget) {
          return invTarget;
        }
      }

      if (canSee && brain.__tactics) {
        const tactic = brain.__tactics.tick({
          now: brain.now?.() ?? performance.now() / 1000,
          monsterGrid,
          playerGrid,
          isWalkableTile: typeof brain.isWalkableTile === 'function' ? (x, y) => brain.isWalkableTile(x, y) : null
        });

        if (tactic?.holdPosition) {
          brain.__holdFromTactics = true;
          return monsterGrid;
        }

        if (tactic?.targetGrid) {
          return tactic.targetGrid;
        }
      }

      return baseTarget;
    };
  }

  const originalTick = brain.tick?.bind(brain);
  if (typeof originalTick === 'function' && (brain.__tactics || brain.__squadCoordination) && !brain.__modulesTickWrapped) {
    brain.__modulesTickWrapped = true;

    brain.tick = (deltaTime) => {
      brain.__holdFromTactics = false;
      brain.__holdFromSquad = false;
      brain.__holdLookGrid = null;
      const cmd = originalTick(deltaTime);
      if (brain.__holdFromTactics || brain.__holdFromSquad) {
        const lookGrid = brain.__holdLookGrid || null;
        const lookYaw = lookGrid && brain.computeLookYawToGrid
          ? brain.computeLookYawToGrid(lookGrid)
          : (brain.computeLookYawToPlayer?.() ?? 0);
        return { move: { x: 0, y: 0 }, lookYaw, sprint: false };
      }
      return cmd;
    };
  }

  return brain;
}
