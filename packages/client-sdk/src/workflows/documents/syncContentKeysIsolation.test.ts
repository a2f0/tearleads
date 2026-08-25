import { expect, test } from "bun:test";
import { KeyingVerificationError } from "@symcrypt/crypto";
import type { DocumentSyncResponse } from "@symcrypt/validators/response";
import { isDocumentSyncUpdateIsolationError } from "../../data/documents/shared/documentSyncUpdateIsolation";
import { DocumentHistoryUnavailableError } from "../../data/documents/shared/projection";
import { throwDocumentSyncContentKeyFailure } from "./syncContentKeys";

type SyncResponseUpdate = DocumentSyncResponse["updates"][number];

function responseUpdate(id: string, writerUserId: string): SyncResponseUpdate {
  return {
    id,
    writeHeader: { contentKeyEpoch: 3, writerUserId },
  } as unknown as SyncResponseUpdate;
}

test("content-key epoch failures do not blame one of multiple writers", () => {
  const updateIds = [
    "550e8400-e29b-41d4-a716-4466554400aa",
    "550e8400-e29b-41d4-a716-4466554400ab",
  ];
  const updates = [
    responseUpdate(updateIds[0] ?? "missing", "writer-a"),
    responseUpdate(updateIds[1] ?? "missing", "writer-b"),
  ];

  let isolated: unknown;
  try {
    throwDocumentSyncContentKeyFailure({
      cause: new Error("Content-key epoch could not be unwrapped"),
      updates,
    });
  } catch (error) {
    isolated = error;
  }

  expect(isDocumentSyncUpdateIsolationError(isolated)).toBe(true);
  if (!isDocumentSyncUpdateIsolationError(isolated)) return;
  expect(isolated.attribution).toBe("batch");
  expect(isolated.batchUpdateIds).toEqual(updateIds);
  expect(isolated.stage).toBe("content_key");
  expect(isolated.updateId).toBeNull();
  expect(isolated.writerUserId).toBeNull();
});

test("damaged predecessor history preserves its nested verification error", () => {
  const verificationError = new KeyingVerificationError(
    "missing_dependency",
    "Damaged predecessor keyring omitted a committed epoch",
  );
  const historyError = new DocumentHistoryUnavailableError(verificationError);

  let thrown: unknown;
  try {
    throwDocumentSyncContentKeyFailure({
      cause: historyError,
      updates: [
        responseUpdate("550e8400-e29b-41d4-a716-4466554400aa", "writer-a"),
      ],
    });
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBe(verificationError);
});
