/**
 * Explorer's Refresh, covering both a manual refresh and the open-time
 * catch-up: idle, one refresh running, or the last refresh failed. Each run
 * carries a request tag, so only the run that is current can settle it; a
 * run the user cancelled, or one that a later run replaced, is ignored when
 * it finally settles. A run interrupted by the database going away reports
 * nothing, as there is nothing the user can do about it here.
 *
 * | state       | event       | next                     |
 * | ----------- | ----------- | ------------------------ |
 * | idle        | started     | refreshing(request)      |
 * | failed      | started     | refreshing(request)      |
 * | refreshing  | succeeded   | idle (current only)      |
 * | refreshing  | interrupted | idle (current only)      |
 * | refreshing  | cancelled   | idle (current only)      |
 * | refreshing  | failed      | failed (current only)    |
 * | refreshing  | started     | ignored: one run at once |
 * | idle/failed | settled     | ignored: stale run       |
 */
export type ExplorerRefreshState =
  | { readonly status: "idle" }
  | { readonly status: "refreshing"; readonly request: object }
  | { readonly status: "failed"; readonly message: string };

export type ExplorerRefreshEvent =
  | { readonly type: "started"; readonly request: object }
  | { readonly type: "succeeded"; readonly request: object }
  | { readonly type: "interrupted"; readonly request: object }
  | {
      readonly type: "failed";
      readonly message: string;
      readonly request: object;
    }
  | { readonly type: "cancelled"; readonly request: object };

export const IDLE_EXPLORER_REFRESH: ExplorerRefreshState = { status: "idle" };

export function transitionExplorerRefresh(
  state: ExplorerRefreshState,
  event: ExplorerRefreshEvent,
): ExplorerRefreshState {
  if (event.type === "started") {
    return state.status === "refreshing"
      ? state
      : { status: "refreshing", request: event.request };
  }
  if (state.status !== "refreshing" || state.request !== event.request) {
    return state;
  }
  switch (event.type) {
    case "succeeded":
    case "interrupted":
    case "cancelled":
      return IDLE_EXPLORER_REFRESH;
    case "failed":
      return { status: "failed", message: event.message };
    default:
      return assertNever(event);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled Explorer refresh event: ${JSON.stringify(value)}`);
}
