import { expect, test } from "bun:test";
import { createPendingUpdateRecord } from "../../../../test/helpers/data/documentFixtures";
import {
  hasDeferredPendingUpdatesAfterSubmit,
  recoverablePendingUpdates,
  responseAcceptedRecoveryBaseline,
} from "./syncPlanRequestBounds";

// A heal's baseline segments lead the request but are no queue rows, so
// recovery keeps the queued updates the request carried and nothing else.
test("conflict recovery retains only the queued updates a request submitted", () => {
  const submitted = createPendingUpdateRecord({
    id: "550e8400-e29b-41d4-a716-446655440001",
  });
  const deferred = createPendingUpdateRecord({
    id: "550e8400-e29b-41d4-a716-446655440002",
  });
  const segmentId = "550e8400-e29b-41d4-a716-446655440003";

  expect(
    recoverablePendingUpdates([submitted, deferred], {
      plan: {
        request: { outgoingUpdates: [{ id: segmentId }, { id: submitted.id }] },
      },
      rotationBaselineUpdateIds: [segmentId],
    } as never),
  ).toEqual([submitted]);
});

// The API commits a baseline whole or refuses the request, so only a
// response that names every segment accepted the baseline.
test("recovery baseline progress requires every segment's acceptance", () => {
  const segmentIds = [
    "550e8400-e29b-41d4-a716-446655440003",
    "550e8400-e29b-41d4-a716-446655440004",
    "550e8400-e29b-41d4-a716-446655440005",
  ];
  const queuedId = "550e8400-e29b-41d4-a716-446655440001";
  const materializedPlan = { rotationBaselineUpdateIds: segmentIds } as never;
  const accepting = (acceptedOutgoingUpdateIds: readonly string[]) =>
    ({ acceptedOutgoingUpdateIds }) as never;

  expect(
    responseAcceptedRecoveryBaseline(materializedPlan, accepting([])),
  ).toBe(false);
  expect(
    responseAcceptedRecoveryBaseline(
      materializedPlan,
      accepting([...segmentIds.slice(0, -1), queuedId]),
    ),
  ).toBe(false);
  expect(
    responseAcceptedRecoveryBaseline(
      materializedPlan,
      accepting([...segmentIds, queuedId]),
    ),
  ).toBe(true);
  // A plan that sent no baseline never had one accepted.
  expect(
    responseAcceptedRecoveryBaseline({} as never, accepting([queuedId])),
  ).toBe(false);
  expect(
    responseAcceptedRecoveryBaseline(
      { rotationBaselineUpdateIds: [] } as never,
      accepting([queuedId]),
    ),
  ).toBe(false);
});

test("an accepted recovery baseline re-arms displaced pending edits", () => {
  expect(
    hasDeferredPendingUpdatesAfterSubmit({
      acceptedRecoveryBaseline: true,
      exhaustedPendingUpdateCount: 0,
      pendingUpdateIds: ["displaced-edit"],
      rekeyedPendingUpdateIds: [],
      settledPendingUpdateIds: [],
    }),
  ).toBe(true);
});

test("mixed recovery stops rescheduling when any pending row is exhausted", () => {
  expect(
    hasDeferredPendingUpdatesAfterSubmit({
      acceptedRecoveryBaseline: false,
      exhaustedPendingUpdateCount: 1,
      pendingUpdateIds: ["exhausted", "rekeyed"],
      rekeyedPendingUpdateIds: ["replacement"],
      settledPendingUpdateIds: [],
    }),
  ).toBe(false);
});
