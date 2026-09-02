import { expect, test } from "bun:test";
import { createPendingUpdateRecord } from "../../../test/helpers/documentFixtures";
import {
  acceptedHeldBackPendingUpdateIds,
  hasDeferredPendingUpdatesAfterSubmit,
  recoverablePendingUpdates,
  responseAcceptedRecoveryBaseline,
} from "./syncPlanRequestBounds";

test("conflict recovery retains submitted and held-back logical updates", () => {
  const submitted = createPendingUpdateRecord({
    id: "550e8400-e29b-41d4-a716-446655440001",
  });
  const deferred = createPendingUpdateRecord({
    id: "550e8400-e29b-41d4-a716-446655440002",
  });
  const heldBack = createPendingUpdateRecord({
    id: "550e8400-e29b-41d4-a716-446655440003",
  });

  expect(
    recoverablePendingUpdates([submitted, deferred, heldBack], {
      heldBackPendingUpdateIds: [heldBack.id],
      plan: { request: { outgoingUpdates: [{ id: submitted.id }] } },
    } as never),
  ).toEqual([submitted, heldBack]);
});

test("recovery baseline progress requires an explicit server acceptance", () => {
  const baselineId = "550e8400-e29b-41d4-a716-446655440003";
  const materializedPlan = {
    heldBackPendingUpdateIds: ["checkpoint-1"],
    staleRecoveryBaselineUpdateId: baselineId,
  } as never;
  const unacceptedResponse = { acceptedOutgoingUpdateIds: [] } as never;

  expect(
    responseAcceptedRecoveryBaseline(materializedPlan, unacceptedResponse),
  ).toBe(false);
  expect(
    acceptedHeldBackPendingUpdateIds(materializedPlan, unacceptedResponse),
  ).toEqual([]);
  expect(
    responseAcceptedRecoveryBaseline(materializedPlan, {
      acceptedOutgoingUpdateIds: [baselineId],
    } as never),
  ).toBe(true);
  expect(
    acceptedHeldBackPendingUpdateIds(materializedPlan, {
      acceptedOutgoingUpdateIds: [baselineId],
    } as never),
  ).toEqual(["checkpoint-1"]);
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
