import type { DomainScope } from "../domainScope";
import {
  requestAllPumpDrivenLanes,
  requestLaneSync,
  requestLaneSyncAfter,
  type SyncIdleOptions,
  waitForIdleLanes,
} from "./coordinatorPump";
import type {
  DomainSyncCoordinatorState,
  SyncLaneState,
} from "./coordinatorState";
import {
  hasPendingLaneWork,
  publishSyncCoordinatorSnapshot,
} from "./coordinatorState";
import type { SyncLane, SyncLaneConfig } from "./syncLaneConfig";
import type { DomainSyncSnapshot } from "./syncTelemetry";
import { createDomainSyncSnapshot, createSyncTimestamp } from "./syncTelemetry";
import type { UploadSyncLane, UploadSyncLaneOptions } from "./uploadLane";
import { beginUploadLane } from "./uploadLane";

export type { SyncIdleOptions } from "./coordinatorPump";
// Re-exported here because lanes reach it as a shouldIgnoreError alongside the
// rest of the coordinator surface; it lives beside this coordinator with the
// error type it discriminates on.
export { isDatabaseUnavailableError } from "./databaseUnavailable";
export type { SyncLane, SyncLaneConfig } from "./syncLaneConfig";
export {
  didRegainSyncPrerequisites,
  type SyncRuntimeStatus,
} from "./syncPrerequisites";
export type {
  DomainSyncSnapshot,
  SyncLaneLastAction,
  SyncLanePhase,
  SyncLaneProgress,
  SyncLaneSnapshot,
  SyncLaneStatus,
} from "./syncTelemetry";
export type { UploadSyncLane, UploadSyncLaneOptions } from "./uploadLane";

export interface DomainSyncCoordinator {
  beginUploadLane: (
    key: string,
    options?: UploadSyncLaneOptions,
  ) => UploadSyncLane;
  // Force-stop the pump, drop all queued lane work, and refuse further runs.
  dispose: () => void;
  getSnapshot: () => DomainSyncSnapshot;
  registerLane: (key: string, config: SyncLaneConfig) => SyncLane;
  // Re-request every pump-driven lane — a manual "sync now" that re-drives
  // durable owners stranded by a transient failure. Observational upload rows
  // are updated only by those owners' real attachment upload attempts.
  requestAllLanes: () => void;
  // Request one registered pump lane without re-driving unrelated owners.
  requestLane: (key: string) => void;
  hasPendingWork: () => boolean;
  subscribe: (listener: () => void) => () => void;
  waitForIdle: (options?: SyncIdleOptions) => Promise<boolean>;
}

const coordinatorsByScope = new WeakMap<DomainScope, DomainSyncCoordinator>();

function createSyncLaneHandle(
  coordinatorState: DomainSyncCoordinatorState,
  lane: SyncLaneState,
): SyncLane {
  return {
    requestSync: () => requestLaneSync(coordinatorState, lane),
    requestSyncAfter: (delayMs) =>
      requestLaneSyncAfter(coordinatorState, lane, delayMs),
  };
}

function createDomainSyncCoordinator(): DomainSyncCoordinator {
  const coordinatorState: DomainSyncCoordinatorState = {
    disposed: false,
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
    dispose() {
      coordinatorState.disposed = true;
      // Drop queued work so waitForIdle reports settled immediately and a
      // lane left re-requested by an in-flight run does not survive teardown.
      for (const lane of coordinatorState.lanes.values()) {
        lane.requested = false;
        lane.notBeforeAtMs = null;
      }
      // Publish the final settled snapshot, then release listener closures:
      // the coordinator is dropped from the registry and a remount subscribes
      // to a fresh one.
      publishSyncCoordinatorSnapshot(coordinatorState);
      coordinatorState.listeners.clear();
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
        existingLane.blobStorageKey = null;
        existingLane.pumpDriven = true;
        publishSyncCoordinatorSnapshot(coordinatorState);
        return createSyncLaneHandle(coordinatorState, existingLane);
      }

      const registeredAt = createSyncTimestamp();
      const nextLane: SyncLaneState = {
        activeRunToken: null,
        blobStorageKey: null,
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
        notBeforeAtMs: null,
        progress: null,
        pumpDriven: true,
        registrationIndex: coordinatorState.nextRegistrationIndex,
        requestCount: 0,
        requested: false,
        runCount: 0,
        running: false,
      };
      coordinatorState.nextRegistrationIndex += 1;
      coordinatorState.lanes.set(key, nextLane);
      publishSyncCoordinatorSnapshot(coordinatorState);
      return createSyncLaneHandle(coordinatorState, nextLane);
    },
    requestAllLanes() {
      requestAllPumpDrivenLanes(coordinatorState);
    },
    requestLane(key: string) {
      const lane = coordinatorState.lanes.get(key);
      if (lane?.pumpDriven) {
        requestLaneSync(coordinatorState, lane);
      }
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

// Re-request every pump-driven lane for a scope: a user-driven "sync now" that
// retries durable work stranded by a transient failure. Observational upload
// telemetry is never directly pumped. A no-op when no coordinator exists yet
// (nothing has been synced) or it has been disposed.
export function requestAllDomainSyncLanes(domainScope: DomainScope): void {
  coordinatorsByScope.get(domainScope)?.requestAllLanes();
}

export function requestDomainSyncLane(
  domainScope: DomainScope,
  key: string,
): void {
  coordinatorsByScope.get(domainScope)?.requestLane(key);
}

// Force-stop the coordinator for a scope and drop it from the registry, so a
// pump cannot outlive the runtime/React tree that created it. A later
// getOrCreate for the same scope builds a fresh coordinator.
export function disposeDomainSyncCoordinator(domainScope: DomainScope): void {
  const coordinator = coordinatorsByScope.get(domainScope);
  if (!coordinator) {
    return;
  }

  coordinator.dispose();
  coordinatorsByScope.delete(domainScope);
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
