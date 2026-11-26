/**
 * One shared refresh's lifecycle. Callers join while it is queued behind an
 * earlier refresh or running; a caller with a signal can withdraw. Once every
 * caller has withdrawn it is stopping: it never starts if still queued, and a
 * running one stops at its next safe boundary. A caller without a signal
 * never withdraws, so it keeps the refresh going.
 *
 * | state    | event    | next                                   |
 * | -------- | -------- | -------------------------------------- |
 * | queued   | joined   | queued(waiters + 1)                    |
 * | running  | joined   | running(waiters + 1)                   |
 * | queued   | withdrew | queued(waiters - 1), or stopping at 0  |
 * | running  | withdrew | running(waiters - 1), or stopping at 0 |
 * | queued   | started  | running(waiters)                       |
 * | stopping | started  | stopping: it never runs                |
 * | running  | listed   | running(waiters), listed               |
 * | any      | settled  | settled                                |
 *
 * Joining a stopping or settled refresh, and starting one that is already
 * running, are ignored; callers start a new refresh instead. A running
 * refresh is `listed` once it has read which containers it will list: a lane
 * owed a listing after that may not be among them.
 */
export type SharedRefreshState =
  | { readonly status: "queued"; readonly waiters: number }
  | {
      readonly listed: boolean;
      readonly status: "running";
      readonly waiters: number;
    }
  | { readonly status: "stopping" }
  | { readonly status: "settled" };

export type SharedRefreshEvent =
  | { readonly type: "joined" }
  | { readonly type: "withdrew" }
  | { readonly type: "started" }
  | { readonly type: "listed" }
  | { readonly type: "settled" };

export const QUEUED_SHARED_REFRESH: SharedRefreshState = {
  status: "queued",
  waiters: 0,
};

export function transitionSharedRefresh(
  state: SharedRefreshState,
  event: SharedRefreshEvent,
): SharedRefreshState {
  switch (event.type) {
    case "joined":
      return state.status === "queued" || state.status === "running"
        ? { ...state, waiters: state.waiters + 1 }
        : state;
    case "withdrew":
      if (state.status !== "queued" && state.status !== "running") {
        return state;
      }
      return state.waiters <= 1
        ? { status: "stopping" }
        : { ...state, waiters: state.waiters - 1 };
    case "started":
      return state.status === "queued"
        ? { listed: false, status: "running", waiters: state.waiters }
        : state;
    case "listed":
      return state.status === "running" ? { ...state, listed: true } : state;
    case "settled":
      return { status: "settled" };
    default:
      return assertNever(event);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled shared refresh event: ${JSON.stringify(value)}`);
}
