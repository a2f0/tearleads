import { expect, test } from "bun:test";
import { createPendingUpdateRecord } from "../../../test/helpers/documentFixtures";
import {
  acceptedHeldBackPendingUpdateIds,
  responseAcceptedRecoveryBaseline,
  submittedPendingUpdates,
} from "./syncPlanRequestBounds";

test("conflict recovery retains only pending updates submitted by the bounded plan", () => {
  const submitted = createPendingUpdateRecord({
    id: "550e8400-e29b-41d4-a716-446655440001",
  });
  const deferred = createPendingUpdateRecord({
    id: "550e8400-e29b-41d4-a716-446655440002",
  });

  expect(
    submittedPendingUpdates([submitted, deferred], {
      request: { outgoingUpdates: [{ id: submitted.id }] },
    } as never),
  ).toEqual([submitted]);
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
