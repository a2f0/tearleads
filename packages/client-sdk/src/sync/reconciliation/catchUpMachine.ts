/**
 * Where the catch-up after an acknowledged connection stands.
 *
 * The acknowledgement owes a tree crawl, and that crawl says which document
 * lanes moved. Until it settles, nothing says whether an unforced lane needs
 * a listing, so that work is deferred instead of sent:
 *
 * - the lane runner leaves their unforced queue entries queued;
 * - a root sweep skips them.
 *
 * That holds for the lanes known at the acknowledgement. A lane found since
 * was never listed, so the crawl cannot vouch for it and it is not deferred.
 *
 * A hint's forced entry is not deferred. Neither is a container the user
 * opens meanwhile, whose documents are on screen, nor a lane that was already
 * owed a listing when the acknowledgement arrived: the crawl cannot vouch
 * for that one, so waiting for it would only delay the listing. The wait
 * takes no turn among the sweeps, so a root or full refresh runs beside it.
 * Once the crawl has settled the catch-up asks for a turn, and when the turn
 * comes its sweep takes the queue over and lists the owed lanes, or every
 * known lane when nothing vouched for the rest. Work stays deferred until
 * that turn: a sweep ahead of it in line would otherwise list lanes it is
 * about to vouch for. A turn that does not come within a bound (a sweep
 * ahead of it is stuck on its tree listing) makes the catch-up overdue, and
 * nothing waits for it from then on; its sweep still runs when its turn
 * comes.
 *
 * | State | Event | Next |
 * | --- | --- | --- |
 * | idle | acknowledged | awaitingCrawl, with that wait and nothing listed now |
 * | awaitingCrawl | acknowledged | unchanged: the wait in progress serves both |
 * | awaitingTurn, overdue | acknowledged | awaitingCrawl, with the new wait and nothing listed now |
 * | awaitingCrawl | crawlSettled, the same wait | awaitingTurn |
 * | awaitingTurn | turnOverdue, the same wait | overdue |
 * | awaitingCrawl, awaitingTurn | opened | the same, with that container listed now |
 * | awaitingCrawl, awaitingTurn | alreadyOwed, the same wait | the same, with those lanes listed now |
 * | awaitingCrawl, awaitingTurn, overdue | turnTaken, the same wait | idle |
 * | any | stopped | idle |
 *
 * Every other pair leaves the state unchanged. An acknowledgement while a
 * catch-up awaits its turn starts a wait of its own: that catch-up's crawl
 * settled before this acknowledgement, so it says nothing about what moved
 * since, and neither does what it listed at once. The caller cancels the
 * earlier wait, whose sweep then lists and vouches for nothing; its
 * `turnTaken` names an older wait and changes nothing here.
 */
export interface CatchUpWait {
  /** Ends the wait at once, as when the service stops. */
  readonly cancel: () => void;
  /** The containers known when the connection was acknowledged. */
  readonly knownContainerIds: ReadonlySet<string>;
  /** Settles when the catch-up this wait leads to has finished. */
  readonly promise: Promise<void>;
}

export type CatchUpState =
  | { readonly status: "idle" }
  | {
      /**
       * Containers whose unforced listing does not wait: the user opened
       * them since the acknowledgement, or their lane was already owed a
       * listing when it arrived.
       */
      readonly listedNowContainerIds: ReadonlySet<string>;
      readonly status: "awaitingCrawl" | "awaitingTurn";
      readonly wait: CatchUpWait;
    }
  | {
      /** The crawl settled and the turn is overdue: nothing waits for it. */
      readonly status: "overdue";
      readonly wait: CatchUpWait;
    };

export type CatchUpEvent =
  | { readonly type: "acknowledged"; readonly wait: CatchUpWait }
  | { readonly type: "crawlSettled"; readonly wait: CatchUpWait }
  | { readonly type: "turnOverdue"; readonly wait: CatchUpWait }
  | { readonly containerId: string; readonly type: "opened" }
  | {
      readonly containerIds: ReadonlyArray<string>;
      readonly type: "alreadyOwed";
      readonly wait: CatchUpWait;
    }
  | { readonly type: "turnTaken"; readonly wait: CatchUpWait }
  | { readonly type: "stopped" };

export const IDLE_CATCH_UP: CatchUpState = { status: "idle" };

function afterAcknowledged(
  state: CatchUpState,
  wait: CatchUpWait,
): CatchUpState {
  if (state.status === "awaitingCrawl") return state;
  return { listedNowContainerIds: new Set(), status: "awaitingCrawl", wait };
}

type PendingCatchUp = Extract<
  CatchUpState,
  { readonly status: "awaitingCrawl" | "awaitingTurn" }
>;

function listingNow(
  state: PendingCatchUp,
  containerIds: ReadonlyArray<string>,
): PendingCatchUp {
  if (containerIds.every((id) => state.listedNowContainerIds.has(id))) {
    return state;
  }
  return {
    ...state,
    listedNowContainerIds: new Set([
      ...state.listedNowContainerIds,
      ...containerIds,
    ]),
  };
}

/** A wait in progress: what its crawl, its turn and the user do to it. */
function transitionPending(
  state: PendingCatchUp,
  event: Exclude<
    CatchUpEvent,
    { readonly type: "acknowledged" | "stopped" | "turnTaken" }
  >,
): CatchUpState {
  switch (event.type) {
    case "crawlSettled":
      return state.status === "awaitingCrawl" && state.wait === event.wait
        ? { ...state, status: "awaitingTurn" }
        : state;
    case "turnOverdue":
      return state.status === "awaitingTurn" && state.wait === event.wait
        ? { status: "overdue", wait: state.wait }
        : state;
    case "opened":
      return listingNow(state, [event.containerId]);
    case "alreadyOwed":
      return state.wait === event.wait
        ? listingNow(state, event.containerIds)
        : state;
  }
}

export function transitionCatchUp(
  state: CatchUpState,
  event: CatchUpEvent,
): CatchUpState {
  if (event.type === "stopped") return IDLE_CATCH_UP;
  if (event.type === "acknowledged") {
    return afterAcknowledged(state, event.wait);
  }
  if (state.status === "idle") return state;
  if (event.type === "turnTaken") {
    return state.wait === event.wait ? IDLE_CATCH_UP : state;
  }
  // Nothing waits for an overdue catch-up: only its turn, an
  // acknowledgement or a stop moves it.
  if (state.status === "overdue") return state;
  return transitionPending(state, event);
}

/**
 * Whether an unforced listing of `containerId` waits for the catch-up, in
 * the lane's queue or in a root sweep. Only a lane that was known at the
 * acknowledgement waits: the crawl is what says whether such a lane moved. A
 * lane found since was never listed, so no crawl can vouch for it, and it is
 * listed at once, as a new device's folders are while it boots. Nothing
 * waits for a catch-up whose turn is overdue.
 */
export function defersToCatchUp(
  state: CatchUpState,
  containerId: string,
): boolean {
  return (
    (state.status === "awaitingCrawl" || state.status === "awaitingTurn") &&
    !state.listedNowContainerIds.has(containerId) &&
    state.wait.knownContainerIds.has(containerId)
  );
}
