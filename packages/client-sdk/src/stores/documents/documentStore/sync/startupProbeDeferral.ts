import type { DocumentStoreState } from "../state";
import { logRevalidationScheduled } from "./remoteRevalidationTelemetry";
import {
  allowDocumentStoreRemoteSync,
  isDocumentStoreRemoteSyncBlocked,
  markDocumentStoreRemoteSyncPending,
} from "./syncGeneration";

/**
 * Let the startup probe through and queue it. Initialization, a released
 * deferral, and a joining opener all arm it here; the caller schedules the
 * sync lane.
 */
export function armDocumentStoreStartupProbe(state: DocumentStoreState): void {
  allowDocumentStoreRemoteSync(state);
  markDocumentStoreRemoteSyncPending(state, "independent");
  logRevalidationScheduled(state.runtime, "startup");
}

/**
 * An opened remote document needs one probe after a restart, because no
 * websocket hint survives it. When a server-events connect attempt is in
 * flight, the acknowledgement of its interest declaration advances the
 * connection generation, and that arms a reconnect probe for every open
 * document; a probe sent before it covers strictly less. So the startup probe
 * waits on that attempt instead of running twice. The attempt id scopes the
 * wait: when the attempt ends without an acknowledgement (ticket or socket
 * failure, gateway refusal, sync turned off), the deferred probe runs at once.
 * Without a pending attempt (offline, local-only, between retries), the
 * startup probe runs as before.
 */
export function deferStartupProbeToPendingConnect(
  state: DocumentStoreState,
): boolean {
  const attempt = state.runtime.state.serverEventsPendingConnectAttempt;
  if (attempt === undefined) {
    return false;
  }
  state.startupProbeDeferredAttempt = attempt;
  return true;
}

/**
 * Settle a deferred startup probe against the store's newly installed runtime.
 * An advanced connection generation hands it to the reconnect probe the caller
 * arms; the same attempt still pending keeps waiting; anything else (the
 * attempt ended, or another one started after it ended) means no reconnect
 * probe will cover it, so the probe runs now. Returns whether it armed.
 */
export function settleDeferredStartupProbe(
  state: DocumentStoreState,
  serverEventsReconnected: boolean,
  scheduleSync: () => void,
): boolean {
  const deferred = state.startupProbeDeferredAttempt;
  if (deferred === null) {
    return false;
  }
  if (serverEventsReconnected) {
    state.startupProbeDeferredAttempt = null;
    return false;
  }
  if (state.runtime.state.serverEventsPendingConnectAttempt === deferred) {
    return false;
  }
  state.startupProbeDeferredAttempt = null;
  armDocumentStoreStartupProbe(state);
  scheduleSync();
  return true;
}

/**
 * A later opener that wants the startup probe joins a store an on-demand
 * opener created first, so the first open's mode cannot cancel it for every
 * later view. Before the store loads, initialization runs the probe as though
 * this open came first. Once loaded, the probe it skipped runs now, unless a
 * remote pass was already allowed (a requested sync or a server hint).
 */
export function joinDocumentStoreStartupProbe(
  state: DocumentStoreState,
  scheduleSync: () => void,
): void {
  if (state.scheduleStartupRemoteSync) {
    return;
  }
  state.scheduleStartupRemoteSync = true;
  if (
    !state.initialized ||
    !isDocumentStoreRemoteSyncBlocked(state) ||
    !state.record?.documentId ||
    deferStartupProbeToPendingConnect(state)
  ) {
    return;
  }
  armDocumentStoreStartupProbe(state);
  scheduleSync();
}
