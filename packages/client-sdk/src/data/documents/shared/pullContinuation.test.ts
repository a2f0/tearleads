import { expect, test } from "bun:test";
import { MAX_DOCUMENT_SYNC_PULL_CURSOR_LENGTH } from "@tearleads/validators/util";
import {
  deserializeDocumentSyncPullContinuation,
  serializeDocumentSyncPullContinuation,
} from "./pullContinuation";

test("document pull continuations round-trip through durable storage", () => {
  const continuation = {
    commitLsn: "0/2A",
    commitLsnMode: "tracked" as const,
    cursor: "page-2",
  };

  expect(
    deserializeDocumentSyncPullContinuation(
      serializeDocumentSyncPullContinuation(continuation),
    ),
  ).toEqual(continuation);
  expect(
    deserializeDocumentSyncPullContinuation(
      serializeDocumentSyncPullContinuation({
        commitLsn: "0/0",
        commitLsnMode: "untracked",
        cursor: "turso-page-2",
      }),
    ),
  ).toEqual({
    commitLsn: "0/0",
    commitLsnMode: "untracked",
    cursor: "turso-page-2",
  });
});

test("malformed durable pull progress safely restarts from page one", () => {
  for (const value of [
    "not-json",
    JSON.stringify([2, "tracked", "0/2", "page-2"]),
    JSON.stringify([1, "tracked", "not-an-lsn", "page-2"]),
    JSON.stringify([1, "tracked", "0/0", "page-2"]),
    JSON.stringify([1, "untracked", "0/2", "page-2"]),
    JSON.stringify([1, "tracked", "0/2", ""]),
    JSON.stringify([
      1,
      "tracked",
      "0/2",
      "x".repeat(MAX_DOCUMENT_SYNC_PULL_CURSOR_LENGTH + 1),
    ]),
  ]) {
    expect(deserializeDocumentSyncPullContinuation(value)).toBeNull();
  }
});
