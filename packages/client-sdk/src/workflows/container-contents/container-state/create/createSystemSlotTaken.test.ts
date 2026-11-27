import { expect, test } from "bun:test";
import { CONTAINER_MUTATION_ERROR_CODES } from "@tearleads/validators/response";
import {
  type CreateResult,
  failure,
  runReplayedSeededCreate,
  runSeededContainerCreate,
} from "../../../../../test/helpers/workflows/seededContainerCreate";
import type { ContainerCreateIntentHold } from "../../../../data/containers/shared/createIntentHoldMachine";
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

test("a queued create refused for a taken system slot records a typed hold and asks for its parent's listing", async () => {
  const result = await runReplayedSeededCreate(
    "container-slot-taken-replay",
    slotTaken,
  );
  expect(result.created).toBe(0);
  expect(result.requests).toHaveLength(1);
  expect(result.persisted).toEqual([]);
  expect(result.recordedErrors).toEqual([]);
  expect(result.recordedHolds).toEqual([{ status: "slotTaken" }]);
  expect(result.reconciliationRequests).toHaveLength(1);
});

// A sibling that settles reruns the pass; a refused create must not be sent
// again from the intent as the pass first listed it.
test.each([
  [
    "a taken system slot",
    slotTaken,
    1,
    { status: "slotTaken" } satisfies ContainerCreateIntentHold,
  ],
  [
    "a path that is too deep",
    () =>
      Promise.resolve(failure(409, CONTAINER_MUTATION_ERROR_CODES.pathTooDeep)),
    // The seeded create and its plain fallback.
    2,
    { status: "pathTooDeep" } satisfies ContainerCreateIntentHold,
  ],
] as const)(
  "a create refused for %s is not sent again in the same pass",
  async (_label, refuse, requestCount, recordedHold) => {
    const result = await runReplayedSeededCreate(
      "container-refused-with-sibling",
      refuse,
      false,
      () => false,
      true,
    );
    expect(result.created).toBe(1);
    expect(result.childRequests).toHaveLength(requestCount);
    expect(result.recordedErrors).toEqual([]);
    expect(result.recordedHolds).toEqual([recordedHold]);
  },
);
