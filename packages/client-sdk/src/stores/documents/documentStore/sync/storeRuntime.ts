import {
  createDocumentProjectionUserKeyResolver,
  didDocumentProjectionKeyRuntimeChange,
  didRegainSyncPrerequisites,
} from "../../../../workflows/documents";
import type { DocumentsRuntime } from "../../types";
import { ensureDocumentStoreInitialized } from "../initialization";
import {
  type DocumentStoreState,
  refreshAttachabilitySnapshot,
  resetDocumentStore,
} from "../state";
import { registerDocumentStoreSyncLane } from "./index";
import {
  isDocumentStoreCoveredByListing,
  observeDocumentListingHints,
} from "./listingCoverage";
import { logRevalidationScheduled } from "./remoteRevalidationTelemetry";
import { settleDeferredStartupProbe } from "./startupProbeDeferral";
import {
  allowDocumentStoreRemoteSync,
  captureDocumentStoreSyncLaneGeneration,
  type DocumentStoreSyncLaneGeneration,
  invalidateDocumentStoreSyncLane,
  markDocumentStoreRemoteSyncPending,
} from "./syncGeneration";
import { handleDocumentRemoteEvents } from "./syncRemoteSignals";

/**
 * How a backing store follows its runtime: its sync lane, its hints, and the
 * remote probe a new connection owes it.
 */

export function refreshDocumentStoreSyncLane(
  state: DocumentStoreState,
  force = false,
): void {
  if (!force && state.syncLane && !state.syncLane.isDisposed?.()) {
    return;
  }
  if (state.syncLane) {
    invalidateDocumentStoreSyncLane(state);
  }
  let syncLaneGeneration: DocumentStoreSyncLaneGeneration | null = null;
  state.syncLane = registerDocumentStoreSyncLane(
    state,
    () => syncLaneGeneration,
  );
  syncLaneGeneration = captureDocumentStoreSyncLaneGeneration(state);
}

export function updateDocumentStoreRuntime(
  state: DocumentStoreState,
  nextRuntime: DocumentsRuntime,
  scheduleSync: () => void,
) {
  const previousRuntime = state.runtime;
  const serverEventsReconnected =
    (nextRuntime.state.serverEventsConnectionGeneration ?? 0) >
    (previousRuntime.state.serverEventsConnectionGeneration ?? 0);
  const domainScopeChanged =
    previousRuntime.state.domainScope !== nextRuntime.state.domainScope;
  const projectionKeyRuntimeChanged = didDocumentProjectionKeyRuntimeChange(
    previousRuntime,
    nextRuntime,
  );
  if (projectionKeyRuntimeChanged) {
    state.resolveProjectionUserKey =
      createDocumentProjectionUserKeyResolver(nextRuntime);
    state.writerProjection = null;
  }
  state.runtime = nextRuntime;
  // A store reads hints only once its record has loaded; its load asks
  // whether one named the document meanwhile.
  observeDocumentListingHints(state);
  refreshDocumentStoreSyncLane(state, domainScopeChanged);
  if (domainScopeChanged) {
    state.locallyAcceptedUpdateIds = new Set();
    state.remoteUpdatePending = false;
    state.writerProjection = null;
  }

  if (nextRuntime.infra.dbStatus !== "ready") {
    if (state.snapshot.ready || state.initialized || state.initializePromise) {
      resetDocumentStore(state);
    }
    state.lastEventCount = nextRuntime.state.events.length;
    return;
  }

  refreshAttachabilitySnapshot(state);
  ensureDocumentStoreInitialized(state, scheduleSync);
  handleDocumentRemoteEvents(state, scheduleSync);

  if (state.snapshot.ready) {
    settleReadyStoreConnection(state, scheduleSync, {
      regainedSyncPrerequisites: didRegainSyncPrerequisites(
        previousRuntime,
        state.runtime,
      ),
      serverEventsReconnected,
    });
  }
}

/** What a loaded store owes its newly installed runtime's connection. */
function settleReadyStoreConnection(
  state: DocumentStoreState,
  scheduleSync: () => void,
  connection: {
    readonly regainedSyncPrerequisites: boolean;
    readonly serverEventsReconnected: boolean;
  },
): void {
  const { serverEventsReconnected } = connection;
  // A startup probe that waited on this attempt is handed to the reconnect
  // probe below, whatever a listing says about the record by now.
  const deferredStartupProbe = state.startupProbe.status === "deferred";
  settleDeferredStartupProbe(state, serverEventsReconnected, scheduleSync);
  if (
    serverEventsReconnected &&
    (deferredStartupProbe || !isDocumentStoreCoveredByListing(state))
  ) {
    // The invalidation stream is lossy while disconnected. Once the server
    // has acknowledged this socket's authoritative interest declaration, an
    // already-open remote document needs one HTTP probe to cover peer writes
    // made during the gap, unless a container listing covers it: the scope
    // lists its lane after the same acknowledgement and owes the document a
    // read if it moved. This also closes iOS background/resume reconnects
    // where the native network source remained online throughout.
    requestRemoteDocumentStoreSync(state, scheduleSync);
    logRevalidationScheduled(state.runtime, "reconnect");
  } else if (serverEventsReconnected || connection.regainedSyncPrerequisites) {
    scheduleSync();
  }
}

export function requestRemoteDocumentStoreSync(
  state: DocumentStoreState,
  scheduleSync: () => void,
  owner: "independent" | "waiter" = "independent",
): number {
  allowDocumentStoreRemoteSync(state);
  const signalSequence = markDocumentStoreRemoteSyncPending(state, owner);
  scheduleSync();
  return signalSequence;
}
