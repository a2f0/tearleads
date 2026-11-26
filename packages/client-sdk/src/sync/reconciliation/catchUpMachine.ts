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
 * opens during the wait: its documents are on screen. The wait takes no turn
 * among the sweeps, so a root or full refresh runs beside it. Once the wait
 * ends, the catch-up takes a turn and lists the owed lanes, or every known
 * lane when nothing vouched for the rest.
 *
 * | State | Event | Next |
 * | --- | --- | --- |
 * | idle | acknowledged | awaitingCrawl, with that wait and nothing opened |
 * | awaitingCrawl | acknowledged | unchanged: the wait in progress serves both |
 * | awaitingCrawl | opened | awaitingCrawl, with that container opened |
 * | awaitingCrawl | waitEnded, the same wait | idle |
 * | awaitingCrawl | waitEnded, an older wait | unchanged |
 * | any | stopped | idle |
 *
 * Every other pair leaves the state unchanged.
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
      /** Containers the user opened during the wait. */
      readonly openedContainerIds: ReadonlySet<string>;
      readonly status: "awaitingCrawl";
      readonly wait: CatchUpWait;
    };

export type CatchUpEvent =
  | { readonly type: "acknowledged"; readonly wait: CatchUpWait }
  | { readonly containerId: string; readonly type: "opened" }
  | { readonly type: "waitEnded"; readonly wait: CatchUpWait }
  | { readonly type: "stopped" };

export const IDLE_CATCH_UP: CatchUpState = { status: "idle" };

export function transitionCatchUp(
  state: CatchUpState,
  event: CatchUpEvent,
): CatchUpState {
  switch (event.type) {
    case "acknowledged":
      return state.status === "idle"
        ? {
            openedContainerIds: new Set(),
            status: "awaitingCrawl",
            wait: event.wait,
          }
        : state;
    case "opened":
      return state.status === "awaitingCrawl" &&
        !state.openedContainerIds.has(event.containerId)
        ? {
            ...state,
            openedContainerIds: new Set([
              ...state.openedContainerIds,
              event.containerId,
            ]),
          }
        : state;
    case "waitEnded":
      return state.status === "awaitingCrawl" && state.wait === event.wait
        ? IDLE_CATCH_UP
        : state;
    case "stopped":
      return IDLE_CATCH_UP;
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
  return (
    state.status === "awaitingCrawl" &&
    !state.openedContainerIds.has(containerId)
  );
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
    defersQueuedLane(state, containerId) &&
    state.status === "awaitingCrawl" &&
    state.wait.knownContainerIds.has(containerId)
  );
}
