import type { DocumentStoreState } from "../state";
import { logRevalidationScheduled } from "./remoteRevalidationTelemetry";
import {
  type StartupProbeEvent,
  transitionStartupProbe,
} from "./startupProbeMachine";
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
 * Moves the store's startup probe through `startupProbeMachine.ts` and runs
 * the probe when the transition says so. The caller schedules the sync lane.
 */
function applyStartupProbeEvent(
  state: DocumentStoreState,
  event: StartupProbeEvent,
): boolean {
  const { arm, state: next } = transitionStartupProbe(
    state.startupProbe,
    event,
  );
  state.startupProbe = next;
  if (arm) armDocumentStoreStartupProbe(state);
  return arm;
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
 * startup probe runs as before. Returns whether it armed.
 */
export function loadDocumentStoreStartupProbe(
  state: DocumentStoreState,
  remote: boolean,
): boolean {
  return applyStartupProbeEvent(state, {
    pendingConnectAttempt:
      state.runtime.state.serverEventsPendingConnectAttempt,
    remote,
    type: "loaded",
  });
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
  const armed = applyStartupProbeEvent(state, {
    pendingConnectAttempt:
      state.runtime.state.serverEventsPendingConnectAttempt,
    reconnected: serverEventsReconnected,
    type: "runtimeInstalled",
  });
  if (armed) scheduleSync();
  return armed;
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
  const armed = applyStartupProbeEvent(state, {
    pendingConnectAttempt:
      state.runtime.state.serverEventsPendingConnectAttempt,
    probeOwed:
      state.initialized &&
      isDocumentStoreRemoteSyncBlocked(state) &&
      Boolean(state.record?.documentId),
    type: "joined",
  });
  if (armed) scheduleSync();
}
