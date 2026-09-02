import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { documents, documentUpdates } from "@tearleads/api-shared/schema";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import { DOCUMENT_SYNC_ERROR_CODES } from "@tearleads/validators/response";
import { assertInlineRekeyUpdatesAreNew } from "./appendOutgoingUpdates";

test("inline rekey replay rejects before rotating an accepted update again", async () => {
  const documentId = crypto.randomUUID();
  const updateId = crypto.randomUUID();
  await db.insert(documents).values({
    createdByFingerprint: "inline-rekey-replay-test",
    id: documentId,
  });
  await db.insert(documentUpdates).values({
    accessEpoch: 1,
    authorFingerprint: "inline-rekey-replay-test",
    byteLength: 16,
    documentId,
    encryptedData: "encrypted-update",
    id: updateId,
    partialEndVersionVector: "end-vector",
    partialStartVersionVector: "start-vector",
    plaintextHash: "plaintext-hash",
  });
  const request = {
    containerRekeys: [{}],
    outgoingUpdates: [{ id: updateId }],
  } as unknown as DocumentSyncRequest;

  await db.transaction(async (tx) => {
    await expect(
      assertInlineRekeyUpdatesAreNew({ documentId, executor: tx, request }),
    ).rejects.toMatchObject({
      code: DOCUMENT_SYNC_ERROR_CODES.updateIdConflict,
      message: "Document update id conflict",
      status: 409,
    });
  });
});
