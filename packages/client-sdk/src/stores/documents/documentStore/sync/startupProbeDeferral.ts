import type { DocumentStoreState } from "../state";
import { logRevalidationScheduled } from "./remoteRevalidationTelemetry";
import {
  allowDocumentStoreRemoteSync,
  markDocumentStoreRemoteSyncPending,
} from "./syncGeneration";

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
  allowDocumentStoreRemoteSync(state);
  markDocumentStoreRemoteSyncPending(state, "independent");
  scheduleSync();
  logRevalidationScheduled(state.runtime, "startup");
  return true;
}
