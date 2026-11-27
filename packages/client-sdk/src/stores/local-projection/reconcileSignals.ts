import {
  type ConnectAttemptWait,
  type ConnectAttemptWaitEvent,
  NO_CONNECT_ATTEMPT_WAIT,
  transitionConnectAttemptWait,
} from "../../workflows/shared/connectAttemptWaitMachine";
import type { ContainerContentsStoreRuntime } from "../container-contents";

/**
 * Signals the local projection store raises so the background reconciler
 * (Layer B) knows what to sync. The store never performs remote I/O itself.
 */
export interface LocalProjectionReconcileSignal {
  reason:
    | "hydrated"
    | "active-changed"
    | "connection-acknowledged"
    | "idle-backfill"
    | "owed-discovery"
    | "prerequisites-regained"
    | "remote-containers-added";
  activeContainerId: string | null;
}

export type LocalProjectionReconcileListener = (
  signal: LocalProjectionReconcileSignal,
) => void;

/** What the idle backfill waits to do: queue every known lane. */
const IDLE_BACKFILL = "idle-backfill" as const;

/** The signals a projection raises, and those it holds until it may. */
export interface ReconcileSignalState {
  activeContainerId: string | null;
  reconcileListeners: Set<LocalProjectionReconcileListener>;
  runtime: ContainerContentsStoreRuntime;
  /**
   * A sync-prerequisite regain (auth, connectivity, or key pair) that arrived
   * before the container tree was ready. The signal's reset-and-backfill must
   * not be lost to startup ordering, so it is latched here and flushed once
   * hydration completes.
   */
  pendingPrerequisitesRegained: boolean;
  /**
   * The server acknowledged a socket's interest declaration, which advanced
   * the connection generation, and the catch-up listing it owes has not been
   * requested yet. Latched like a prerequisite regain: the listing needs the
   * hydrated tree to know which lanes to list.
   */
  pendingConnectionAcknowledged: boolean;
  /** The regain's idle backfill, held on a connect attempt in flight. */
  idleBackfill: ConnectAttemptWait<typeof IDLE_BACKFILL>;
  pendingIdleBackfill: boolean;
  /** Lists the lanes an earlier boot left owed: `owedDiscoveryResumeMachine`. */
  pendingOwedDiscovery: boolean;
}

export const INITIAL_IDLE_BACKFILL = NO_CONNECT_ATTEMPT_WAIT;

export function raiseReconcileSignal(
  state: ReconcileSignalState,
  reason: LocalProjectionReconcileSignal["reason"],
): void {
  const signal = { activeContainerId: state.activeContainerId, reason };
  for (const listener of state.reconcileListeners) {
    try {
      listener(signal);
    } catch {
      // Reconciler failures must not break the read path.
    }
  }
}

/**
 * The idle backfill queues every known lane the reconciler has not listed
 * this session. After a regain it would list them before the connect attempt
 * in flight is acknowledged, while that acknowledgement's catch-up decides
 * from its crawl which lanes need a listing at all. So the regain's backfill
 * waits for the attempt (`connectAttemptWaitMachine.ts`). Either way it is
 * raised once the attempt settles: an acknowledgement's catch-up is requested
 * first and takes the queued lanes over, and an attempt that ends without
 * one leaves them to the lane. The backfill also arms the initial document
 * probe, so it is never dropped.
 */
function stepIdleBackfill(
  state: ReconcileSignalState,
  event: ConnectAttemptWaitEvent<typeof IDLE_BACKFILL>,
): void {
  const next = transitionConnectAttemptWait(state.idleBackfill, event);
  if (next.state.status === "yielded" || next.released) {
    state.pendingIdleBackfill = true;
  }
  state.idleBackfill =
    next.state.status === "waiting" ? next.state : NO_CONNECT_ATTEMPT_WAIT;
}

/** Whether a backfill is held, which lists lanes the tree gains meanwhile. */
export function holdsIdleBackfill(state: ReconcileSignalState): boolean {
  return state.idleBackfill.status === "waiting";
}

/** A runtime update: the held backfill's attempt may have settled. */
export function observeIdleBackfill(
  state: ReconcileSignalState,
  acknowledged: boolean,
): void {
  stepIdleBackfill(state, {
    acknowledged,
    pendingConnectAttempt:
      state.runtime.state.serverEventsPendingConnectAttempt,
    type: "observe",
  });
}

/** The projection reset: a held backfill is raised after it hydrates again. */
export function resetIdleBackfill(state: ReconcileSignalState): void {
  stepIdleBackfill(state, { type: "reset" });
}

/**
 * Raises the signals latched while the tree was not ready. A regain resets
 * what the reconciler considers discovered, so it goes first. The listing an
 * acknowledged connection owes comes next, so the regain's backfill, raised
 * behind it, leaves to its catch-up the lanes the crawl can vouch for. A
 * resume of owed lanes is latched by its machine, which drops it when the
 * awaited attempt is acknowledged. One latched before a flush can still
 * flush beside a later acknowledgement, and both may then list the same
 * lanes. The caller flushes only once the tree is published.
 */
export function flushPendingReconcileSignals(
  state: ReconcileSignalState,
): void {
  if (state.pendingPrerequisitesRegained) {
    state.pendingPrerequisitesRegained = false;
    raiseReconcileSignal(state, "prerequisites-regained");
    stepIdleBackfill(state, {
      pendingConnectAttempt:
        state.runtime.state.serverEventsPendingConnectAttempt,
      request: IDLE_BACKFILL,
      type: "hold",
    });
  }
  for (const [pending, reason] of [
    ["pendingConnectionAcknowledged", "connection-acknowledged"],
    ["pendingIdleBackfill", "idle-backfill"],
    ["pendingOwedDiscovery", "owed-discovery"],
  ] as const) {
    if (!state[pending]) continue;
    state[pending] = false;
    raiseReconcileSignal(state, reason);
  }
}
