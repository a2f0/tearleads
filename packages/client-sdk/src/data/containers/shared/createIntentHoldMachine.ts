/**
 * How long a system-slot create that a root fold re-homed waits for a listing
 * of its new parent's children before it posts anyway. A connection's tree
 * crawl lists that parent, so the bound matters only while listings fail.
 */
export const SYSTEM_SLOT_CREATE_HOLD_MS = 120_000;

/** Persisted discriminator values for `local_intents.hold_kind`. */
export const CREATE_INTENT_HOLD_KINDS = {
  awaitingParentListing: "awaiting_parent_listing",
  pathTooDeep: "path_too_deep",
  slotTaken: "slot_taken",
} as const;

export type PersistedCreateIntentHoldKind =
  (typeof CREATE_INTENT_HOLD_KINDS)[keyof typeof CREATE_INTENT_HOLD_KINDS];

/**
 * Why a queued container create intent is held locally instead of posting.
 * Stored in its own columns on `local_intents` so `lastError` holds only real
 * replay failures and hold transitions never depend on error text.
 */
export type ContainerCreateIntentHold =
  | { readonly status: "none" }
  | { readonly status: "awaitingParentListing"; readonly since: string }
  | { readonly status: "slotTaken" }
  | { readonly status: "pathTooDeep" };

export const NO_CREATE_INTENT_HOLD: ContainerCreateIntentHold = {
  status: "none",
};

export type ContainerCreateIntentHoldEvent =
  | { readonly type: "rehomedSystemSlot"; readonly since: string }
  | { readonly type: "parentListingObserved"; readonly checkedAt: string }
  | { readonly type: "holdExpired"; readonly nowMs: number }
  | { readonly type: "slotTaken" }
  | { readonly type: "pathTooDeep" }
  | { readonly type: "requeued" }
  | { readonly type: "settled" }
  | { readonly type: "failed" };

/**
 * Pure transition for a queued create intent's hold state. Only the closed set
 * of events below can enter or leave a hold; a `slotTaken` or `pathTooDeep`
 * hold stays parked until the intent is re-queued (local move), settled, or
 * fails after a structural change.
 */
export function transitionCreateIntentHold(
  state: ContainerCreateIntentHold,
  event: ContainerCreateIntentHoldEvent,
): ContainerCreateIntentHold {
  switch (event.type) {
    case "rehomedSystemSlot":
      return { since: event.since, status: "awaitingParentListing" };
    case "parentListingObserved": {
      if (state.status !== "awaitingParentListing") return state;
      return Date.parse(event.checkedAt) > Date.parse(state.since)
        ? NO_CREATE_INTENT_HOLD
        : state;
    }
    case "holdExpired": {
      if (state.status !== "awaitingParentListing") return state;
      const heldSinceMs = Date.parse(state.since);
      if (
        !Number.isFinite(heldSinceMs) ||
        heldSinceMs + SYSTEM_SLOT_CREATE_HOLD_MS <= event.nowMs
      ) {
        return NO_CREATE_INTENT_HOLD;
      }
      return state;
    }
    case "slotTaken":
      return { status: "slotTaken" };
    case "pathTooDeep":
      return { status: "pathTooDeep" };
    case "requeued":
    case "settled":
    case "failed":
      return NO_CREATE_INTENT_HOLD;
    default:
      return event satisfies never;
  }
}

/** Whether a queued system-slot create may post, and if not, why. */
export type SystemSlotCreateGate =
  | { readonly status: "post" }
  | { readonly status: "awaiting-listing"; readonly remainingMs: number }
  | { readonly status: "slot-taken" };

/**
 * A create the server refused for a taken slot never posts again: folding the
 * listed container drops it. A create a root fold re-homed waits until its
 * parent's children were listed after the fold, or until the hold expires.
 */
export function systemSlotCreateGate(input: {
  readonly hold: ContainerCreateIntentHold;
  readonly nowMs: number;
  readonly parentCheckedAt: string | null;
}): SystemSlotCreateGate {
  if (input.hold.status === "slotTaken") {
    return { status: "slot-taken" };
  }
  if (input.hold.status !== "awaitingParentListing") {
    return { status: "post" };
  }
  const afterListing =
    input.parentCheckedAt !== null
      ? transitionCreateIntentHold(input.hold, {
          checkedAt: input.parentCheckedAt,
          type: "parentListingObserved",
        })
      : input.hold;
  const afterExpiry = transitionCreateIntentHold(afterListing, {
    nowMs: input.nowMs,
    type: "holdExpired",
  });
  if (afterExpiry.status !== "awaitingParentListing") {
    return { status: "post" };
  }
  return {
    remainingMs:
      Date.parse(afterExpiry.since) + SYSTEM_SLOT_CREATE_HOLD_MS - input.nowMs,
    status: "awaiting-listing",
  };
}

export function parseCreateIntentHold(input: {
  readonly fallbackSince: string;
  readonly holdKind: string | null;
  readonly holdSince: string | null;
}): ContainerCreateIntentHold {
  switch (input.holdKind) {
    case CREATE_INTENT_HOLD_KINDS.awaitingParentListing:
      return {
        since: input.holdSince ?? input.fallbackSince,
        status: "awaitingParentListing",
      };
    case CREATE_INTENT_HOLD_KINDS.slotTaken:
      return { status: "slotTaken" };
    case CREATE_INTENT_HOLD_KINDS.pathTooDeep:
      return { status: "pathTooDeep" };
    default:
      return NO_CREATE_INTENT_HOLD;
  }
}

export function serializeCreateIntentHold(hold: ContainerCreateIntentHold): {
  readonly holdKind: PersistedCreateIntentHoldKind | null;
  readonly holdSince: string | null;
} {
  switch (hold.status) {
    case "none":
      return { holdKind: null, holdSince: null };
    case "awaitingParentListing":
      return {
        holdKind: CREATE_INTENT_HOLD_KINDS.awaitingParentListing,
        holdSince: hold.since,
      };
    case "slotTaken":
      return {
        holdKind: CREATE_INTENT_HOLD_KINDS.slotTaken,
        holdSince: null,
      };
    case "pathTooDeep":
      return {
        holdKind: CREATE_INTENT_HOLD_KINDS.pathTooDeep,
        holdSince: null,
      };
    default:
      return hold satisfies never;
  }
}
