import { expect, test } from "bun:test";
import {
  createDocument,
  encodeVersionVector,
  exportFullHistoryIdentity,
  exportFullHistorySnapshot,
  exportHistorySegments,
  exportUpdatesSince,
  getImportBlobMetadata,
  getTextValue,
  getUpdateVersionVectors,
  importUpdates,
  versionVectorsEqual,
} from "@tearleads/loro";
import { SMALL_BASELINE_SEGMENTS } from "../../../../../test/helpers/data/rotationBaselineFixtures";
import { validateDocumentSyncUpdateImports } from "../../../../data/documents/shared/sync/documentSyncImportVerdicts";
import type { DecryptedDocumentSyncUpdate } from "../../../../data/documents/shared/sync/documentSyncTypes";
import { createDomainScope } from "../../../../data/shared/domainScope";
import type { ExecSql } from "../../../../data/sqlite/sqlSchema";
import type { DocumentRecord } from "../../../../workflows/documents";
import type {
  DocumentState,
  DocumentStoreState,
  DocumentSyncAttempt,
} from "../state";
import { captureDocumentStoreSyncGeneration } from "./syncGeneration";
import {
  applyIncomingSyncedUpdates,
  importSyncedDocumentUpdates,
} from "./syncUpdateImport";

/** Each segment as the sync pass hands it to the import, in index order. */
function baselineSegmentUpdates(
  document: DocumentState,
): DecryptedDocumentSyncUpdate[] {
  const baselineId = crypto.randomUUID();
  return [...exportHistorySegments(document, SMALL_BASELINE_SEGMENTS)].map(
    (segment) => ({
      baselineId,
      dependencyVersionVector: segment.dependencyVersionVector,
      id: crypto.randomUUID(),
      partialEndVersionVector: segment.partialEndVersionVector,
      partialStartVersionVector: segment.partialStartVersionVector,
      updateData: segment.update,
    }),
  );
}

async function authorWithLongHistory(seed: string) {
  const author = await createDocument(seed);
  for (let index = 0; index < 40; index += 1) {
    const text = author.getText("text");
    text.insert(text.length, `line ${index} of the rotated history\n`);
    author.commit();
  }
  return author;
}

test("merges a multi-segment rotation baseline into a behind reader with a concurrent local edit", async () => {
  const author = await authorWithLongHistory("baseline-merge-author");

  const behindReader = await createDocument("baseline-merge-reader");
  importUpdates(behindReader, [exportUpdatesSince(author, undefined)]);
  behindReader.getText("text").insert(0, "local ");
  behindReader.commit();

  author.getText("text").insert(author.getText("text").length, "remote");
  author.commit();
  const segments = baselineSegmentUpdates(author);
  expect(segments.length).toBeGreaterThan(1);
  const baselineEnd = encodeVersionVector(author);

  author.getText("text").insert(author.getText("text").length, " later");
  author.commit();
  const later = exportUpdatesSince(author, baselineEnd);

  importSyncedDocumentUpdates(behindReader, [
    ...segments,
    {
      id: crypto.randomUUID(),
      ...getUpdateVersionVectors(later),
      updateData: later,
    },
  ]);

  expect(getTextValue(behindReader)).toStartWith("local ");
  expect(getTextValue(behindReader)).toContain("remote");
  expect(getTextValue(behindReader)).toEndWith(" later");
});

test("a multi-segment rotation baseline imports as update blobs to the history it was cut from", async () => {
  const author = await authorWithLongHistory("baseline-import-author");
  const segments = baselineSegmentUpdates(author);
  expect(segments.length).toBeGreaterThan(1);
  // A baseline is its history cut into updates, never a snapshot.
  expect(
    segments.map((segment) => getImportBlobMetadata(segment.updateData).mode),
  ).toEqual(segments.map(() => "update"));

  const coldReader = await createDocument("baseline-import-reader");
  importSyncedDocumentUpdates(coldReader, segments);

  expect(getTextValue(coldReader)).toBe(getTextValue(author));
  expect(
    versionVectorsEqual(
      encodeVersionVector(coldReader),
      encodeVersionVector(author),
    ),
  ).toBe(true);
  expect(exportFullHistoryIdentity(coldReader)).toEqual(
    exportFullHistoryIdentity(author),
  );
});

test("a snapshot payload served as a rotation baseline is void", async () => {
  const author = await authorWithLongHistory("baseline-snapshot-author");
  const snapshot = exportFullHistorySnapshot(author);
  const snapshotId = crypto.randomUUID();
  const coldReader = await createDocument("baseline-snapshot-reader");

  const { voided } = await validateDocumentSyncUpdateImports({
    currentDocument: coldReader,
    decryptedUpdates: [
      {
        baselineId: crypto.randomUUID(),
        id: snapshotId,
        ...getUpdateVersionVectors(snapshot),
        updateData: snapshot,
      },
    ],
  });

  expect(voided.map((entry) => entry.updateId)).toEqual([snapshotId]);
  expect(voided[0]?.stage).toBe("loro_metadata");
  expect(String(voided[0]?.error.message)).toContain(
    "Document update payload is not an update blob",
  );
  expect(getTextValue(coldReader)).toBe("");
});

test("a stale identity response cannot import updates or advance coverage", async () => {
  const currentDoc = await createDocument("current-identity-reader");
  const currentVersion = encodeVersionVector(currentDoc);
  const oldRemote = await createDocument("old-identity-writer");
  oldRemote.getText("text").update("old remote content");
  oldRemote.commit();
  const updateData = exportUpdatesSince(oldRemote, undefined);
  const updateVectors = getUpdateVersionVectors(updateData);
  const state = {
    pendingBaseVersion: currentVersion,
    record: { documentId: "new-document-id" },
  } as DocumentStoreState;
  const requestRecord = {
    documentId: "old-document-id",
  } as DocumentRecord;
  const syncAttempt = {
    outgoingUpdateCount: 0,
    synced: {
      decryptedUpdates: [
        {
          id: "old-update-id",
          ...updateVectors,
          updateData,
        },
      ],
      plan: { documentId: "old-document-id" },
    },
  } as unknown as DocumentSyncAttempt;

  const result = applyIncomingSyncedUpdates(
    state,
    currentDoc,
    requestRecord,
    syncAttempt,
  );

  expect(result).toBe(currentDoc);
  expect(getTextValue(currentDoc)).toBe("");
  expect(versionVectorsEqual(state.pendingBaseVersion, currentVersion)).toBe(
    true,
  );
});

test("a pre-rotation response cannot overwrite a same-id security context", async () => {
  const currentDoc = await createDocument("rotated-identity-reader");
  const currentVersion = encodeVersionVector(currentDoc);
  const requestRecord = {
    accessEpoch: 1,
    accessStateHash: "old-access-state",
    containerId: "old-container",
    contentKeyBundle: "old-content-key-bundle",
    documentId: "same-document-id",
    documentKekTargets: "old-kek-targets",
    documentManifestBundle: "old-manifest",
    id: "local-id",
  } as DocumentRecord;
  const state = {
    pendingBaseVersion: currentVersion,
    record: {
      ...requestRecord,
      accessEpoch: 2,
      accessStateHash: "new-access-state",
      containerId: "new-container",
      contentKeyBundle: "new-content-key-bundle",
      documentKekTargets: "new-kek-targets",
      documentManifestBundle: "new-manifest",
    },
  } as DocumentStoreState;
  const oldRemote = await createDocument("pre-rotation-writer");
  oldRemote.getText("text").update("pre-rotation content");
  oldRemote.commit();
  const updateData = exportUpdatesSince(oldRemote, undefined);
  const syncAttempt = {
    outgoingUpdateCount: 0,
    synced: {
      decryptedUpdates: [
        {
          id: "pre-rotation-update-id",
          ...getUpdateVersionVectors(updateData),
          updateData,
        },
      ],
      plan: { documentId: "same-document-id" },
    },
  } as unknown as DocumentSyncAttempt;

  const result = applyIncomingSyncedUpdates(
    state,
    currentDoc,
    requestRecord,
    syncAttempt,
  );

  expect(result).toBe(currentDoc);
  expect(getTextValue(currentDoc)).toBe("");
  expect(versionVectorsEqual(state.pendingBaseVersion, currentVersion)).toBe(
    true,
  );
});

test("a response from a replaced document generation cannot import", async () => {
  const currentDoc = await createDocument("generation-response-reader");
  const currentVersion = encodeVersionVector(currentDoc);
  const requestRecord = {
    accessEpoch: 1,
    containerId: "container-id",
    documentId: "document-id",
    id: "local-id",
  } as DocumentRecord;
  const state = {
    doc: currentDoc,
    pendingBaseVersion: currentVersion,
    record: requestRecord,
    resolveProjectionUserKey: async () => null,
    runtime: {
      infra: { execSql: (async () => []) as ExecSql },
      state: { domainScope: createDomainScope() },
    },
  } as unknown as DocumentStoreState;
  const generation = captureDocumentStoreSyncGeneration(state, currentDoc);
  expect(generation).not.toBeNull();
  if (!generation) return;

  const oldRemote = await createDocument("generation-response-writer");
  oldRemote.getText("text").update("stale generation content");
  oldRemote.commit();
  const updateData = exportUpdatesSince(oldRemote, undefined);
  const syncAttempt = {
    outgoingUpdateCount: 0,
    synced: {
      decryptedUpdates: [
        {
          id: "stale-generation-update",
          ...getUpdateVersionVectors(updateData),
          updateData,
        },
      ],
      plan: { documentId: "document-id" },
    },
  } as unknown as DocumentSyncAttempt;
  state.doc = await createDocument("replacement-generation-reader");

  const result = applyIncomingSyncedUpdates(
    state,
    currentDoc,
    requestRecord,
    syncAttempt,
    generation,
  );

  expect(result).toBe(currentDoc);
  expect(getTextValue(currentDoc)).toBe("");
  expect(versionVectorsEqual(state.pendingBaseVersion, currentVersion)).toBe(
    true,
  );
});
