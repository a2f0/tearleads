import { expect, test } from "bun:test";
import {
  createDocument,
  encodeVersionVector,
  exportUpdatesSince,
  getTextValue,
  getUpdateVersionVectors,
  versionVectorsEqual,
} from "@tearleads/loro";
import type { DocumentSyncResponse } from "@tearleads/validators/response";
import { validateDocumentSyncUpdateImports } from "./documentSyncImportVerdicts";
import { isDocumentSyncUpdateIsolationError } from "./documentSyncUpdateIsolation";

const ids = {
  child: "550e8400-e29b-41d4-a716-4466554400b2",
  parent: "550e8400-e29b-41d4-a716-4466554400b1",
  poison: "550e8400-e29b-41d4-a716-4466554400bb",
};

async function parentAndChild(name: string) {
  const source = await createDocument(name);
  source.getText("text").update("parent");
  source.commit();
  const parentData = exportUpdatesSince(source, undefined);
  const parentEnd = encodeVersionVector(source);
  source.getText("text").update("parent and child");
  source.commit();
  const childData = exportUpdatesSince(source, parentEnd);
  return {
    child: {
      id: ids.child,
      ...getUpdateVersionVectors(childData),
      updateData: childData,
    },
    parent: {
      id: ids.parent,
      ...getUpdateVersionVectors(parentData),
      updateData: parentData,
    },
  };
}

function voidedIds(
  verdicts:
    | readonly { readonly updateId: string }[]
    | { readonly voided: readonly { readonly updateId: string }[] },
) {
  const voided = "voided" in verdicts ? verdicts.voided : verdicts;
  return voided.map((entry) => entry.updateId);
}

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

test("scratch import voids a poison update, keeps its sibling, and leaves live state alone", async () => {
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

  const { voided } = await validateDocumentSyncUpdateImports({
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

  expect(voidedIds(voided)).toEqual([invalidId]);
  const isolated = voided[0]?.error;
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

test("server order decides dependencies: a child served before its parent is void", async () => {
  const current = await createDocument("verdict-order-current");
  const { child, parent } = await parentAndChild("verdict-order-source");

  await expect(
    validateDocumentSyncUpdateImports({
      currentDocument: current,
      decryptedUpdates: [parent, child],
    }),
  ).resolves.toEqual({ deferredUpdateIds: [], voided: [] });

  // Every reader judges a page in server order, so the verdict cannot depend
  // on how a reader's pages happened to group the two updates.
  const { voided } = await validateDocumentSyncUpdateImports({
    currentDocument: current,
    decryptedUpdates: [child, parent],
  });
  expect(voidedIds(voided)).toEqual([ids.child]);
  expect(voided[0]?.stage).toBe("loro_import");
  expect(String(voided[0]?.error.message)).toContain(
    "depends on operations no earlier served update carries",
  );
});

test("a follow-up to a voided update is void too, and later honest updates are kept", async () => {
  const current = await createDocument("verdict-follow-up-current");
  const { child, parent } = await parentAndChild("verdict-follow-up-source");
  const other = await createDocument("verdict-follow-up-other");
  other.getText("other").update("independent");
  other.commit();
  const otherData = exportUpdatesSince(other, undefined);
  const otherUpdate = {
    id: "550e8400-e29b-41d4-a716-4466554400b4",
    ...getUpdateVersionVectors(otherData),
    updateData: otherData,
  };
  const poisonedParent = {
    ...parent,
    updateData: new Uint8Array([1, 2, 3]),
  };

  const { voided } = await validateDocumentSyncUpdateImports({
    currentDocument: current,
    decryptedUpdates: [poisonedParent, child, otherUpdate],
  });

  expect(voidedIds(voided)).toEqual([ids.parent, ids.child]);
  expect(getTextValue(current)).toBe("");
});

test("a reused operation id loses to the earlier carrier in server order", async () => {
  const current = await createDocument("verdict-collision-current");
  const honest = await createDocument("verdict-collision-honest");
  honest.getText("text").update("honest");
  honest.commit();
  const honestData = exportUpdatesSince(honest, undefined);
  // The same peer id and counters, carrying different operations.
  const forged = await createDocument("verdict-collision-honest");
  forged.getText("text").update("forged");
  forged.commit();
  const forgedData = exportUpdatesSince(forged, undefined);
  const honestUpdate = {
    id: "550e8400-e29b-41d4-a716-4466554400d1",
    ...getUpdateVersionVectors(honestData),
    updateData: honestData,
  };
  const forgedUpdate = {
    id: "550e8400-e29b-41d4-a716-4466554400d2",
    ...getUpdateVersionVectors(forgedData),
    updateData: forgedData,
  };

  expect(
    voidedIds(
      await validateDocumentSyncUpdateImports({
        currentDocument: current,
        decryptedUpdates: [honestUpdate, forgedUpdate],
      }),
    ),
  ).toEqual([forgedUpdate.id]);
  expect(
    voidedIds(
      await validateDocumentSyncUpdateImports({
        currentDocument: current,
        decryptedUpdates: [forgedUpdate, honestUpdate],
      }),
    ),
  ).toEqual([honestUpdate.id]);
});

test("a delta whose parent no served update carries is void with its writer named", async () => {
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

  const { voided } = await validateDocumentSyncUpdateImports({
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

  expect(voidedIds(voided)).toEqual([updateId]);
  const isolated = voided[0]?.error;
  if (!isDocumentSyncUpdateIsolationError(isolated)) {
    throw new Error("expected an attributed void");
  }
  expect(isolated.attribution).toBe("update");
  expect(isolated.writerUserId).toBe("authenticated-writer");
  expect(isolated.authorFingerprint).toBe("authenticated-fingerprint");
});

test("each poison update is voided on its own and the valid sibling is kept", async () => {
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

  const { voided } = await validateDocumentSyncUpdateImports({
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

  expect(voidedIds(voided)).toEqual(poisonIds);
});

test("poison checkpoints and deltas are each voided", async () => {
  const current = await createDocument("isolation-mixed-poison-current");
  const checkpointId = "550e8400-e29b-41d4-a716-4466554400e1";
  const deltaId = "550e8400-e29b-41d4-a716-4466554400e2";

  const { voided } = await validateDocumentSyncUpdateImports({
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

  expect(voidedIds(voided)).toEqual([checkpointId, deltaId]);
});
