import { expect, test } from "bun:test";
import {
  createDocument,
  encodeVersionVector,
  exportFullHistorySnapshot,
  exportUpdatesSince,
  getTextValue,
  getUpdateVersionVectors,
  versionVectorsEqual,
} from "@symcrypt/loro";
import type { DocumentSyncResponse } from "@symcrypt/validators/response";
import {
  findUniqueRepairingCandidate,
  isDocumentSyncUpdateIsolationError,
  validateDocumentSyncUpdateImports,
} from "./documentSyncUpdateIsolation";

function deterministicAscii(length: number): string {
  const bytes = new Uint8Array(length);
  let state = 0x9e3779b9;
  for (let index = 0; index < bytes.length; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    bytes[index] = 32 + ((state >>> 0) % 95);
  }
  return new TextDecoder().decode(bytes);
}

test("ambiguous repairing candidates do not receive exact attribution", async () => {
  const examined: string[] = [];
  const candidate = await findUniqueRepairingCandidate(
    ["first", "second", "third"],
    async (value) => {
      examined.push(value);
      return value !== "third";
    },
  );

  expect(candidate).toBeNull();
  expect(examined).toEqual(["first", "second", "third"]);
});

test("duplicate response ids receive anonymous batch attribution", async () => {
  const current = await createDocument("isolation-duplicate-current");
  const duplicateId = "550e8400-e29b-41d4-a716-446655440088";
  const responseUpdate = {
    accessEpoch: 1,
    authorFingerprint: "first-fingerprint",
    createdAt: "2026-08-25T00:00:00.000Z",
    documentId: "document-id",
    encryptedData: "encrypted-data",
    id: duplicateId,
    partialEndVersionVector: "AA==",
    partialStartVersionVector: "AA==",
    plaintextHash: "plaintext-hash",
    writeHeader: {
      ciphertextHash: "ciphertext-hash",
      contentKeyEpoch: 4,
      metadataHash: "metadata-hash",
      writerUserId: "first-writer",
    },
  } as unknown as DocumentSyncResponse["updates"][number];

  let isolated: unknown;
  try {
    await validateDocumentSyncUpdateImports({
      currentDocument: current,
      decryptedUpdates: [
        {
          id: duplicateId,
          partialEndVersionVector: "AA==",
          partialStartVersionVector: "AA==",
          updateData: new Uint8Array([1, 2, 3]),
        },
        {
          id: duplicateId,
          partialEndVersionVector: "AA==",
          partialStartVersionVector: "AA==",
          updateData: new Uint8Array([4, 5, 6]),
        },
      ],
      responseUpdates: [
        responseUpdate,
        {
          ...responseUpdate,
          authorFingerprint: "second-fingerprint",
          writeHeader: {
            ...responseUpdate.writeHeader,
            writerUserId: "second-writer",
          },
        },
      ],
    });
  } catch (error) {
    isolated = error;
  }

  expect(isDocumentSyncUpdateIsolationError(isolated)).toBe(true);
  if (!isDocumentSyncUpdateIsolationError(isolated)) return;
  expect(isolated.attribution).toBe("batch");
  expect(isolated.stage).toBe("encrypted_record");
  expect(isolated.updateId).toBeNull();
  expect(isolated.writerUserId).toBeNull();
  expect(isolated.batchUpdateIds).toEqual([duplicateId, duplicateId]);
});

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

test("a delta with a missing parent receives batch attribution", async () => {
  const current = await createDocument("isolation-missing-parent-current");
  const author = await createDocument("isolation-missing-parent-author");
  author.getText("text").update("parent");
  author.commit();
  const parentVersion = encodeVersionVector(author);
  author.getText("text").update("parent and child");
  author.commit();
  const dependencyBearingData = exportUpdatesSince(author, parentVersion);
  const updateId = "550e8400-e29b-41d4-a716-4466554400b3";
  const responseUpdate = {
    authorFingerprint: "authenticated-fingerprint",
    id: updateId,
    writeHeader: {
      contentKeyEpoch: 4,
      writerUserId: "authenticated-writer",
    },
  } as unknown as DocumentSyncResponse["updates"][number];

  let isolated: unknown;
  try {
    await validateDocumentSyncUpdateImports({
      currentDocument: current,
      decryptedUpdates: [
        {
          id: updateId,
          ...getUpdateVersionVectors(dependencyBearingData),
          updateData: dependencyBearingData,
        },
      ],
      responseUpdates: [responseUpdate],
    });
  } catch (error) {
    isolated = error;
  }

  expect(isDocumentSyncUpdateIsolationError(isolated)).toBe(true);
  if (!isDocumentSyncUpdateIsolationError(isolated)) return;
  expect(isolated.attribution).toBe("batch");
  expect(isolated.updateId).toBeNull();
  expect(isolated.writerUserId).toBeNull();
  expect(isolated.authorFingerprint).toBeNull();
  expect(isolated.batchUpdateIds).toEqual([updateId]);
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

test("mixed poison checkpoints and deltas receive batch attribution", async () => {
  const current = await createDocument("isolation-mixed-poison-current");
  const checkpointId = "550e8400-e29b-41d4-a716-4466554400e1";
  const deltaId = "550e8400-e29b-41d4-a716-4466554400e2";

  let isolated: unknown;
  try {
    await validateDocumentSyncUpdateImports({
      currentDocument: current,
      decryptedUpdates: [
        {
          checkpointKind: "rotate_baseline",
          checkpointPayloadKind: "full_history_snapshot",
          id: checkpointId,
          partialEndVersionVector: "AA==",
          partialStartVersionVector: "AA==",
          updateData: new Uint8Array([1, 2, 3]),
        },
        {
          id: deltaId,
          partialEndVersionVector: "AA==",
          partialStartVersionVector: "AA==",
          updateData: new Uint8Array([4, 5, 6]),
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
  expect(isolated.batchUpdateIds).toEqual([checkpointId, deltaId]);
});

test("large current snapshots skip exact repeated-import isolation", async () => {
  const current = await createDocument("isolation-snapshot-budget-current");
  current.getText("text").update(deterministicAscii(1_300_000));
  current.commit();
  expect(exportFullHistorySnapshot(current).byteLength).toBeGreaterThan(
    1024 * 1024,
  );

  const validSource = await createDocument("isolation-snapshot-budget-valid");
  validSource.getText("text").update("valid sibling");
  validSource.commit();
  const validData = exportUpdatesSince(validSource, undefined);
  const updates = [
    {
      id: "550e8400-e29b-41d4-a716-4466554400f0",
      partialEndVersionVector: "AA==",
      partialStartVersionVector: "AA==",
      updateData: new Uint8Array([1, 2, 3]),
    },
    ...Array.from({ length: 7 }, (_, index) => ({
      id: `550e8400-e29b-41d4-a716-4466554400f${index + 1}`,
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
