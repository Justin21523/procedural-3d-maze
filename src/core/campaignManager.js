const STORAGE_KEY = 'p3dm_campaign_v1';

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function clampInt(n, min, max) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
}

function formatSeconds(sec) {
  const n = Math.max(0, Math.round(Number(sec) || 0));
  const m = Math.floor(n / 60);
  const s = n % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function computeLevelScore(stats = null, weights = null) {
  const w = {
    time: 14,
    steps: 1.6,
    rooms: -2.0, // exploring more rooms is rewarded slightly
    healthLost: 6.0,
    ...weights
  };
  const time = Number(stats?.time) || 0;
  const steps = Number(stats?.steps) || 0;
  const roomsVisited = Number(stats?.roomsVisited) || 0;
  const healthPct = Number(stats?.healthPercentage);
  const healthLost = Number.isFinite(healthPct) ? Math.max(0, 100 - healthPct) : 50;

  // Higher is better; clamp to avoid negatives exploding the UI.
  const raw =
    10000 -
    time * w.time -
    steps * w.steps -
    healthLost * w.healthLost +
    roomsVisited * (-w.rooms);

  return Math.max(0, Math.round(raw));
}

export class CampaignManager {
  constructor(options = {}) {
    this.storageKey = String(options.storageKey || STORAGE_KEY);
    this.levelCount = clampInt(options.levelCount ?? 10, 1, 999);
    this.failureLimit = clampInt(options.failureLimit ?? 2, 1, 99);
  }

  load() {
    const raw = safeJsonParse(localStorage.getItem(this.storageKey) || '');
    const base = this.defaultState();
    if (!raw || typeof raw !== 'object') return base;

    const state = {
      ...base,
      permanent: raw.permanent && typeof raw.permanent === 'object'
        ? { ...base.permanent, ...raw.permanent }
        : base.permanent,
      run: {
        ...base.run,
        ...(raw.run && typeof raw.run === 'object' ? raw.run : {}),
      },
      lastRunSummary: raw.lastRunSummary && typeof raw.lastRunSummary === 'object' ? raw.lastRunSummary : null,
    };

    state.run.levelCount = this.levelCount;
    state.run.failureLimit = this.failureLimit;
    state.run.currentLevelIndex = clampInt(state.run.currentLevelIndex ?? 0, 0, this.levelCount - 1);
    state.run.failures = clampInt(state.run.failures ?? 0, 0, this.failureLimit);
    if (!Array.isArray(state.run.levelResults)) state.run.levelResults = [];
    if (!Array.isArray(state.run.levelAttempts)) state.run.levelAttempts = [];
    if (!Array.isArray(state.run.levelMutators)) state.run.levelMutators = [];
    if (!Array.isArray(state.permanent?.mutatorsUnlocked)) state.permanent.mutatorsUnlocked = [];

    return state;
  }

  save(state) {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(state));
    } catch {
      // ignore
    }
  }

  defaultState() {
    return {
      version: 1,
      run: this.defaultRun(),
      lastRunSummary: null,
      permanent: {
        version: 1,
        mutatorsUnlocked: []
      }
    };
  }

  defaultRun() {
    return {
      runId: `run_${Math.random().toString(16).slice(2)}_${Date.now()}`,
      startedAtMs: Date.now(),
      levelCount: this.levelCount,
      failureLimit: this.failureLimit,
      currentLevelIndex: 0,
      failures: 0,
      levelAttempts: [],
      levelResults: [], // index -> { name, stats, score }
      levelMutators: [] // index -> string[] mutator ids (stable within run)
    };
  }

  startNewRun(state) {
    const next = {
      ...state,
      run: this.defaultRun()
    };
    this.save(next);
    return next;
  }

  recordAttempt(state, levelIndex) {
    const idx = clampInt(levelIndex, 0, this.levelCount - 1);
    const next = { ...state, run: { ...state.run } };
    const attempts = Array.isArray(next.run.levelAttempts) ? [...next.run.levelAttempts] : [];
    attempts[idx] = clampInt((attempts[idx] ?? 0) + 1, 0, 9999);
    next.run.levelAttempts = attempts;
    this.save(next);
    return next;
  }

  recordWin(state, levelIndex, levelConfig, stats) {
    const idx = clampInt(levelIndex, 0, this.levelCount - 1);
    const next = { ...state, run: { ...state.run } };
    const results = Array.isArray(next.run.levelResults) ? [...next.run.levelResults] : [];
    const score = computeLevelScore(stats);
    results[idx] = {
      levelIndex: idx,
      id: levelConfig?.id ?? (idx + 1),
      name: String(levelConfig?.name || `L${idx + 1}`),
      stats: stats || null,
      score,
      finishedAtMs: Date.now()
    };
    next.run.levelResults = results;
    next.run.currentLevelIndex = clampInt(idx + 1, 0, this.levelCount);
    this.save(next);
    return next;
  }

  recordLoss(state, levelIndex, levelConfig, stats) {
    const idx = clampInt(levelIndex, 0, this.levelCount - 1);
    let next = { ...state, run: { ...state.run } };
    next.run.failures = clampInt((next.run.failures ?? 0) + 1, 0, this.failureLimit);
    this.save(next);

    if (next.run.failures >= this.failureLimit) {
      const summary = this.computeSummary(next);
      summary.endReason = 'failureLimit';
      summary.failedAtLevel = {
        levelIndex: idx,
        id: levelConfig?.id ?? (idx + 1),
        name: String(levelConfig?.name || `L${idx + 1}`),
        stats: stats || null
      };
      next = this.startNewRun({ ...next, lastRunSummary: summary });
    }

    return next;
  }

  endRun(state, { reason = 'abandon', atLevelIndex = null, levelConfig = null, stats = null } = {}) {
    const summary = this.computeSummary(state);
    summary.endReason = String(reason || 'abandon');
    if (Number.isFinite(Number(atLevelIndex))) {
      const idx = clampInt(atLevelIndex, 0, this.levelCount - 1);
      summary.endedAtLevel = {
        levelIndex: idx,
        id: levelConfig?.id ?? (idx + 1),
        name: String(levelConfig?.name || `L${idx + 1}`),
        stats: stats || null
      };
    }
    const next = this.startNewRun({ ...state, lastRunSummary: summary });
    return { next, summary };
  }

  isComplete(state) {
    const results = state?.run?.levelResults;
    if (!Array.isArray(results)) return false;
    for (let i = 0; i < this.levelCount; i++) {
      if (!results[i]?.stats?.hasWon) return false;
    }
    return true;
  }

  computeSummary(state) {
    const run = state?.run || {};
    const results = Array.isArray(run.levelResults) ? run.levelResults : [];
    const attempts = Array.isArray(run.levelAttempts) ? run.levelAttempts : [];
    const completed = [];

    let sumTime = 0;
    let sumSteps = 0;
    let sumRooms = 0;
    let sumScoreWeighted = 0;
    let sumWeights = 0;

    for (let i = 0; i < this.levelCount; i++) {
      const r = results[i] || null;
      const stats = r?.stats || null;
      if (!stats?.hasWon) continue;
      const score = Number(r?.score) || computeLevelScore(stats);
      const weight = 1 + i * 0.06;

      completed.push({
        levelIndex: i,
        name: String(r?.name || `L${i + 1}`),
        time: Number(stats?.time) || 0,
        timeFormatted: String(stats?.timeFormatted || formatSeconds(stats?.time)),
        steps: Number(stats?.steps) || 0,
        roomsVisited: Number(stats?.roomsVisited) || 0,
        health: Number(stats?.health) || 0,
        score
      });

      sumTime += Number(stats?.time) || 0;
      sumSteps += Number(stats?.steps) || 0;
      sumRooms += Number(stats?.roomsVisited) || 0;
      sumScoreWeighted += score * weight;
      sumWeights += weight;
    }

    const count = completed.length || 0;
    const avgTime = count > 0 ? sumTime / count : 0;
    const avgSteps = count > 0 ? sumSteps / count : 0;
    const avgRooms = count > 0 ? sumRooms / count : 0;
    const avgScore = sumWeights > 0 ? sumScoreWeighted / sumWeights : 0;

    return {
      runId: String(run.runId || ''),
      startedAtMs: Number(run.startedAtMs) || Date.now(),
      finishedAtMs: Date.now(),
      levelCount: this.levelCount,
      failureLimit: this.failureLimit,
      failures: clampInt(run.failures ?? 0, 0, this.failureLimit),
      currentLevelIndex: clampInt(run.currentLevelIndex ?? 0, 0, this.levelCount),
      completedLevels: count,
      attempts,
      completed,
      totals: {
        time: sumTime,
        steps: sumSteps,
        roomsVisited: sumRooms
      },
      averages: {
        time: avgTime,
        timeFormatted: formatSeconds(avgTime),
        steps: avgSteps,
        roomsVisited: avgRooms,
        score: avgScore
      }
    };
  }
}
