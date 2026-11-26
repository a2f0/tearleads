import {
  type CatchUpEvent,
  type CatchUpWait,
  transitionCatchUp,
} from "./catchUpMachine";
import {
  listFullRefreshContainerIds,
  requestContainerRefresh,
  type SweepPlan,
  withOpenContainer,
} from "./containerRefresh";
import { SWEEP_RETRY_BACKOFF_MS } from "./laneFailure";
import type { ReconciliationState } from "./serviceState";
import type { ReconciliationHost } from "./serviceTypes";
import { awaitTreeCrawl } from "./treeCrawlWait";

/**
 * What the catch-up lists once its wait is over. With a complete crawl
 * behind it: the lanes a durable record says are owed a listing, the lanes a
 * hint forced, and an open container the owed record does not cover. The
 * crawl vouches for every other known lane. Without one, or when the owed
 * record cannot be read, nothing vouches for any lane and it lists them all.
 *
 * The known containers are read once, before the owed record: a container
 * that becomes known while that read is in flight was never tested, so it is
 * neither listed nor vouched for here and stays for the lane to list.
 */
async function planCatchUp(
  host: ReconciliationHost,
  state: ReconciliationState,
  crawlVouches: boolean,
): Promise<SweepPlan> {
  const reconcilable = host.listKnownContainerIds();
  const known = withOpenContainer(host, state, reconcilable);
  if (!crawlVouches) return { containerIds: known };
  let owed: ReadonlySet<string>;
  try {
    owed = new Set(
      await host.listOwedDocumentDiscoveryContainerIds(reconcilable),
    );
  } catch (error) {
    if (host.isIgnorableError(error)) throw error;
    host.logError?.("Reconciliation: owed lanes could not be read", error);
    return { containerIds: known };
  }
  // The owed record covers the containers the reconciler lists in the
  // background. An open container outside them is listed here and nowhere
  // else, so nothing says whether it is owed: it is always listed.
  const covered = new Set(reconcilable);
  const lists = (id: string) =>
    owed.has(id) ||
    !covered.has(id) ||
    state.forcedContainerGenerations.has(id);
  return {
    containerIds: known.filter(lists),
    vouchedContainerIds: known.filter((id) => !lists(id)),
  };
}

/** The one place the catch-up's state is written. */
export function dispatchCatchUp(
  state: ReconciliationState,
  event: CatchUpEvent,
): void {
  state.catchUp = transitionCatchUp(state.catchUp, event);
}

/** Reports a sweep nothing awaits; an ignorable failure never reaches it. */
function reportUnawaitedSweep(
  host: ReconciliationHost,
  sweep: Promise<void>,
  message: string,
): Promise<void> {
  sweep.catch((error: unknown) => host.logError?.(message, error));
  return sweep;
}

/**
 * Whether the crawl the acknowledgement owes vouches for the lanes it was
 * not served. A crawl whose outcome cannot be read vouches for nothing.
 */
async function awaitCrawlVerdict(
  host: ReconciliationHost,
  stop: AbortSignal,
): Promise<boolean> {
  try {
    return await awaitTreeCrawl(
      host.whenTreeCrawlSettles?.(),
      stop,
      host.clock,
    );
  } catch (error) {
    if (!host.isIgnorableError(error)) {
      host.logError?.("Reconciliation: tree crawl outcome was not read", error);
    }
    return false;
  }
}

/**
 * Waits for the tree crawl the acknowledgement owes, then takes a turn among
 * the sweeps and lists what `planCatchUp` says. The wait itself takes no
 * turn: a root or full refresh requested meanwhile runs beside it.
 */
async function catchUpAfterCrawl(
  host: ReconciliationHost,
  state: ReconciliationState,
  wait: CatchUpWait,
  stop: AbortSignal,
): Promise<void> {
  const crawlVouches = await awaitCrawlVerdict(host, stop);
  // A stopped service drops the catch-up: its next start resumes owed lanes.
  if (stop.aborted) return;
  dispatchCatchUp(state, { type: "crawlSettled", wait });
  let planned = false;
  try {
    await requestContainerRefresh({
      // It never joins a sweep that already started: that one may have
      // listed before the acknowledgement.
      freshListing: true,
      host,
      state,
      // The container store lists the tree itself on the acknowledgement.
      refreshTree: () => Promise.resolve(),
      planSweep: async () => {
        // The service stopped, or a later acknowledgement superseded this
        // catch-up, while its sweep awaited its turn: its crawl says nothing
        // about the session or the connection that is current now.
        if (stop.aborted) return { containerIds: [] };
        try {
          const plan = await planCatchUp(host, state, crawlVouches);
          // Superseded or stopped while the owed record was read.
          return stop.aborted ? { containerIds: [] } : plan;
        } finally {
          // Deferral ends with the plan in hand, not before: a lane queued
          // while the owed record is read is the sweep's to list or vouch
          // for. The sweep marks its lanes before the lane can run again.
          planned = true;
          dispatchCatchUp(state, { type: "turnTaken", wait });
        }
      },
      scope: "acknowledged",
      signal: undefined,
    });
  } finally {
    dispatchCatchUp(state, { type: "turnTaken", wait });
    wakeLaneForDeferredWork(state, planned);
  }
}

/**
 * Wakes the lane for what the catch-up held back: entries it deferred and
 * its sweep did not take, and the initial document probe. A sweep that never read its plan (the device went offline) took
 * nothing, so the lane runs at once. One that did took the queue first, and
 * may have just handed back a lane it failed, which must wait out its retry
 * backoff: an immediate request would cancel that delay.
 */
function wakeLaneForDeferredWork(
  state: ReconciliationState,
  planned: boolean,
): void {
  if (state.queue.size === 0) {
    // The initial probe continues only while the queue is empty, and the
    // lane found it holding deferred entries: nothing else resumes it.
    if (state.initialDocumentProbe.hasPendingWork()) state.lane?.requestSync();
    return;
  }
  if (planned) state.lane?.requestSyncAfter(SWEEP_RETRY_BACKOFF_MS);
  else state.lane?.requestSync();
}

/**
 * Catches up after an acknowledged connection; see `catchUpMachine.ts`. An
 * acknowledgement that arrives while a catch-up still waits on its crawl
 * shares that wait: the crawl it waits on is the newest one owed. One that
 * arrives after that crawl settled supersedes the catch-up, so at most one
 * catch-up ever plans a sweep from a crawl's verdict.
 */
export function requestAcknowledgedConnectionSweep(
  host: ReconciliationHost,
  state: ReconciliationState,
): Promise<void> {
  if (state.catchUp.status === "awaitingCrawl") {
    return state.catchUp.wait.promise;
  }
  // A catch-up still awaiting its turn is superseded: its crawl settled
  // before this acknowledgement, so its verdict is about an earlier
  // connection. Its sweep lists and vouches for nothing when its turn comes.
  if (state.catchUp.status === "awaitingTurn") state.catchUp.wait.cancel();
  const stop = new AbortController();
  const wait: CatchUpWait = {
    cancel: () => stop.abort(),
    knownContainerIds: new Set(listFullRefreshContainerIds(host, state)),
    // The callback runs after `wait` exists and the acknowledgement below
    // has been dispatched.
    promise: reportUnawaitedSweep(
      host,
      Promise.resolve().then(() =>
        catchUpAfterCrawl(host, state, wait, stop.signal),
      ),
      "Reconciliation: connection catch-up failed",
    ),
  };
  dispatchCatchUp(state, { type: "acknowledged", wait });
  return wait.promise;
}

/**
 * Stops a catch-up that has not taken its turn. The service calls it when it
 * stops.
 */
export function stopCatchUp(state: ReconciliationState): void {
  const { catchUp } = state;
  dispatchCatchUp(state, { type: "stopped" });
  if (catchUp.status !== "idle") catchUp.wait.cancel();
}
