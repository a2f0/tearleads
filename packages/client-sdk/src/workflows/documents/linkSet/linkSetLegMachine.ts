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
  readonly report?: (() => void) | undefined;
}

/**
 * One link or unlink leg. The first attempt (`speculative`) may cite rewraps
 * without listing; a refusal of those starts one `fresh` attempt, which lists.
 * A leg ends `committed`, `failed` with the refusals still to report, or
 * `abandoned` when the operation stopped being current, dropping what it held.
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

/**
 * One attempt of a leg: what it may cite before it prepares, then the source
 * and rewraps it signed. Only a speculative attempt can skip or reuse; a fresh
 * one always lists.
 */
export type LinkSetLegAttempt =
  | {
      readonly listing: "speculative" | "fresh";
      readonly status: "unprepared";
    }
  | {
      readonly listing: "speculative";
      readonly rewraps: BlobRewraps;
      readonly source: LinkSetRewrapSource;
      readonly status: "prepared";
    }
  | {
      readonly listing: "fresh";
      readonly rewraps: BlobRewraps;
      readonly source: "listed";
      readonly status: "prepared";
    };

export type PreparedLinkSetRewraps =
  | { readonly rewraps: BlobRewraps; readonly source: "listed" }
  | {
      readonly rewraps: BlobRewraps;
      readonly source: "reused" | "skipped";
    };

export function startLinkSetLegAttempt(
  state: Extract<LinkSetLegState, { status: "speculative" | "fresh" }>,
): LinkSetLegAttempt {
  return { listing: state.status, status: "unprepared" };
}

/**
 * Record what an attempt signed, replacing an earlier preparation; a fresh
 * attempt can only have listed.
 */
export function recordLinkSetLegRewraps(
  attempt: LinkSetLegAttempt,
  prepared: PreparedLinkSetRewraps,
): LinkSetLegAttempt {
  if (attempt.listing === "speculative")
    return { ...prepared, listing: "speculative", status: "prepared" };
  if (prepared.source !== "listed")
    throw new Error("A fresh link-set attempt must list its attachments");
  return { ...prepared, listing: "fresh", status: "prepared" };
}

function attemptSource(attempt: LinkSetLegAttempt): LinkSetRewrapSource | null {
  return attempt.status === "prepared" ? attempt.source : null;
}

/** Whether a refusal of this attempt is held back until the leg decides. */
export function holdsLinkSetRefusals(attempt: LinkSetLegAttempt): boolean {
  return isSpeculativeRewrapSource(attemptSource(attempt));
}

/** The event an attempt's result raises. */
export function linkSetAttemptEvent(input: {
  readonly attempt: LinkSetLegAttempt;
  readonly committed: boolean;
  readonly heldFailures: readonly LinkSetSubmitFailure[];
  readonly stillCurrent: boolean;
}): LinkSetLegEvent {
  const rewraps =
    input.attempt.status === "prepared" ? input.attempt.rewraps : null;
  return input.committed
    ? { rewraps, type: "attemptCommitted" }
    : {
        heldFailures: input.heldFailures,
        source: attemptSource(input.attempt),
        stillCurrent: input.stillCurrent,
        type: "attemptFailed",
      };
}

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
  // Nothing an ended operation held back is retried or reported.
  if (!event.stillCurrent) return { status: "abandoned" };
  const retryable =
    state.status === "speculative" &&
    event.heldFailures.some((failure) =>
      refusedSpeculativeRewraps(event.source, failure),
    );
  return retryable
    ? { status: "fresh" }
    : { status: "failed", unreported: event.heldFailures };
}
