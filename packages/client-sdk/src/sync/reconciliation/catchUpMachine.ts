/**
 * Where the catch-up after an acknowledged connection stands.
 *
 * The acknowledgement owes a tree crawl, and that crawl says which document
 * lanes moved. Until it settles, nothing says whether an unforced lane needs
 * a listing, so that work is deferred instead of sent:
 *
 * - the lane runner leaves unforced queue entries queued;
 * - a root sweep skips unforced lanes that were known at the
 *   acknowledgement.
 *
 * A hint's forced entry is not deferred, and neither is a container the user
 * opens meanwhile: its documents are on screen. The wait takes no turn among
 * the sweeps, so a root or full refresh runs beside it. Once the crawl has
 * settled the catch-up asks for a turn, and when the turn comes its sweep
 * takes the queue over and lists the owed lanes, or every known lane when
 * nothing vouched for the rest. Work stays deferred until that turn: a sweep
 * ahead of it in line would otherwise list lanes it is about to vouch for.
 *
 * | State | Event | Next |
 * | --- | --- | --- |
 * | idle | acknowledged | awaitingCrawl, with that wait and nothing opened |
 * | awaitingCrawl | acknowledged | unchanged: the wait in progress serves both |
 * | awaitingTurn | acknowledged | awaitingCrawl, with the new wait |
 * | awaitingCrawl | crawlSettled, the same wait | awaitingTurn |
 * | awaitingCrawl, awaitingTurn | opened | the same, with that container opened |
 * | awaitingCrawl, awaitingTurn | turnTaken, the same wait | idle |
 * | any | stopped | idle |
 *
 * Every other pair leaves the state unchanged. An acknowledgement while a
 * catch-up awaits its turn starts a wait of its own: that catch-up's crawl
 * settled before this acknowledgement, so it says nothing about what moved
 * since. The earlier catch-up still takes its turn; its `turnTaken` names an
 * older wait and changes nothing.
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
      /** Containers the user opened since the acknowledgement. */
      readonly openedContainerIds: ReadonlySet<string>;
      readonly status: "awaitingCrawl" | "awaitingTurn";
      readonly wait: CatchUpWait;
    };

export type CatchUpEvent =
  | { readonly type: "acknowledged"; readonly wait: CatchUpWait }
  | { readonly type: "crawlSettled"; readonly wait: CatchUpWait }
  | { readonly containerId: string; readonly type: "opened" }
  | { readonly type: "turnTaken"; readonly wait: CatchUpWait }
  | { readonly type: "stopped" };

export const IDLE_CATCH_UP: CatchUpState = { status: "idle" };

function afterAcknowledged(
  state: CatchUpState,
  wait: CatchUpWait,
): CatchUpState {
  if (state.status === "awaitingCrawl") return state;
  return {
    openedContainerIds:
      state.status === "idle" ? new Set() : state.openedContainerIds,
    status: "awaitingCrawl",
    wait,
  };
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
  switch (event.type) {
    case "crawlSettled":
      return state.status === "awaitingCrawl" && state.wait === event.wait
        ? { ...state, status: "awaitingTurn" }
        : state;
    case "opened":
      return state.openedContainerIds.has(event.containerId)
        ? state
        : {
            ...state,
            openedContainerIds: new Set([
              ...state.openedContainerIds,
              event.containerId,
            ]),
          };
    case "turnTaken":
      return state.wait === event.wait ? IDLE_CATCH_UP : state;
  }
}

/**
 * Whether an unforced queue entry for `containerId` waits for the catch-up:
 * its sweep takes the queue over once the crawl has said which lanes moved.
 */
export function defersQueuedLane(
  state: CatchUpState,
  containerId: string,
): boolean {
  return state.status !== "idle" && !state.openedContainerIds.has(containerId);
}

/**
 * Whether a root sweep leaves an unforced `containerId` to the catch-up. A
 * lane found since the acknowledgement is not left: the crawl the catch-up
 * waits on was never asked about it.
 */
export function defersRootSweepLane(
  state: CatchUpState,
  containerId: string,
): boolean {
  return (
    state.status !== "idle" &&
    !state.openedContainerIds.has(containerId) &&
    state.wait.knownContainerIds.has(containerId)
  );
}
