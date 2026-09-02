import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { documents, documentUpdates } from "@tearleads/api-shared/schema";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import { DOCUMENT_SYNC_ERROR_CODES } from "@tearleads/validators/response";
import {
  assertInlineRekeyCommitIsNew,
  recordInlineRekeyCommit,
} from "./syncInlineRekeyCommit";

function rekeyRequest(commitId = "a".repeat(64)): DocumentSyncRequest {
  return {
    containerRekeys: [{}],
    inlineRekeyCommitId: commitId,
    outgoingUpdates: [{ id: crypto.randomUUID() }],
  } as unknown as DocumentSyncRequest;
}

test("inline rekey replay rejects only its durable commit marker", async () => {
  const documentId = crypto.randomUUID();
  const otherDocumentId = crypto.randomUUID();
  await db.insert(documents).values({
    createdByFingerprint: "inline-rekey-replay-test",
    id: documentId,
  });
  await db.insert(documents).values({
    createdByFingerprint: "inline-rekey-replay-test",
    id: otherDocumentId,
  });
  const request = rekeyRequest();

  await db.transaction(async (tx) => {
    await assertInlineRekeyCommitIsNew({ documentId, executor: tx, request });
    await recordInlineRekeyCommit({ documentId, executor: tx, request });
    await expect(
      assertInlineRekeyCommitIsNew({ documentId, executor: tx, request }),
    ).rejects.toMatchObject({
      code: DOCUMENT_SYNC_ERROR_CODES.updateIdConflict,
      message: "Document update id conflict",
      status: 409,
    });
    await expect(
      assertInlineRekeyCommitIsNew({
        documentId: otherDocumentId,
        executor: tx,
        request,
      }),
    ).resolves.toBeUndefined();
  });
});

test("an unrelated existing update is not an inline rekey commit", async () => {
  const documentId = crypto.randomUUID();
  const updateId = crypto.randomUUID();
  await db.insert(documents).values({
    createdByFingerprint: "inline-rekey-ordinary-update-test",
    id: documentId,
  });
  await db.insert(documentUpdates).values({
    accessEpoch: 1,
    authorFingerprint: "inline-rekey-ordinary-update-test",
    byteLength: 16,
    documentId,
    encryptedData: "encrypted-update",
    id: updateId,
    partialEndVersionVector: "end-vector",
    partialStartVersionVector: "start-vector",
    plaintextHash: "plaintext-hash",
  });

  await db.transaction(async (tx) => {
    await expect(
      assertInlineRekeyCommitIsNew({
        documentId,
        executor: tx,
        request: {
          ...rekeyRequest("b".repeat(64)),
          outgoingUpdates: [{ id: updateId }],
        } as unknown as DocumentSyncRequest,
      }),
    ).resolves.toBeUndefined();
  });
});
