import { expect, mock, test } from "bun:test";
import { settleContainerMetadataOutgoingPass } from "./index";
import {
  createContainerRecord,
  createDocumentRecord,
} from "./metadata.testFixtures";
import {
  resumedEarlierMetadataPull,
  shouldRequestContainerMetadataFollowup,
} from "./metadataSyncFollowup";

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

test("a metadata read resumed an earlier pull exactly when it consumed one", () => {
  const record = createDocumentRecord({ id: "container-1" });
  expect(
    resumedEarlierMetadataPull({
      consumedPullContinuation: null,
      requestRecord: record,
    }),
  ).toBe(false);
  expect(
    resumedEarlierMetadataPull({
      consumedPullContinuation: {
        commitLsn: "0/2",
        commitLsnMode: "tracked",
        cursor: "metadata-page-2",
      },
      requestRecord: record,
    }),
  ).toBe(true);
  expect(
    resumedEarlierMetadataPull({
      consumedPullContinuation: null,
      requestRecord: { ...record, pullContinuationRecoveryRequired: true },
    }),
  ).toBe(true);
});
