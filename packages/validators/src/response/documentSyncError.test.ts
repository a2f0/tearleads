import { expect, test } from "bun:test";
import {
  DOCUMENT_SYNC_ERROR_CODES,
  DocumentSyncErrorResponseSchema,
  isDocumentSyncErrorResponse,
  isDocumentSyncStateStaleErrorResponse,
  MAX_DOCUMENT_PEER_FRONTIERS,
} from "./documentSyncError";

test("document sync error schema accepts stable codes and extensions", () => {
  for (const code of Object.values(DOCUMENT_SYNC_ERROR_CODES)) {
    expect(
      isDocumentSyncErrorResponse({ code, error: "Diagnostic", future: true }),
    ).toBe(true);
  }
});

test("state-stale sync errors may carry signed policy repair heads", () => {
  const response = {
    code: DOCUMENT_SYNC_ERROR_CODES.stateStale,
    error: "Principal policy is stale",
    principalHeads: [],
  };

  expect(isDocumentSyncStateStaleErrorResponse(response)).toBe(true);
  expect(isDocumentSyncErrorResponse(response)).toBe(true);
  expect(
    isDocumentSyncStateStaleErrorResponse({
      ...response,
      code: DOCUMENT_SYNC_ERROR_CODES.conflict,
    }),
  ).toBe(false);
});

test("peer-owned sync errors carry bounded decimal peer frontiers", () => {
  const response = (peerFrontiers: unknown) => ({
    code: DOCUMENT_SYNC_ERROR_CODES.peerOwned,
    error: "Document peer is owned by another user",
    peerFrontiers,
  });
  const frontier = { committedEndCounter: 0, peerId: "18446744073709551615" };

  expect(isDocumentSyncErrorResponse(response([frontier]))).toBe(true);
  expect(
    isDocumentSyncErrorResponse(
      response(Array(MAX_DOCUMENT_PEER_FRONTIERS).fill(frontier)),
    ),
  ).toBe(true);
  for (const invalid of [
    Array(MAX_DOCUMENT_PEER_FRONTIERS + 1).fill(frontier),
    [{ ...frontier, peerId: "" }],
    [{ ...frontier, peerId: "12a" }],
    [{ ...frontier, peerId: "1".repeat(21) }],
    [{ ...frontier, committedEndCounter: -1 }],
    [{ ...frontier, committedEndCounter: 1.5 }],
  ]) {
    expect(isDocumentSyncErrorResponse(response(invalid))).toBe(false);
  }
});

test("document sync error schema rejects incomplete or unknown envelopes", () => {
  expect(isDocumentSyncErrorResponse({ error: "Diagnostic" })).toBe(false);
  expect(
    isDocumentSyncErrorResponse({ code: "unknown", error: "Diagnostic" }),
  ).toBe(false);
  expect(
    DocumentSyncErrorResponseSchema.safeParse({
      code: DOCUMENT_SYNC_ERROR_CODES.conflict,
      error: "",
    }).success,
  ).toBe(false);
});
