import {
  SYSTEM_SLOT_CREATE_HOLD_MS,
  systemSlotCreateGate,
  transitionCreateIntentHold,
} from "../../../../data/containers/shared/createIntentHoldMachine";
import {
  ContainerSyncWatermarkRepository,
  containerParentSyncLane,
} from "../../../../data/persistence/container-contents/containerSyncWatermarkPersistence";
import type { ContainerCreateIntentSyncInput } from "../types";
import { getOrCreateCreateIntentHoldListings } from "./createIntentHoldListings";

export { SYSTEM_SLOT_CREATE_HOLD_MS, systemSlotCreateGate };

/**
 * A hold asks once for its parent's listing, so it does not wait on a crawl
 * that may have listed that parent before the fold. A runtime reset asks again.
 */
function requestHoldListingOnce(
  input: ContainerCreateIntentSyncInput,
  heldSince: string,
): void {
  const { intent, state } = input;
  const holdKey = `${intent.id}@${heldSince}`;
  if (
    !getOrCreateCreateIntentHoldListings(state.runtime.state.domainScope).claim(
      state.runtime.infra.execSql,
      holdKey,
    )
  ) {
    return;
  }
  input.requestRemoteReconciliation(intent.parentContainerId);
}

/**
 * Returns whether the create waits, sending nothing. A held create asks for
 * its parent's listing, and for a pass when its hold expires so it does not
 * wait on an unrelated one.
 */
export async function deferSystemSlotCreate(
  input: ContainerCreateIntentSyncInput,
): Promise<boolean> {
  const { intent, state } = input;
  if (intent.hold.status === "slotTaken") {
    return true;
  }
  if (intent.hold.status !== "awaitingParentListing") {
    return false;
  }
  const [check] = await new ContainerSyncWatermarkRepository(
    state.runtime.infra.execSql,
  ).loadCheckRecords([containerParentSyncLane(intent.parentContainerId)]);
  if (!input.isCurrent()) {
    return true;
  }
  const gate = systemSlotCreateGate({
    hold: intent.hold,
    nowMs: Date.now(),
    parentCheckedAt: check?.checkedAt ?? null,
  });
  if (gate.status === "awaiting-listing") {
    requestHoldListingOnce(input, intent.hold.since);
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
): Promise<"abandoned" | "parked"> {
  const { intent, state } = input;
  const nextHold = transitionCreateIntentHold(intent.hold, {
    type: "slotTaken",
  });
  if (nextHold.status !== "none") {
    await state.persistence.recordCreateIntentRevisionHold(
      state.runtime.infra.execSql,
      {
        containerId: intent.containerId,
        expectedIntentId: intent.id,
        expectedUpdatedAt: intent.updatedAt,
        hold: nextHold,
        stillCurrent: input.isCurrent,
      },
    );
  }
  if (!input.isCurrent()) return "abandoned";
  state.runtime.util.log(
    `Container contents: deferred create intent for ${intent.containerId}; its system slot is taken remotely, awaiting its parent's listing.`,
  );
  input.requestRemoteReconciliation(intent.parentContainerId);
  return "parked";
}
