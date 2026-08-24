import { expect, mock, test } from "bun:test";
import { settleContainerMetadataOutgoingPass } from "./metadata";
import {
  createContainerRecord,
  createDocumentRecord,
} from "./metadata.testFixtures";
import { shouldRequestContainerMetadataFollowup } from "./metadataSyncFollowup";

test("metadata sync re-arms an incomplete paginated pull", () => {
  const metadataState = {
    container: createContainerRecord({ id: "container-5", parentId: null }),
    doc: {} as never,
    record: createDocumentRecord({ id: "container-5" }),
  };

  expect(
    settleContainerMetadataOutgoingPass(metadataState, {
      consumedPullContinuation: null,
      outgoingUpdateCount: 0,
      requestRecord: metadataState.record,
      synced: {
        acceptedRecoveryBaseline: false,
        exhaustedPendingUpdateCount: 0,
        hasIncompletePull: true,
        rekeyedPendingUpdateIds: [],
        settledPendingUpdateIds: [],
      } as never,
    }),
  ).toBe(true);
});

test("a superseded metadata settlement re-arms without settling outgoing state", () => {
  const settleOutgoingPass = mock(() => false);

  expect(
    shouldRequestContainerMetadataFollowup({
      persisted: {
        pullContinuationSuperseded: true,
        record: createDocumentRecord({ id: "container-1" }),
      },
      settleOutgoingPass,
    }),
  ).toBe(true);
  expect(settleOutgoingPass).not.toHaveBeenCalled();
});
