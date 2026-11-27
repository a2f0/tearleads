import {
  type CatchUpState,
  type CatchUpWait,
  defersToCatchUp,
  dispatchCatchUp,
  listedSinceAcknowledgement,
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
import { awaitTreeCrawl, TREE_CRAWL_WAIT_MS } from "./treeCrawlWait";

/**
 * How long deferral outlasts the crawl. A catch-up whose crawl settled and
 * whose turn has not come by then (a sweep ahead of it is stuck on its tree
 * listing) holds no lane back from then on. As long as the crawl's own bound.
 */
export const CATCH_UP_TURN_WAIT_MS = TREE_CRAWL_WAIT_MS;

/**
 * What the catch-up lists when nothing vouches for its lanes: every known
 * lane but one a listing sent after the acknowledgement listed, which that
 * listing vouches for. A lane a hint forced since is listed all the same.
 */
function planUnvouchedCatchUp(
  state: ReconciliationState,
  wait: CatchUpWait,
  known: ReadonlyArray<string>,
): SweepPlan {
  const listedSince = listedSinceAcknowledgement(state.catchUp, wait);
  const lists = (id: string) =>
    !listedSince.has(id) || state.forcedContainerGenerations.has(id);
  return {
    containerIds: known.filter(lists),
    vouchedContainerIds: known.filter((id) => !lists(id)),
  };
}

/**
 * What the catch-up lists once its wait is over. With a complete crawl
 * behind it: the lanes a durable record says are owed a listing, the lanes a
 * hint forced, and an open container the owed record does not cover. The
 * crawl vouches for every other known lane. Without one, or when the owed
 * record cannot be read, only a listing sent since the acknowledgement
 * vouches for a lane, and the catch-up lists every other.
 *
 * The known containers are read once, before the owed record: a container
 * that becomes known while that read is in flight was never tested, so it is
 * neither listed nor vouched for here and stays for the lane to list.
 */
async function planCatchUp(
  host: ReconciliationHost,
  state: ReconciliationState,
  wait: CatchUpWait,
  crawlVouches: boolean,
): Promise<SweepPlan> {
  const reconcilable = host.listKnownContainerIds();
  const known = withOpenContainer(host, state, reconcilable);
  if (!crawlVouches) return planUnvouchedCatchUp(state, wait, known);
  let owed: ReadonlySet<string>;
  try {
    owed = new Set(
      await host.listOwedDocumentDiscoveryContainerIds(reconcilable),
    );
  } catch (error) {
    if (host.isIgnorableError(error)) throw error;
    host.logError?.("Reconciliation: owed lanes could not be read", error);
    return planUnvouchedCatchUp(state, wait, known);
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
 * not served. A crawl whose outcome cannot be read vouches for nothing. An
 * ignorable failure (the database closed) is rethrown: the catch-up then
 * lists nothing, as when `planCatchUp` finds the database closed.
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
    if (host.isIgnorableError(error)) throw error;
    host.logError?.("Reconciliation: tree crawl outcome was not read", error);
    return false;
  }
}

/**
 * Wakes the lane when an entry it holds was deferred by `before` and is not
 * deferred now. A wake that frees nothing could cancel a failed lane's retry
 * backoff.
 */
function wakeLaneForReleased(
  state: ReconciliationState,
  before: CatchUpState,
  containerIds: Iterable<string>,
): void {
  for (const containerId of containerIds) {
    if (
      state.queue.has(containerId) &&
      defersToCatchUp(before, containerId) &&
      !defersToCatchUp(state.catchUp, containerId)
    ) {
      state.lane?.requestSync();
      return;
    }
  }
}

/**
 * Ends the deferral of a catch-up whose turn is overdue: a sweep ahead of it
 * is stuck. What the catch-up held back is the lane's to list.
 */
function releaseOverdueCatchUp(
  state: ReconciliationState,
  wait: CatchUpWait,
): void {
  const before = state.catchUp;
  dispatchCatchUp(state, { type: "turnOverdue", wait });
  wakeLaneForReleased(state, before, wait.knownContainerIds);
}

/** Ends the catch-up and wakes the lane for what it held back. */
function endCatchUp(
  state: ReconciliationState,
  wait: CatchUpWait,
  planned: boolean,
): void {
  dispatchCatchUp(state, { type: "turnTaken", wait });
  wakeLaneForDeferredWork(state, planned);
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
  let crawlVouches: boolean;
  try {
    crawlVouches = await awaitCrawlVerdict(host, stop);
  } catch {
    // The database closed under the wait: nothing can be listed, so no
    // sweep runs, and what the catch-up held back is the lane's again.
    if (!stop.aborted) endCatchUp(state, wait, false);
    return;
  }
  // A stopped service drops the catch-up: its next start resumes owed lanes.
  if (stop.aborted) return;
  dispatchCatchUp(state, { type: "crawlSettled", wait });
  const cancelTurnWait = host.clock.schedule(
    () => releaseOverdueCatchUp(state, wait),
    CATCH_UP_TURN_WAIT_MS,
  );
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
        // The turn has come: a slow read of the plan does not make it
        // overdue, and deferral holds until the plan is in hand.
        cancelTurnWait();
        // The service stopped, or a later acknowledgement superseded this
        // catch-up, while its sweep awaited its turn: its crawl says nothing
        // about the session or the connection that is current now.
        if (stop.aborted) return { containerIds: [] };
        const plan = await planCatchUp(host, state, wait, crawlVouches);
        // Superseded or stopped while the owed record was read.
        return stop.aborted ? { containerIds: [] } : plan;
      },
      // Deferral ends with the plan in hand and the queue entries it covers
      // taken, not before: a lane queued while the owed record is read is
      // the sweep's to list or vouch for.
      onPlanTaken: () => {
        planned = true;
        const before = state.catchUp;
        dispatchCatchUp(state, { type: "turnTaken", wait });
        // What is still queued and was held back is the lane's again. It is
        // woken now, before the sweep can hand back a lane it failed: a
        // request made after that would cancel the failed lane's backoff. A
        // superseded catch-up's turn releases nothing and wakes nothing.
        wakeLaneForReleased(state, before, wait.knownContainerIds);
      },
      scope: "acknowledged",
      signal: undefined,
    });
  } finally {
    cancelTurnWait();
    // A superseded catch-up holds nothing back now: the one that replaced
    // it wakes the lane when it ends, and a stopped service's next start
    // resumes what is owed.
    if (!stop.aborted) endCatchUp(state, wait, planned);
  }
}

/**
 * Wakes the lane for what the catch-up held back: entries it deferred and
 * its sweep did not take, and the initial document probe. A sweep that never
 * read its plan (the device went offline) took nothing, so the lane runs at
 * once. One that did took the queue first, and may have just handed back a
 * lane it failed, which must wait out its retry backoff: an immediate
 * request would cancel that delay.
 */
function wakeLaneForDeferredWork(
  state: ReconciliationState,
  planned: boolean,
): void {
  if (state.queue.size === 0) {
    // The initial probe runs only while the queue is empty, and the lane
    // found it holding deferred entries: nothing else resumes the probe.
    if (state.initialDocumentProbe.hasPendingWork()) state.lane?.requestSync();
    return;
  }
  if (planned) state.lane?.requestSyncAfter(SWEEP_RETRY_BACKOFF_MS);
  else state.lane?.requestSync();
}

/**
 * Stops deferring the lanes that are owed a listing as the acknowledgement
 * arrives: never listed, or holding staged candidates. No crawl can vouch
 * for them, and what they hold, a new device's system documents included,
 * should not wait for one. A failed read leaves them to the sweep. A read
 * that answers after this wait was superseded or stopped releases nothing.
 */
function releaseLanesAlreadyOwed(
  host: ReconciliationHost,
  state: ReconciliationState,
  wait: CatchUpWait,
): void {
  void host
    .listOwedDocumentDiscoveryContainerIds(host.listKnownContainerIds())
    .then(
      (containerIds) => {
        const before = state.catchUp;
        dispatchCatchUp(state, { containerIds, type: "alreadyOwed", wait });
        wakeLaneForReleased(state, before, containerIds);
      },
      (error: unknown) => {
        if (host.isIgnorableError(error)) return;
        host.logError?.(
          "Reconciliation: lanes already owed could not be read",
          error,
        );
      },
    );
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
  if (state.catchUp.status !== "idle") state.catchUp.wait.cancel();
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
  releaseLanesAlreadyOwed(host, state, wait);
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
