import type { SyncRemoteDocumentResult } from "../../../data/documents/shared/sync/documentSyncTypes";

/** How a sync pass's pull ended. */
export type DocumentPullOutcome =
  /** Every page was judged and applied. */
  | "complete"
  /** The server has more pages; the next pass continues the pull. */
  | "continues"
  /** The judge spent its rebuild budget; the next pass pulls again at once. */
  | "deferred"
  /**
   * An update the Loro runtime failed on holds the rest of the page; a later
   * scheduled pull judges it again.
   */
  | "held";

/**
 * Classifies a pull from what its last page's judge left (`deferred`,
 * `held`) and whether the server had more pages. A deferral starts the pull
 * again, so it outranks a hold; a hold ends the pull even when the server
 * had more pages, because they come after the update it holds.
 */
export function documentPullOutcome(input: {
  readonly deferred: boolean;
  readonly held: boolean;
  readonly pullComplete: boolean;
}): DocumentPullOutcome {
  if (input.deferred) return "deferred";
  if (input.held) return "held";
  return input.pullComplete ? "complete" : "continues";
}

/**
 * A judged page's result once its pull's completion is known. The result's
 * `hasIncompletePull` says only whether its judge deferred, until this sets
 * it from the outcome.
 */
export function withPullCompletion<
  Result extends Pick<
    SyncRemoteDocumentResult,
    "hasHeldPull" | "hasIncompletePull"
  >,
>(result: Result, pullComplete: boolean): Result {
  const outcome = documentPullOutcome({
    deferred: result.hasIncompletePull,
    held: result.hasHeldPull,
    pullComplete,
  });
  return {
    ...result,
    hasHeldPull: outcome === "held",
    hasIncompletePull: outcome === "continues" || outcome === "deferred",
  };
}
