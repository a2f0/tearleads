import type { DomainScope } from "../domainScope";
import type {
  DomainSyncSnapshot,
  SyncLaneLastAction,
  SyncLanePhase,
  SyncLaneProgress,
} from "./syncTelemetry";
import {
  createDomainSyncSnapshot,
  createSyncTimestamp,
  getSyncLanePhaseRank,
} from "./syncTelemetry";

export type {
  DomainSyncSnapshot,
  SyncLaneLastAction,
  SyncLanePhase,
  SyncLaneProgress,
  SyncLaneSnapshot,
  SyncLaneStatus,
} from "./syncTelemetry";

interface SyncRuntimeStatus {
  crypto: {
    encapsulationKeyPair: unknown;
  };
  auth: {
    isAuthenticated: boolean;
  };
  state: {
    online: boolean;
  };
}

export interface SyncLane {
  requestSync: () => void;
}

/**
 * Handle for an observational upload lane. Unlike pump-driven lanes, these are
 * never `requested` — the upload path that owns the handle drives the lane's
 * running/progress/terminal state directly. The coordinator pump ignores them
 * because `selectNextRequestedLane` only ever picks `requested` lanes.
 */
export interface UploadSyncLane {
  reportProgress: (progress: SyncLaneProgress) => void;
  complete: () => void;
  fail: (error: unknown) => void;
}

export interface UploadSyncLaneOptions {
  label?: string | undefined;
}

// Completed/failed upload lanes are retained so a finished upload stays visible
// in the visualizer, but capped so a long-lived session can't grow `lanes`
// without bound (one upload lane is created per attachment slot upload).
const MAX_RETAINED_UPLOAD_LANES = 10;

export interface SyncIdleOptions {
  intervalMs?: number;
  quietMs?: number;
  timeoutMs?: number;
}

export interface SyncLaneConfig {
  label?: string | undefined;
  onUnexpectedError?: (error: unknown) => void;
  phase?: SyncLanePhase;
  run: () => Promise<void>;
  shouldIgnoreError?: (error: unknown) => boolean;
}

interface SyncLaneState {
  config: SyncLaneConfig;
  errorCount: number;
  key: string;
  lastAction: SyncLaneLastAction;
  lastActionAt: string;
  lastCompletedAt: string | null;
  lastError: string | null;
  lastFailedAt: string | null;
  lastRequestedAt: string | null;
  lastStartedAt: string | null;
  progress: SyncLaneProgress | null;
  registrationIndex: number;
  requestCount: number;
  requested: boolean;
  runCount: number;
  running: boolean;
}

export interface DomainSyncCoordinator {
  beginUploadLane: (
    key: string,
    options?: UploadSyncLaneOptions,
  ) => UploadSyncLane;
  getSnapshot: () => DomainSyncSnapshot;
  registerLane: (key: string, config: SyncLaneConfig) => SyncLane;
  hasPendingWork: () => boolean;
  subscribe: (listener: () => void) => () => void;
  waitForIdle: (options?: SyncIdleOptions) => Promise<boolean>;
}

interface DomainSyncCoordinatorState {
  lanes: Map<string, SyncLaneState>;
  listeners: Set<() => void>;
  nextRegistrationIndex: number;
  pump: Promise<void> | null;
  snapshot: DomainSyncSnapshot;
}

const coordinatorsByScope = new WeakMap<DomainScope, DomainSyncCoordinator>();
const DEFAULT_SYNC_IDLE_INTERVAL_MS = 10;
const DEFAULT_SYNC_IDLE_QUIET_MS = 0;
const DEFAULT_SYNC_IDLE_TIMEOUT_MS = 500;
const DESTROYED_DATABASE_CLIENT_MESSAGES = [
  "Database worker client has been destroyed.",
  "DB has been closed.",
] as const;

function describeSyncLaneError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Observational upload lanes never enter the pump, so their run is never
// invoked; this satisfies the SyncLaneConfig contract without behavior.
function noopLaneRun(): Promise<void> {
  return Promise.resolve();
}

function compareSyncLaneOrder(
  left: SyncLaneState,
  right: SyncLaneState,
): number {
  const phaseRank = getSyncLanePhaseRank(left) - getSyncLanePhaseRank(right);
  if (phaseRank !== 0) {
    return phaseRank;
  }

  return left.registrationIndex - right.registrationIndex;
}

function publishSyncCoordinatorSnapshot(state: DomainSyncCoordinatorState) {
  state.snapshot = createDomainSyncSnapshot({
    hasPendingWork: !!state.pump || hasPendingLaneWork(state.lanes.values()),
    lanes: state.lanes.values(),
    pumpActive: !!state.pump,
  });
  for (const listener of [...state.listeners]) {
    try {
      listener();
    } catch {
      // Keep one observer failure from blocking sync or later observers.
    }
  }
}

type SyncLaneRunResult =
  | { status: "completed" }
  | { status: "failed"; error: unknown };

async function runSyncLane(state: SyncLaneState): Promise<SyncLaneRunResult> {
  try {
    await state.config.run();
    return { status: "completed" };
  } catch (error: unknown) {
    if (state.config.shouldIgnoreError?.(error)) {
      return { status: "completed" };
    }

    if (state.config.onUnexpectedError) {
      state.config.onUnexpectedError(error);
      return { status: "failed", error };
    }

    throw error;
  }
}

function reportUnexpectedSyncLaneError(state: SyncLaneState, error: unknown) {
  console.error(`Failed to run sync lane ${state.key}:`, error);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasPendingLaneWork(lanes: Iterable<SyncLaneState>): boolean {
  for (const lane of lanes) {
    if (lane.requested || lane.running) {
      return true;
    }
  }

  return false;
}

function hasRequestedLaneWork(lanes: Iterable<SyncLaneState>): boolean {
  for (const lane of lanes) {
    if (lane.requested) {
      return true;
    }
  }

  return false;
}

function selectNextRequestedLane(
  lanes: Iterable<SyncLaneState>,
): SyncLaneState | null {
  let selectedLane: SyncLaneState | null = null;

  for (const lane of lanes) {
    if (!lane.requested) {
      continue;
    }

    if (!selectedLane || compareSyncLaneOrder(lane, selectedLane) < 0) {
      selectedLane = lane;
    }
  }

  return selectedLane;
}

async function runRequestedSyncLanes(
  coordinatorState: DomainSyncCoordinatorState,
): Promise<void> {
  while (true) {
    const lane = selectNextRequestedLane(coordinatorState.lanes.values());
    if (!lane) {
      return;
    }

    lane.requested = false;
    lane.running = true;
    lane.runCount += 1;
    lane.lastAction = "started";
    lane.lastActionAt = createSyncTimestamp();
    lane.lastStartedAt = lane.lastActionAt;
    publishSyncCoordinatorSnapshot(coordinatorState);
    let runResult: SyncLaneRunResult | null = null;
    try {
      runResult = await runSyncLane(lane);
    } catch (error: unknown) {
      lane.requested = false;
      runResult = { status: "failed", error };
      reportUnexpectedSyncLaneError(lane, error);
    } finally {
      lane.running = false;
      lane.lastActionAt = createSyncTimestamp();
      if (runResult?.status === "failed") {
        lane.errorCount += 1;
        lane.lastAction = "failed";
        lane.lastError = describeSyncLaneError(runResult.error);
        lane.lastFailedAt = lane.lastActionAt;
      } else {
        lane.lastAction = "completed";
        lane.lastCompletedAt = lane.lastActionAt;
        lane.lastError = null;
      }
      publishSyncCoordinatorSnapshot(coordinatorState);
    }
  }
}

function scheduleCoordinatorPump(coordinatorState: DomainSyncCoordinatorState) {
  if (coordinatorState.pump) {
    return;
  }

  coordinatorState.pump = Promise.resolve()
    .then(() => runRequestedSyncLanes(coordinatorState))
    .finally(() => {
      coordinatorState.pump = null;
      publishSyncCoordinatorSnapshot(coordinatorState);

      if (hasRequestedLaneWork(coordinatorState.lanes.values())) {
        scheduleCoordinatorPump(coordinatorState);
      }
    });
}

function evictRetainedUploadLanes(
  coordinatorState: DomainSyncCoordinatorState,
) {
  const settledUploadLanes: SyncLaneState[] = [];
  for (const lane of coordinatorState.lanes.values()) {
    if (lane.config.phase === "blob" && !lane.running) {
      settledUploadLanes.push(lane);
    }
  }

  if (settledUploadLanes.length <= MAX_RETAINED_UPLOAD_LANES) {
    return;
  }

  settledUploadLanes.sort(
    (left, right) => left.registrationIndex - right.registrationIndex,
  );
  const removeCount = settledUploadLanes.length - MAX_RETAINED_UPLOAD_LANES;
  for (const lane of settledUploadLanes.slice(0, removeCount)) {
    coordinatorState.lanes.delete(lane.key);
  }
}

function beginUploadLane(
  coordinatorState: DomainSyncCoordinatorState,
  key: string,
  options: UploadSyncLaneOptions,
): UploadSyncLane {
  const startedAt = createSyncTimestamp();
  let lane = coordinatorState.lanes.get(key);
  if (lane) {
    lane.config = { label: options.label, phase: "blob", run: noopLaneRun };
  } else {
    lane = {
      config: { label: options.label, phase: "blob", run: noopLaneRun },
      errorCount: 0,
      key,
      lastAction: "started",
      lastActionAt: startedAt,
      lastCompletedAt: null,
      lastError: null,
      lastFailedAt: null,
      lastRequestedAt: null,
      lastStartedAt: startedAt,
      progress: null,
      registrationIndex: coordinatorState.nextRegistrationIndex,
      requestCount: 0,
      requested: false,
      runCount: 0,
      running: false,
    };
    coordinatorState.nextRegistrationIndex += 1;
    coordinatorState.lanes.set(key, lane);
  }

  const uploadLane = lane;
  uploadLane.running = true;
  uploadLane.runCount += 1;
  uploadLane.lastAction = "started";
  uploadLane.lastActionAt = startedAt;
  uploadLane.lastStartedAt = startedAt;
  uploadLane.lastError = null;
  uploadLane.progress = null;
  evictRetainedUploadLanes(coordinatorState);
  publishSyncCoordinatorSnapshot(coordinatorState);

  // If this lane key is re-begun (or evicted and recreated), runCount advances
  // and a stale handle from the prior session becomes a no-op, so out-of-order
  // callbacks can't clobber the newer upload's state.
  const sessionRunCount = uploadLane.runCount;
  const isCurrentSession = () => uploadLane.runCount === sessionRunCount;

  return {
    complete() {
      if (!isCurrentSession()) {
        return;
      }
      uploadLane.running = false;
      uploadLane.lastAction = "completed";
      uploadLane.lastActionAt = createSyncTimestamp();
      uploadLane.lastCompletedAt = uploadLane.lastActionAt;
      uploadLane.lastError = null;
      if (uploadLane.progress) {
        uploadLane.progress = {
          ...uploadLane.progress,
          bytesUploaded: uploadLane.progress.bytesTotal,
          partsCompleted: uploadLane.progress.partsTotal,
        };
      }
      evictRetainedUploadLanes(coordinatorState);
      publishSyncCoordinatorSnapshot(coordinatorState);
    },
    fail(error: unknown) {
      if (!isCurrentSession()) {
        return;
      }
      uploadLane.running = false;
      uploadLane.errorCount += 1;
      uploadLane.lastAction = "failed";
      uploadLane.lastActionAt = createSyncTimestamp();
      uploadLane.lastError = describeSyncLaneError(error);
      uploadLane.lastFailedAt = uploadLane.lastActionAt;
      evictRetainedUploadLanes(coordinatorState);
      publishSyncCoordinatorSnapshot(coordinatorState);
    },
    reportProgress(progress: SyncLaneProgress) {
      if (!isCurrentSession()) {
        return;
      }
      uploadLane.progress = { ...progress };
      uploadLane.lastActionAt = createSyncTimestamp();
      publishSyncCoordinatorSnapshot(coordinatorState);
    },
  };
}

function requestLaneSync(
  coordinatorState: DomainSyncCoordinatorState,
  lane: SyncLaneState,
) {
  lane.requested = true;
  lane.requestCount += 1;
  lane.lastAction = "requested";
  lane.lastActionAt = createSyncTimestamp();
  lane.lastRequestedAt = lane.lastActionAt;
  publishSyncCoordinatorSnapshot(coordinatorState);
  scheduleCoordinatorPump(coordinatorState);
}

async function waitForIdleLanes(
  coordinatorState: DomainSyncCoordinatorState,
  options: SyncIdleOptions = {},
): Promise<boolean> {
  const intervalMs = options.intervalMs ?? DEFAULT_SYNC_IDLE_INTERVAL_MS;
  const quietMs = options.quietMs ?? DEFAULT_SYNC_IDLE_QUIET_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_SYNC_IDLE_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  let quietStartedAt = Date.now();

  while (Date.now() <= deadline) {
    if (
      !coordinatorState.pump &&
      !hasPendingLaneWork(coordinatorState.lanes.values())
    ) {
      if (Date.now() - quietStartedAt >= quietMs) {
        return true;
      }
    } else {
      quietStartedAt = Date.now();
    }

    await delay(intervalMs);
  }

  return false;
}

function createDomainSyncCoordinator(): DomainSyncCoordinator {
  const coordinatorState: DomainSyncCoordinatorState = {
    lanes: new Map<string, SyncLaneState>(),
    listeners: new Set(),
    nextRegistrationIndex: 0,
    pump: null,
    snapshot: createDomainSyncSnapshot({
      hasPendingWork: false,
      lanes: [],
      pumpActive: false,
    }),
  };

  return {
    beginUploadLane(key: string, options: UploadSyncLaneOptions = {}) {
      return beginUploadLane(coordinatorState, key, options);
    },
    getSnapshot() {
      return coordinatorState.snapshot;
    },
    hasPendingWork() {
      return (
        !!coordinatorState.pump ||
        hasPendingLaneWork(coordinatorState.lanes.values())
      );
    },
    registerLane(key: string, config: SyncLaneConfig): SyncLane {
      const existingLane = coordinatorState.lanes.get(key);
      if (existingLane) {
        existingLane.config = config;
        publishSyncCoordinatorSnapshot(coordinatorState);
        return {
          requestSync: () => requestLaneSync(coordinatorState, existingLane),
        };
      }

      const registeredAt = createSyncTimestamp();
      const nextLane: SyncLaneState = {
        config,
        errorCount: 0,
        key,
        lastAction: "registered",
        lastActionAt: registeredAt,
        lastCompletedAt: null,
        lastError: null,
        lastFailedAt: null,
        lastRequestedAt: null,
        lastStartedAt: null,
        progress: null,
        registrationIndex: coordinatorState.nextRegistrationIndex,
        requestCount: 0,
        requested: false,
        runCount: 0,
        running: false,
      };
      coordinatorState.nextRegistrationIndex += 1;
      coordinatorState.lanes.set(key, nextLane);
      publishSyncCoordinatorSnapshot(coordinatorState);
      return {
        requestSync: () => requestLaneSync(coordinatorState, nextLane),
      };
    },
    subscribe(listener: () => void) {
      coordinatorState.listeners.add(listener);
      return () => {
        coordinatorState.listeners.delete(listener);
      };
    },
    waitForIdle(options?: SyncIdleOptions) {
      return waitForIdleLanes(coordinatorState, options);
    },
  };
}

export function getOrCreateDomainSyncCoordinator(
  domainScope: DomainScope,
): DomainSyncCoordinator {
  const existingCoordinator = coordinatorsByScope.get(domainScope);
  if (existingCoordinator) {
    return existingCoordinator;
  }

  const nextCoordinator = createDomainSyncCoordinator();
  coordinatorsByScope.set(domainScope, nextCoordinator);
  return nextCoordinator;
}

export function hasDomainSyncCoordinatorPendingWork(
  domainScope: DomainScope,
): boolean {
  return coordinatorsByScope.get(domainScope)?.hasPendingWork() ?? false;
}

export function getDomainSyncCoordinatorSnapshot(
  domainScope: DomainScope,
): DomainSyncSnapshot {
  return getOrCreateDomainSyncCoordinator(domainScope).getSnapshot();
}

export function subscribeToDomainSyncCoordinator(
  domainScope: DomainScope,
  listener: () => void,
): () => void {
  return getOrCreateDomainSyncCoordinator(domainScope).subscribe(listener);
}

export function beginDomainSyncUploadLane(
  domainScope: DomainScope,
  key: string,
  options?: UploadSyncLaneOptions,
): UploadSyncLane {
  return getOrCreateDomainSyncCoordinator(domainScope).beginUploadLane(
    key,
    options,
  );
}

export function waitForDomainSyncCoordinatorToSettle(
  domainScope: DomainScope,
  options?: SyncIdleOptions,
): Promise<boolean> {
  return (
    coordinatorsByScope.get(domainScope)?.waitForIdle(options) ??
    Promise.resolve(true)
  );
}

export function didRegainSyncPrerequisites<TRuntime extends SyncRuntimeStatus>(
  previousRuntime: TRuntime,
  nextRuntime: TRuntime,
): boolean {
  return (
    (!previousRuntime.state.online && nextRuntime.state.online) ||
    (!previousRuntime.auth.isAuthenticated &&
      nextRuntime.auth.isAuthenticated) ||
    (!previousRuntime.crypto.encapsulationKeyPair &&
      !!nextRuntime.crypto.encapsulationKeyPair)
  );
}

export function isDestroyedDatabaseClientError(error: unknown): boolean {
  let current = error;

  while (current instanceof Error) {
    const errorMessage = current.message;
    if (
      DESTROYED_DATABASE_CLIENT_MESSAGES.some((message) =>
        errorMessage.includes(message),
      )
    ) {
      return true;
    }

    current = current.cause;
  }

  return false;
}
