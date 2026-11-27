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
 * A lane whose listing was sent after the acknowledgement read everything
 * the crawl could say about it, so the catch-up keeps those lanes: when
 * nothing vouches for the rest, its sweep lists every known lane but them.
 * An acknowledgement the wait shares starts that record again: a listing
 * sent before it may have missed a write made while the socket was down,
 * so it counts only when no acknowledgement arrived after it was sent.
 *
 * | State | Event | Next |
 * | --- | --- | --- |
 * | idle | acknowledged | awaitingCrawl, with that wait and nothing listed |
 * | awaitingCrawl | acknowledged | the same wait, serving both, with nothing listed since |
 * | awaitingTurn, overdue | acknowledged | awaitingCrawl, with the new wait and nothing listed |
 * | awaitingCrawl | crawlSettled, the same wait | awaitingTurn |
 * | awaitingTurn | turnOverdue, the same wait | overdue |
 * | awaitingCrawl, awaitingTurn | opened | the same, with that container listed now |
 * | awaitingCrawl, awaitingTurn | alreadyOwed, the same wait | the same, with those lanes listed now |
 * | awaitingCrawl, awaitingTurn, overdue | listed, the same wait and acknowledgement | the same, with those lanes listed since |
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

interface CatchUpListings {
  /**
   * How many acknowledgements the wait serves. A listing counts for the
   * catch-up only when it was sent after the latest of them.
   */
  readonly acknowledgements: number;
  /**
   * Containers whose document lane a listing sent after the acknowledgement
   * listed. Nothing a crawl could say about them is newer than that listing.
   */
  readonly listedSinceContainerIds: ReadonlySet<string>;
  readonly wait: CatchUpWait;
}

export type CatchUpState =
  | { readonly status: "idle" }
  | (CatchUpListings & {
      /**
       * Containers whose unforced listing does not wait: the user opened
       * them since the acknowledgement, or their lane was already owed a
       * listing when it arrived.
       */
      readonly listedNowContainerIds: ReadonlySet<string>;
      readonly status: "awaitingCrawl" | "awaitingTurn";
    })
  | (CatchUpListings & {
      /** The crawl settled and the turn is overdue: nothing waits for it. */
      readonly status: "overdue";
    });

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
  | {
      /** The wait's acknowledgements when the listing was sent. */
      readonly acknowledgements: number;
      readonly containerIds: ReadonlyArray<string>;
      readonly type: "listed";
      readonly wait: CatchUpWait;
    }
  | { readonly type: "turnTaken"; readonly wait: CatchUpWait }
  | { readonly type: "stopped" };

export const IDLE_CATCH_UP: CatchUpState = { status: "idle" };

function afterAcknowledged(
  state: CatchUpState,
  wait: CatchUpWait,
): CatchUpState {
  if (state.status === "awaitingCrawl") {
    return {
      ...state,
      acknowledgements: state.acknowledgements + 1,
      listedSinceContainerIds: new Set(),
    };
  }
  return {
    acknowledgements: 1,
    listedNowContainerIds: new Set(),
    listedSinceContainerIds: new Set(),
    status: "awaitingCrawl",
    wait,
  };
}

/** Adds `containerIds` to `existing`, or keeps it when it holds them all. */
function withAll(
  existing: ReadonlySet<string>,
  containerIds: ReadonlyArray<string>,
): ReadonlySet<string> {
  return containerIds.every((id) => existing.has(id))
    ? existing
    : new Set([...existing, ...containerIds]);
}

type ListingCatchUp = Exclude<CatchUpState, { readonly status: "idle" }>;

function listedSince(
  state: ListingCatchUp,
  containerIds: ReadonlyArray<string>,
): CatchUpState {
  const listed = withAll(state.listedSinceContainerIds, containerIds);
  return listed === state.listedSinceContainerIds
    ? state
    : { ...state, listedSinceContainerIds: listed };
}

type PendingCatchUp = Extract<
  CatchUpState,
  { readonly status: "awaitingCrawl" | "awaitingTurn" }
>;

function listingNow(
  state: PendingCatchUp,
  containerIds: ReadonlyArray<string>,
): PendingCatchUp {
  const listed = withAll(state.listedNowContainerIds, containerIds);
  return listed === state.listedNowContainerIds
    ? state
    : { ...state, listedNowContainerIds: listed };
}

/** A wait in progress: what its crawl, its turn and the user do to it. */
function transitionPending(
  state: PendingCatchUp,
  event: Exclude<
    CatchUpEvent,
    { readonly type: "acknowledged" | "listed" | "stopped" | "turnTaken" }
  >,
): CatchUpState {
  switch (event.type) {
    case "crawlSettled":
      return state.status === "awaitingCrawl" && state.wait === event.wait
        ? { ...state, status: "awaitingTurn" }
        : state;
    case "turnOverdue":
      return state.status === "awaitingTurn" && state.wait === event.wait
        ? {
            acknowledgements: state.acknowledgements,
            listedSinceContainerIds: state.listedSinceContainerIds,
            status: "overdue",
            wait: state.wait,
          }
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
  if (event.type === "listed") {
    return state.wait === event.wait &&
      state.acknowledgements === event.acknowledgements
      ? listedSince(state, event.containerIds)
      : state;
  }
  // Nothing waits for an overdue catch-up: only its turn, a listing, an
  // acknowledgement or a stop moves it.
  if (state.status === "overdue") return state;
  return transitionPending(state, event);
}

/** The one place the catch-up's state is written. */
export function dispatchCatchUp(
  state: { catchUp: CatchUpState },
  event: CatchUpEvent,
): void {
  state.catchUp = transitionCatchUp(state.catchUp, event);
}

/**
 * The containers listed since `wait`'s acknowledgement, while `wait` is the
 * current catch-up's.
 */
export function listedSinceAcknowledgement(
  state: CatchUpState,
  wait: CatchUpWait,
): ReadonlySet<string> {
  return state.status !== "idle" && state.wait === wait
    ? state.listedSinceContainerIds
    : new Set();
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
