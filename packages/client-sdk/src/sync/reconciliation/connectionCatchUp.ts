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
    host.logError?.("Reconciliation: tree crawl outcome was not read", error);
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
  try {
    await requestContainerRefresh({
      // It never joins a sweep that already started: that one may have
      // listed before the acknowledgement.
      freshListing: true,
      host,
      state,
      // The container store lists the tree itself on the acknowledgement.
      refreshTree: () => Promise.resolve(),
      // The sweep has taken the queue over by the time it reads its plan.
      planSweep: () => {
        dispatchCatchUp(state, { type: "turnTaken", wait });
        return planCatchUp(host, state, crawlVouches);
      },
      scope: "acknowledged",
      signal: undefined,
    });
  } finally {
    // A sweep that never read its plan (the device went offline, or the
    // plan could not be read) took nothing over: the catch-up is over all
    // the same, and what it deferred is the lane's again.
    dispatchCatchUp(state, { type: "turnTaken", wait });
    if (state.queue.size > 0) state.lane?.requestSync();
  }
}

/**
 * Catches up after an acknowledged connection; see `catchUpMachine.ts`. An
 * acknowledgement that arrives while a catch-up still waits on its crawl
 * shares that wait: the crawl it waits on is the newest one owed.
 */
export function requestAcknowledgedConnectionSweep(
  host: ReconciliationHost,
  state: ReconciliationState,
): Promise<void> {
  if (state.catchUp.status === "awaitingCrawl") {
    return state.catchUp.wait.promise;
  }
  const stop = new AbortController();
  // The wait names its own promise, so the work starts once it exists.
  let start: () => void = () => undefined;
  const started = new Promise<void>((resolve) => {
    start = resolve;
  });
  const wait: CatchUpWait = {
    cancel: () => stop.abort(),
    knownContainerIds: new Set(listFullRefreshContainerIds(host, state)),
    promise: reportUnawaitedSweep(
      host,
      started.then(() => catchUpAfterCrawl(host, state, wait, stop.signal)),
      "Reconciliation: connection catch-up failed",
    ),
  };
  dispatchCatchUp(state, { type: "acknowledged", wait });
  start();
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
