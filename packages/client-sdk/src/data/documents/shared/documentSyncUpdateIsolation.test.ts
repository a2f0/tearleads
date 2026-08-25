import { expect, test } from "bun:test";
import {
  createDocument,
  encodeVersionVector,
  exportUpdatesSince,
  getTextValue,
  getUpdateVersionVectors,
  versionVectorsEqual,
} from "@symcrypt/loro";
import type { DocumentSyncResponse } from "@symcrypt/validators/response";
import {
  isDocumentSyncUpdateIsolationError,
  validateDocumentSyncUpdateImports,
} from "./documentSyncUpdateIsolation";

test("scratch import isolates the first poison update without mutating live state", async () => {
  const current = await createDocument("isolation-current");
  current.getText("text").update("local state");
  current.commit();
  const currentVersion = encodeVersionVector(current);

  const remote = await createDocument("isolation-remote");
  remote.getText("text").update("remote state");
  remote.commit();
  const validData = exportUpdatesSince(remote, undefined);
  const invalidId = "550e8400-e29b-41d4-a716-4466554400aa";
  const responseUpdate = {
    accessEpoch: 1,
    authorFingerprint: "writer-fingerprint",
    createdAt: "2026-08-25T00:00:00.000Z",
    documentId: "document-id",
    encryptedData: "encrypted-data",
    id: invalidId,
    partialEndVersionVector: "AA==",
    partialStartVersionVector: "AA==",
    plaintextHash: "plaintext-hash",
    writeHeader: {
      ciphertextHash: "ciphertext-hash",
      contentKeyEpoch: 4,
      metadataHash: "metadata-hash",
      writerUserId: "writer-user",
    },
  } as unknown as DocumentSyncResponse["updates"][number];

  let isolated: unknown;
  try {
    await validateDocumentSyncUpdateImports({
      currentDocument: current,
      decryptedUpdates: [
        {
          id: "550e8400-e29b-41d4-a716-446655440099",
          ...getUpdateVersionVectors(validData),
          updateData: validData,
        },
        {
          id: invalidId,
          partialEndVersionVector: "AA==",
          partialStartVersionVector: "AA==",
          updateData: new Uint8Array([1, 2, 3]),
        },
      ],
      responseUpdates: [responseUpdate],
    });
  } catch (error) {
    isolated = error;
  }

  expect(isDocumentSyncUpdateIsolationError(isolated)).toBe(true);
  if (!isDocumentSyncUpdateIsolationError(isolated)) return;
  expect(isolated.updateId).toBe(invalidId);
  expect(isolated.stage).toBe("loro_import");
  expect(isolated.writerUserId).toBe("writer-user");
  expect(isolated.authorFingerprint).toBe("writer-fingerprint");
  expect(isolated.contentKeyEpoch).toBe(4);
  expect(getTextValue(current)).toBe("local state");
  expect(
    versionVectorsEqual(encodeVersionVector(current), currentVersion),
  ).toBe(true);
});
