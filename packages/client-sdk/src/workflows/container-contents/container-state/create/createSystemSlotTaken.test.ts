import { expect, test } from "bun:test";
import {
  type CreateResult,
  failure,
  runReplayedSeededCreate,
  runSeededContainerCreate,
} from "../../../../../test/helpers/workflows/seededContainerCreate";
import { CONTAINER_SYSTEM_SLOT_TAKEN_MESSAGE } from "../../../../data/containers/shared/systemSlotCreate";
import { CONTAINER_SYSTEM_SLOT_TAKEN } from "./createWithMetadata";

// #3290: the server's refusal when the organization already holds the slot.
const slotTaken = (): Promise<CreateResult> =>
  Promise.resolve({ ...failure(409), systemSlotTaken: true });

test("a create refused for a taken system slot is sent once", async () => {
  const { created, requests } = await runSeededContainerCreate(
    "container-slot-taken",
    slotTaken,
  );
  expect(created).toBe(CONTAINER_SYSTEM_SLOT_TAKEN);
  // No plain fallback and no stale-parent retry.
  expect(
    requests.map((request) => Boolean(request.initialMetadataSync)),
  ).toEqual([true]);
});

test("a queued create refused for a taken system slot records it and asks for its parent's listing", async () => {
  const result = await runReplayedSeededCreate(
    "container-slot-taken-replay",
    slotTaken,
  );
  expect(result.created).toBe(0);
  expect(result.requests).toHaveLength(1);
  expect(result.persisted).toEqual([]);
  expect(result.recordedErrors).toEqual([CONTAINER_SYSTEM_SLOT_TAKEN_MESSAGE]);
  expect(result.reconciliationRequests).toHaveLength(1);
});
