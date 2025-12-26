import { ROOM_TYPES } from '../../world/tileTypes.js';

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function toInt(v, fallback) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : fallback;
}

function normalizeMissionEntry(entry, index = 0) {
  const raw = entry || {};
  const id = String(raw.id || raw.missionId || `m${index + 1}`).trim();
  const template = String(raw.template || raw.type || '').trim();
  const params = raw.params && typeof raw.params === 'object' ? raw.params : {};
  const required = raw.required !== false;
  return { id, template, params, required };
}

export function normalizeMissionsConfig(levelConfig) {
  const missions = levelConfig?.missions || {};

  // New schema: missions.list[]
  if (Array.isArray(missions.list)) {
    const list = missions.list
      .map((m, idx) => normalizeMissionEntry(m, idx))
      .filter((m) => m.id && m.template);

    const requires = Array.isArray(missions.exit?.requires)
      ? missions.exit.requires.map((s) => String(s || '').trim()).filter(Boolean)
      : list.filter((m) => m.required).map((m) => m.id);

    const timeLimitSec = Number.isFinite(missions.timeLimitSec) ? Math.max(0, missions.timeLimitSec) : 0;

    return {
      schema: 'v2',
      timeLimitSec,
      list,
      exit: { requires }
    };
  }

  // Legacy schema: missions.type + missionPointCount + requiredToUnlockExit + timeLimitSec
  const type = String(missions.type || 'collectAndExit');
  const timeLimitSec = Number.isFinite(missions.timeLimitSec) ? Math.max(0, missions.timeLimitSec) : 0;
  const missionPointCount = clamp(toInt(missions.missionPointCount, 0) || 0, 0, 9999);
  const requiredToUnlockExit = clamp(toInt(missions.requiredToUnlockExit, missionPointCount) || 0, 0, missionPointCount);

  const defaultRooms = [ROOM_TYPES.CLASSROOM, ROOM_TYPES.OFFICE];

  if (type === 'timeAttack') {
    const list = [
      {
        id: 'evidence',
        template: 'collectEvidence',
        required: true,
        params: {
          count: missionPointCount || 5,
          required: requiredToUnlockExit || missionPointCount || 5,
          roomTypes: defaultRooms
        }
      }
    ];
    return {
      schema: 'legacy',
      timeLimitSec,
      list,
      exit: { requires: ['evidence'] }
    };
  }

  if (type === 'mixed') {
    const list = [
      {
        id: 'evidence',
        template: 'collectEvidence',
        required: true,
        params: {
          count: missionPointCount || 6,
          required: requiredToUnlockExit || missionPointCount || 6,
          roomTypes: defaultRooms
        }
      },
      {
        id: 'keycard',
        template: 'findKeycard',
        required: true,
        params: { roomTypes: [ROOM_TYPES.OFFICE, ROOM_TYPES.CLASSROOM] }
      }
    ];
    return {
      schema: 'legacy',
      timeLimitSec,
      list,
      exit: { requires: ['evidence', 'keycard'] }
    };
  }

  if (type === 'escort') {
    const surviveSeconds = Math.max(30, timeLimitSec || 180);
    const list = [
      {
        id: 'survive',
        template: 'surviveTimer',
        required: true,
        params: { seconds: surviveSeconds }
      }
    ];
    return {
      schema: 'legacy',
      timeLimitSec,
      list,
      exit: { requires: ['survive'] }
    };
  }

  // Default: collect-and-exit
  const list = [
    {
      id: 'evidence',
      template: 'collectEvidence',
      required: true,
      params: {
        count: missionPointCount || 3,
        required: requiredToUnlockExit || missionPointCount || 3,
        roomTypes: defaultRooms
      }
    }
  ];
  return {
    schema: 'legacy',
    timeLimitSec,
    list,
    exit: { requires: ['evidence'] }
  };
}

