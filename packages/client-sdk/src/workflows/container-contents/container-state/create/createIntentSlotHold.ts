import {
  CONTAINER_CREATE_AWAITS_PARENT_LISTING,
  CONTAINER_SYSTEM_SLOT_TAKEN_MESSAGE,
} from "../../../../data/containers/shared/systemSlotCreate";
import {
  ContainerSyncWatermarkRepository,
  containerParentSyncLane,
} from "../../../../data/persistence/container-contents/containerSyncWatermarkPersistence";
import type { ContainerCreateIntentSyncInput } from "../types";

/**
 * How long a system-slot create that a root fold re-homed waits for a listing
 * of its new parent's children before it posts anyway. A connection's tree
 * crawl lists that parent, so the bound matters only while listings fail.
 */
export const SYSTEM_SLOT_CREATE_HOLD_MS = 120_000;

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
  readonly heldSince: string;
  readonly lastError: string | null;
  readonly nowMs: number;
  readonly parentCheckedAt: string | null;
}): SystemSlotCreateGate {
  if (input.lastError === CONTAINER_SYSTEM_SLOT_TAKEN_MESSAGE) {
    return { status: "slot-taken" };
  }
  if (input.lastError !== CONTAINER_CREATE_AWAITS_PARENT_LISTING) {
    return { status: "post" };
  }
  const heldSinceMs = Date.parse(input.heldSince);
  const listedAfterHold =
    input.parentCheckedAt !== null &&
    Date.parse(input.parentCheckedAt) > heldSinceMs;
  const remainingMs = heldSinceMs + SYSTEM_SLOT_CREATE_HOLD_MS - input.nowMs;
  if (listedAfterHold || !Number.isFinite(heldSinceMs) || remainingMs <= 0) {
    return { status: "post" };
  }
  return { status: "awaiting-listing", remainingMs };
}

/**
 * Returns whether the create waits, sending nothing. A held create asks for a
 * pass when its hold expires, so it does not wait on an unrelated one.
 */
export async function deferSystemSlotCreate(
  input: ContainerCreateIntentSyncInput,
): Promise<boolean> {
  const { intent, state } = input;
  if (
    intent.lastError !== CONTAINER_CREATE_AWAITS_PARENT_LISTING &&
    intent.lastError !== CONTAINER_SYSTEM_SLOT_TAKEN_MESSAGE
  ) {
    return false;
  }
  const [check] = await new ContainerSyncWatermarkRepository(
    state.runtime.infra.execSql,
  ).loadCheckRecords([containerParentSyncLane(intent.parentContainerId)]);
  const gate = systemSlotCreateGate({
    heldSince: intent.updatedAt,
    lastError: intent.lastError,
    nowMs: Date.now(),
    parentCheckedAt: check?.checkedAt ?? null,
  });
  if (gate.status === "awaiting-listing") {
    input.requestSyncAfter?.(gate.remainingMs);
  }
  return gate.status !== "post";
}

/**
 * Records the server's refusal once and asks for the parent's listing, which
 * folds this copy into the container that holds the slot. Not reported: a
 * device whose root fold raced its listing expects it.
 */
export async function recordTakenSystemSlotCreate(
  input: ContainerCreateIntentSyncInput,
): Promise<"abandoned" | "blocked"> {
  const { intent, state } = input;
  await state.persistence.recordCreateIntentRevisionError(
    state.runtime.infra.execSql,
    {
      containerId: intent.containerId,
      expectedIntentId: intent.id,
      expectedUpdatedAt: intent.updatedAt,
      message: CONTAINER_SYSTEM_SLOT_TAKEN_MESSAGE,
      stillCurrent: input.isCurrent,
    },
  );
  if (!input.isCurrent()) return "abandoned";
  state.runtime.util.log(
    `Container contents: deferred create intent for ${intent.containerId}; its system slot is taken remotely, awaiting its parent's listing.`,
  );
  input.requestRemoteReconciliation(intent.parentContainerId);
  return "blocked";
}
