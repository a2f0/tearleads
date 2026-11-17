import type { DocumentLinkAccessEventBody } from "@tearleads/crypto";
import { DOCUMENT_MUTATION_ERROR_CODES } from "@tearleads/validators/response";
import type { DocumentLinkSetMutationFailure } from "../../../data/documents/shared/types";

type BlobRewraps = DocumentLinkAccessEventBody["blobRewraps"];

/**
 * Where an attempt's signed rewraps came from. `reused` re-cites the previous
 * leg's envelopes and `skipped` cites none because the local view holds no
 * attachment; neither listed, so the server's binding check may refuse them.
 */
export type LinkSetRewrapSource = "listed" | "reused" | "skipped";

/** A submit refusal, with the deferred host report the API client withheld. */
export interface LinkSetSubmitFailure extends DocumentLinkSetMutationFailure {
  readonly report: () => void;
}

/**
 * One link or unlink leg. The first attempt (`speculative`) may cite rewraps
 * without listing; a refusal of those starts one `fresh` attempt, which lists.
 * A leg ends `committed`, `failed` with the refusals still to report, or
 * `abandoned` when the operation stopped being current before the retry.
 */
export type LinkSetLegState =
  | { readonly status: "speculative" }
  | { readonly status: "fresh" }
  | { readonly status: "committed"; readonly rewraps: BlobRewraps | null }
  | {
      readonly status: "failed";
      readonly unreported: readonly LinkSetSubmitFailure[];
    }
  | { readonly status: "abandoned" };

export type LinkSetLegEvent =
  | { readonly type: "attemptCommitted"; readonly rewraps: BlobRewraps | null }
  | {
      readonly type: "attemptFailed";
      /** Refusals of a speculative attempt, held back from the caller. */
      readonly heldFailures: readonly LinkSetSubmitFailure[];
      readonly source: LinkSetRewrapSource | null;
      readonly stillCurrent: boolean;
    };

export const INITIAL_LINK_SET_LEG_STATE: LinkSetLegState = {
  status: "speculative",
};

export function isSpeculativeRewrapSource(
  source: LinkSetRewrapSource | null,
): boolean {
  return source === "reused" || source === "skipped";
}

/**
 * The server's binding check refused rewraps cited without listing: a coded
 * attachment-set refusal, or for re-cited envelopes the uncoded content-key
 * epoch refusal.
 */
function refusedSpeculativeRewraps(
  source: LinkSetRewrapSource | null,
  failure: DocumentLinkSetMutationFailure,
): boolean {
  if (failure.status !== 409 || !isSpeculativeRewrapSource(source))
    return false;
  if (failure.code === DOCUMENT_MUTATION_ERROR_CODES.linkAttachmentsChanged)
    return true;
  return source === "reused" && failure.code === undefined;
}

/**
 * Only a speculative attempt the binding check refused retries, and only
 * once: the fresh attempt lists, so it cannot be refused for the same stale
 * view again. Any other refusal keeps its own recovery path.
 */
export function transitionLinkSetLeg(
  state: LinkSetLegState,
  event: LinkSetLegEvent,
): LinkSetLegState {
  if (state.status !== "speculative" && state.status !== "fresh") return state;
  if (event.type === "attemptCommitted")
    return { rewraps: event.rewraps, status: "committed" };
  const retryable =
    state.status === "speculative" &&
    event.heldFailures.some((failure) =>
      refusedSpeculativeRewraps(event.source, failure),
    );
  if (!retryable) return { status: "failed", unreported: event.heldFailures };
  return event.stillCurrent ? { status: "fresh" } : { status: "abandoned" };
}
