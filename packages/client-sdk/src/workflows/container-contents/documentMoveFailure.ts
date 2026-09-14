import { isVanishedContainerFailure } from "../../data/containers/shared/mutationFailures";
import type { DocumentLinkSetMutationFailure } from "../documents";

/**
 * What a queued document move learned from its remote link/unlink attempts.
 * Every failure handed to the move's `onFailure` folds into this state; the
 * verdict (`pending`, `blocked`, `denied`) is read off it afterwards.
 */
export interface DocumentMoveFailureState {
  current: DocumentLinkSetMutationFailure | null;
  /** A 403 anywhere in the pass parks the intent as denied (row 7). */
  sawPermissionDenial: boolean;
  /**
   * The server proved a cited container no longer exists (coded projection
   * 404 or coded commit 409 `container_unavailable`). Retrying the SAME
   * request can never succeed — but the cited container may be a stale
   * ancestor in a cached path, so the verdict triggers a projection refresh
   * (documentMoveVanishedRefresh) before the intent parks terminally.
   */
  sawVanishedContainer: boolean;
}

export function createDocumentMoveFailureState(): DocumentMoveFailureState {
  return {
    current: null,
    sawPermissionDenial: false,
    sawVanishedContainer: false,
  };
}

export function recordDocumentMoveFailure(
  state: DocumentMoveFailureState,
  failure: DocumentLinkSetMutationFailure,
): void {
  state.current = failure;
  state.sawPermissionDenial =
    state.sawPermissionDenial || failure.status === 403;
  state.sawVanishedContainer =
    state.sawVanishedContainer || isVanishedContainerFailure(failure);
}

/**
 * The queue-facing description of a failed remote move. The stable prefixes
 * are kept so existing consumers keep matching; the captured detail appends
 * the HTTP status when one was seen, so a revoked permission (403) reads
 * differently from an offline blip.
 */
export function describeRejectedDocumentMove(
  state: DocumentMoveFailureState,
): string {
  const prefix = state.sawVanishedContainer
    ? "Remote document move cites a container deleted on the server"
    : "Remote document move was rejected or unavailable";
  const failure = state.current;
  if (!failure) {
    return prefix;
  }
  const detail =
    failure.status === null
      ? failure.message
      : `${failure.message} (${failure.status})`;
  return `${prefix}: ${detail}`;
}
