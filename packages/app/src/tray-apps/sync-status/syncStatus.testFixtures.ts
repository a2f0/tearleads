import type {
  DomainSyncSnapshot,
  SyncLaneSnapshot,
} from "@tearleads/client-sdk";

export const SETTLED = {
  unavailableReason: null,
  billingNeedsAttention: false,
  otherOrganizationBillingBlocked: false,
  ready: true,
  pendingWriteCount: 0,
  failedWriteCount: 0,
  queueReadError: null,
  failedLaneCount: 0,
  syncActive: false,
} as const;

export const DESCRIBED = {
  unavailableReason: null,
  pendingWriteCount: 0,
  failedWriteCount: 0,
  firstWriteError: null,
  queueReadError: null,
  failedLaneCount: 0,
  firstLaneError: null,
  syncActive: false,
  online: true,
  syncPaused: false,
  writesPaused: false,
  blockedWriteCount: 0,
  billingStatus: null,
  billingBlockScope: "active",
} as const;

export const NO_LANES = { failed: 0, firstError: null, running: 0 } as const;

export function lane(overrides: Partial<SyncLaneSnapshot>): SyncLaneSnapshot {
  return {
    blobStorageKey: null,
    errorCount: 0,
    key: "documents:note",
    label: "Note",
    lastAction: "completed",
    lastActionAt: "2026-11-22T00:00:00.000Z",
    lastCompletedAt: "2026-11-22T00:00:00.000Z",
    lastError: null,
    lastFailedAt: null,
    lastRequestedAt: null,
    lastStartedAt: null,
    phase: "document",
    progress: null,
    registrationIndex: 0,
    requestCount: 1,
    requested: false,
    runAbandoned: false,
    runCount: 1,
    runDurations: null,
    running: false,
    status: "complete",
    ...overrides,
  };
}

export function snapshot(
  lanes: ReadonlyArray<SyncLaneSnapshot>,
  updatedAt = "2026-11-22T00:00:00.000Z",
): DomainSyncSnapshot {
  return {
    hasPendingWork: lanes.some((entry) => entry.running || entry.requested),
    lanes,
    pumpActive: lanes.some((entry) => entry.running),
    updatedAt,
  };
}
