import type { BlobInfo } from "@tearleads/client-sdk";

/**
 * Which blob, if any, the blob list's detail screen shows.
 *
 * - `following-route`: no explicit choice; the route's deep-link target opens
 *   the detail screen once a loaded row matches it.
 * - `dismissed`: the user went back to (or searched) the list, so a deep-link
 *   target no longer reopens the detail screen.
 * - `selected`: the user opened a row from the list.
 *
 * Replaces the `activeBlob` + `isDetailDismissed` pair, whose fourth
 * combination (a chosen blob that is also dismissed) meant nothing.
 */
export type BlobSelectionState =
  | { readonly status: "following-route" }
  | { readonly status: "dismissed" }
  | { readonly blob: BlobInfo; readonly status: "selected" };

type BlobSelectionEvent =
  | { readonly type: "back-to-list" }
  | { readonly blob: BlobInfo; readonly type: "blob-selected" }
  | { readonly type: "query-changed" }
  | { readonly type: "route-changed" }
  | { readonly type: "sorted" };

export const FOLLOWING_ROUTE: BlobSelectionState = {
  status: "following-route",
};
const DISMISSED: BlobSelectionState = { status: "dismissed" };

/**
 * Pure transition; returns the same reference for events that change nothing
 * so React skips the re-render.
 *
 * | state \ event   | blob-selected | back-to-list | query-changed | sorted          | route-changed   |
 * | --------------- | ------------- | ------------ | ------------- | --------------- | --------------- |
 * | following-route | selected      | dismissed    | dismissed     | (same)          | (same)          |
 * | dismissed       | selected      | (same)       | (same)        | (same)          | following-route |
 * | selected        | selected      | dismissed    | dismissed     | following-route | following-route |
 */
export function transitionBlobSelection(
  state: BlobSelectionState,
  event: BlobSelectionEvent,
): BlobSelectionState {
  switch (event.type) {
    case "blob-selected":
      return state.status === "selected" && state.blob === event.blob
        ? state
        : { blob: event.blob, status: "selected" };
    case "back-to-list":
    case "query-changed":
      return state.status === "dismissed" ? state : DISMISSED;
    case "sorted":
      // Sorting re-windows the list, so an explicit choice is dropped; a
      // dismissal stays dismissed.
      return state.status === "selected" ? FOLLOWING_ROUTE : state;
    case "route-changed":
      return state.status === "following-route" ? state : FOLLOWING_ROUTE;
    default:
      return assertNever(event);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled blob selection event: ${JSON.stringify(value)}`);
}
