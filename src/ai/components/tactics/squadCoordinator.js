import { CONFIG } from '../../../core/config.js';

function isValidGrid(grid) {
  if (!grid) return false;
  return Number.isFinite(grid.x) && Number.isFinite(grid.y);
}

function normalizeRole(role) {
  return String(role || '').trim().toLowerCase();
}

export class SquadCoordinator {
  constructor(options = {}) {
    this.squads = new Map(); // squadId -> state

    this.defaultMemorySeconds =
      options.defaultMemorySeconds ??
      (CONFIG.AI_SQUAD_MEMORY_SECONDS ?? 6.5);

    this.staleSeconds =
      options.staleSeconds ??
      (CONFIG.AI_SQUAD_STALE_SECONDS ?? 30);
  }

  clear() {
    this.squads.clear();
  }

  ensureSquad(squadId) {
    const id = String(squadId || '');
    if (!id) return null;

    let squad = this.squads.get(id);
    if (!squad) {
      squad = {
        squadId: id,
        members: new Map(), // monsterId -> { role, lastSeenAt }
        leaderId: null,

        targetGrid: null,
        targetKind: null, // 'player' | 'noise'
        targetPriority: 0,
        targetReportedBy: null,
        targetReportedRole: null,

        flankAssignments: new Map(), // monsterId -> { slot, expiresAt }
        fireGrants: new Map(), // monsterId -> expiresAt (focus-fire limiter)

        updatedAt: 0,
        lastSeenAt: 0,
        engagedUntil: 0,
        lastTouchedAt: 0
      };
      this.squads.set(id, squad);
    }
    return squad;
  }

  cleanup(now) {
    const t = Number.isFinite(now) ? now : 0;
    const maxAge = Math.max(5, this.staleSeconds || 30);

    for (const [id, squad] of this.squads.entries()) {
      const age = t - (squad?.lastTouchedAt ?? 0);
      if (age > maxAge) {
        this.squads.delete(id);
      }
    }
  }

  updateMember(squadId, memberId, role, now) {
    const squad = this.ensureSquad(squadId);
    if (!squad) return null;

    const id = Number.isFinite(memberId) ? memberId : null;
    if (id === null) return squad;

    const t = Number.isFinite(now) ? now : 0;
    squad.lastTouchedAt = t;

    const r = normalizeRole(role);
    const existing = squad.members.get(id) || { role: r || null, lastSeenAt: 0 };
    existing.role = r || existing.role || null;
    existing.lastSeenAt = t;
    squad.members.set(id, existing);

    if (r === 'leader' && squad.leaderId === null) {
      squad.leaderId = id;
    }

    this.cleanup(t);
    return squad;
  }

  reportTarget(squadId, targetGrid, now, options = {}) {
    if (!isValidGrid(targetGrid)) return null;

    const squad = this.ensureSquad(squadId);
    if (!squad) return null;

    const t = Number.isFinite(now) ? now : 0;
    const kind = normalizeRole(options.kind) || 'noise';
    const priority = Number.isFinite(options.priority) ? options.priority : 0;
    const reporterId = Number.isFinite(options.reporterId) ? options.reporterId : null;
    const reporterRole = normalizeRole(options.reporterRole) || null;

    squad.lastTouchedAt = t;

    if (kind === 'player') {
      const isLeaderReporter =
        (reporterId !== null && reporterId === squad.leaderId) ||
        reporterRole === 'leader';

      // If the leader has a fresh player report, avoid non-leaders overwriting the shared target too often.
      const hasFreshLeaderTarget =
        squad.targetKind === 'player' &&
        squad.leaderId !== null &&
        squad.targetReportedBy === squad.leaderId &&
        (t - (squad.updatedAt || 0)) <= 0.75;

      if (hasFreshLeaderTarget && !isLeaderReporter) {
        return squad;
      }

      squad.targetGrid = { x: targetGrid.x, y: targetGrid.y };
      squad.targetKind = 'player';
      squad.targetPriority = Math.max(priority, isLeaderReporter ? 20 : 10);
      squad.targetReportedBy = reporterId;
      squad.targetReportedRole = reporterRole;
      squad.updatedAt = t;
      squad.lastSeenAt = t;
      const memory = Number.isFinite(options.memorySeconds) ? options.memorySeconds : this.defaultMemorySeconds;
      squad.engagedUntil = t + Math.max(1.0, memory || 6.5);
      return squad;
    }

    const sawRecently = t - (squad.lastSeenAt || 0) <= 1.2;
    if (sawRecently && squad.targetKind === 'player') {
      return squad;
    }

    const shouldReplace =
      !squad.targetGrid ||
      squad.targetKind !== 'player' && (
        priority > (squad.targetPriority || 0) ||
        t - (squad.updatedAt || 0) > 0.8
      );

    if (!shouldReplace) return squad;

    squad.targetGrid = { x: targetGrid.x, y: targetGrid.y };
    squad.targetKind = 'noise';
    squad.targetPriority = priority;
    squad.targetReportedBy = reporterId;
    squad.targetReportedRole = reporterRole;
    squad.updatedAt = t;
    const memory = Number.isFinite(options.memorySeconds) ? options.memorySeconds : Math.min(3.5, this.defaultMemorySeconds);
    squad.engagedUntil = t + Math.max(0.8, memory || 3.0);
    return squad;
  }

  getFlankSlot(squadId, memberId, slots, now, options = {}) {
    const squad = this.ensureSquad(squadId);
    if (!squad) return null;
    const id = Number.isFinite(memberId) ? memberId : null;
    if (id === null) return null;

    const t = Number.isFinite(now) ? now : 0;
    const slotCount = Math.max(1, Math.round(Number(slots) || 6));

    const keepSeconds =
      Number.isFinite(options.keepSeconds)
        ? options.keepSeconds
        : (CONFIG.AI_SQUAD_FLANK_SLOT_KEEP_SECONDS ?? 8.0);

    // Cleanup expired entries
    for (const [mid, entry] of squad.flankAssignments.entries()) {
      if (!entry) {
        squad.flankAssignments.delete(mid);
        continue;
      }
      const exp = Number.isFinite(entry.expiresAt) ? entry.expiresAt : 0;
      if (exp <= t) {
        squad.flankAssignments.delete(mid);
      }
    }

    const existing = squad.flankAssignments.get(id) || null;
    if (existing && Number.isFinite(existing.slot) && (existing.expiresAt || 0) > t) {
      return ((existing.slot % slotCount) + slotCount) % slotCount;
    }

    const used = new Set();
    for (const entry of squad.flankAssignments.values()) {
      if (!entry || !Number.isFinite(entry.slot)) continue;
      used.add(((entry.slot % slotCount) + slotCount) % slotCount);
    }

    let slot = null;
    for (let i = 0; i < slotCount; i++) {
      const candidate = (id + i) % slotCount;
      if (!used.has(candidate)) {
        slot = candidate;
        break;
      }
    }
    if (slot === null) {
      slot = id % slotCount;
    }

    squad.flankAssignments.set(id, {
      slot,
      expiresAt: t + Math.max(1.0, keepSeconds || 8.0)
    });

    squad.lastTouchedAt = t;
    this.cleanup(t);
    return slot;
  }

  getTarget(squadId, now) {
    const id = String(squadId || '');
    if (!id) return null;
    const squad = this.squads.get(id);
    if (!squad) return null;

    const t = Number.isFinite(now) ? now : 0;
    if ((squad.engagedUntil || 0) <= t) return null;
    if (!isValidGrid(squad.targetGrid)) return null;

    return {
      squadId: id,
      targetGrid: { x: squad.targetGrid.x, y: squad.targetGrid.y },
      targetKind: squad.targetKind,
      updatedAt: squad.updatedAt,
      lastSeenAt: squad.lastSeenAt,
      leaderId: squad.leaderId
    };
  }

  allowRangedFire(squadId, memberId, now, options = {}) {
    const squad = this.ensureSquad(squadId);
    if (!squad) return true;
    const id = Number.isFinite(memberId) ? memberId : null;
    if (id === null) return true;

    const t = Number.isFinite(now) ? now : 0;
    squad.lastTouchedAt = t;

    const grants = squad.fireGrants || new Map();
    squad.fireGrants = grants;

    // Cleanup expired grants
    for (const [mid, exp] of grants.entries()) {
      if (!Number.isFinite(exp) || exp <= t) {
        grants.delete(mid);
      }
    }

    const existing = grants.get(id);
    if (Number.isFinite(existing) && existing > t) {
      return true;
    }

    const role = normalizeRole(options.role || squad.members?.get?.(id)?.role || null);

    const maxShootersRaw =
      options.maxShooters ??
      (CONFIG.AI_SQUAD_MAX_RANGED_SHOOTERS ?? 2);
    const maxShooters = Math.max(1, Math.round(Number(maxShootersRaw) || 2));

    // Keep flankers mostly moving; let leader/cover do most shooting.
    const isFlanker = role === 'flanker' || role === 'scout';
    if (isFlanker && grants.size >= 1) {
      return false;
    }

    if (grants.size >= maxShooters) {
      return false;
    }

    const baseGrant =
      Number.isFinite(options.grantSeconds)
        ? options.grantSeconds
        : (CONFIG.AI_SQUAD_FIRE_GRANT_SECONDS ?? 0.9);
    const grantSeconds = Math.max(0.2, Math.min(6, Number(baseGrant) || 0.9));
    grants.set(id, t + grantSeconds * (0.85 + Math.random() * 0.3));

    return true;
  }
}
