import { expect, test } from "bun:test";
import { DOCUMENT_SYNC_ERROR_CODES } from "@tearleads/validators/response";
import { documentSyncErrorBody } from "./mutations";

test("sync state-stale responses carry principal-policy repair heads", () => {
  expect(
    documentSyncErrorBody({
      code: DOCUMENT_SYNC_ERROR_CODES.stateStale,
      details: { principalHeads: [] },
      error: "Principal policy is stale",
      status: 409,
    }),
  ).toEqual({
    code: DOCUMENT_SYNC_ERROR_CODES.stateStale,
    error: "Principal policy is stale",
    principalHeads: [],
  });
});

test("sync peer-owned responses carry the refused peers' committed frontiers", () => {
  const peerFrontiers = [{ committedEndCounter: 5, peerId: "900" }];
  expect(
    documentSyncErrorBody({
      code: DOCUMENT_SYNC_ERROR_CODES.peerOwned,
      details: { peerFrontiers, principalHeads: [] },
      error: "Document peer is owned by another user",
      status: 409,
    }),
  ).toEqual({
    code: DOCUMENT_SYNC_ERROR_CODES.peerOwned,
    error: "Document peer is owned by another user",
    peerFrontiers,
  });
  // Only the peer-owned code carries frontiers.
  expect(
    documentSyncErrorBody({
      code: DOCUMENT_SYNC_ERROR_CODES.updateIdConflict,
      details: { peerFrontiers },
      error: "Document update id conflict",
      status: 409,
    }),
  ).toEqual({
    code: DOCUMENT_SYNC_ERROR_CODES.updateIdConflict,
    error: "Document update id conflict",
  });
});

test("uncoded sync conflicts stay terminal", () => {
  expect(
    documentSyncErrorBody({
      code: undefined,
      details: undefined,
      error: "Terminal conflict",
      status: 409,
    }),
  ).toEqual({
    code: DOCUMENT_SYNC_ERROR_CODES.conflict,
    error: "Terminal conflict",
  });
});
