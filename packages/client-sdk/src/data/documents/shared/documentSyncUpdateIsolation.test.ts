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

test("batch isolation preserves reordered sibling dependencies", async () => {
  const current = await createDocument("isolation-reordered-current");
  const source = await createDocument("isolation-reordered-source");
  source.getText("text").update("parent");
  source.commit();
  const parentUpdateData = exportUpdatesSince(source, undefined);
  const parentEnd = encodeVersionVector(source);
  source.getText("text").update("parent and child");
  source.commit();
  const childUpdateData = exportUpdatesSince(source, parentEnd);
  const poisonId = "550e8400-e29b-41d4-a716-4466554400bb";
  const parentUpdate = {
    id: "550e8400-e29b-41d4-a716-4466554400b1",
    ...getUpdateVersionVectors(parentUpdateData),
    updateData: parentUpdateData,
  };
  const childUpdate = {
    id: "550e8400-e29b-41d4-a716-4466554400b2",
    ...getUpdateVersionVectors(childUpdateData),
    updateData: childUpdateData,
  };

  await expect(
    validateDocumentSyncUpdateImports({
      currentDocument: current,
      decryptedUpdates: [childUpdate, parentUpdate],
    }),
  ).resolves.toBeUndefined();

  let isolated: unknown;
  try {
    await validateDocumentSyncUpdateImports({
      currentDocument: current,
      decryptedUpdates: [
        childUpdate,
        parentUpdate,
        {
          id: poisonId,
          partialEndVersionVector: "AA==",
          partialStartVersionVector: "AA==",
          updateData: new Uint8Array([1, 2, 3]),
        },
      ],
    });
  } catch (error) {
    isolated = error;
  }

  expect(isDocumentSyncUpdateIsolationError(isolated)).toBe(true);
  if (isDocumentSyncUpdateIsolationError(isolated)) {
    expect(isolated.updateId).toBe(poisonId);
  }
});

test("multiple poison updates produce honest batch attribution", async () => {
  const current = await createDocument("isolation-multiple-current");
  const validSource = await createDocument("isolation-multiple-valid");
  validSource.getText("text").update("valid sibling");
  validSource.commit();
  const validData = exportUpdatesSince(validSource, undefined);
  const poisonIds = [
    "550e8400-e29b-41d4-a716-4466554400c1",
    "550e8400-e29b-41d4-a716-4466554400c2",
  ];
  const validId = "550e8400-e29b-41d4-a716-4466554400c3";

  let isolated: unknown;
  try {
    await validateDocumentSyncUpdateImports({
      currentDocument: current,
      decryptedUpdates: [
        ...poisonIds.map((id, index) => ({
          id,
          partialEndVersionVector: "AA==",
          partialStartVersionVector: "AA==",
          updateData: new Uint8Array([index + 1, 2, 3]),
        })),
        {
          id: validId,
          ...getUpdateVersionVectors(validData),
          updateData: validData,
        },
      ],
    });
  } catch (error) {
    isolated = error;
  }

  expect(isDocumentSyncUpdateIsolationError(isolated)).toBe(true);
  if (!isDocumentSyncUpdateIsolationError(isolated)) return;
  expect(isolated.attribution).toBe("batch");
  expect(isolated.updateId).toBeNull();
  expect(isolated.writerUserId).toBeNull();
  expect(isolated.batchUpdateIds).toEqual([...poisonIds, validId]);
});

test("large failed pages skip exact quadratic isolation", async () => {
  const current = await createDocument("isolation-bounded-current");
  const validSource = await createDocument("isolation-bounded-valid");
  validSource.getText("text").update("valid sibling");
  validSource.commit();
  const validData = exportUpdatesSince(validSource, undefined);
  const updates = [
    {
      id: "550e8400-e29b-41d4-a716-4466554400d0",
      partialEndVersionVector: "AA==",
      partialStartVersionVector: "AA==",
      updateData: new Uint8Array([1, 2, 3]),
    },
    ...Array.from({ length: 8 }, (_, index) => ({
      id: `550e8400-e29b-41d4-a716-4466554400d${index + 1}`,
      ...getUpdateVersionVectors(validData),
      updateData: validData,
    })),
  ];

  let isolated: unknown;
  try {
    await validateDocumentSyncUpdateImports({
      currentDocument: current,
      decryptedUpdates: updates,
    });
  } catch (error) {
    isolated = error;
  }

  expect(isDocumentSyncUpdateIsolationError(isolated)).toBe(true);
  if (!isDocumentSyncUpdateIsolationError(isolated)) return;
  expect(isolated.attribution).toBe("batch");
  expect(isolated.updateId).toBeNull();
  expect(isolated.batchUpdateIds).toEqual(updates.map((update) => update.id));
});
