import { expect, test } from "bun:test";
import {
  createDocument,
  encodeVersionVector,
  exportFullHistorySnapshot,
  exportUpdatesSince,
  getTextValue,
  getUpdateVersionVectors,
  importUpdates,
  versionVectorsEqual,
} from "@symcrypt/loro";
import { createDomainScope } from "../../../data/domainScope";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import type { DocumentRecord } from "../../../workflows/documents";
import type { DocumentStoreState, DocumentSyncAttempt } from "./state";
import { captureDocumentStoreSyncGeneration } from "./syncGeneration";
import {
  applyIncomingSyncedUpdates,
  importSyncedDocumentUpdates,
} from "./syncUpdateImport";

test("merges a full-history rotation snapshot into a behind reader with a concurrent local edit", async () => {
  const author = await createDocument("snapshot-merge-author");
  const empty = encodeVersionVector(author);
  author.getText("text").update("base");
  author.commit();

  const behindReader = await createDocument("snapshot-merge-reader");
  importUpdates(behindReader, [exportUpdatesSince(author, empty)]);
  behindReader.getText("text").insert(4, " local");
  behindReader.commit();

  author.getText("text").insert(4, " remote");
  author.commit();
  const checkpoint = exportFullHistorySnapshot(author);
  const checkpointVectors = getUpdateVersionVectors(checkpoint);
  const checkpointEnd = encodeVersionVector(author);

  author.getText("text").insert(author.getText("text").length, " later");
  author.commit();
  const later = exportUpdatesSince(author, checkpointEnd);
  const laterVectors = getUpdateVersionVectors(later);

  importSyncedDocumentUpdates(behindReader, [
    {
      checkpointKind: "rotate_baseline",
      checkpointPayloadKind: "full_history_snapshot",
      id: crypto.randomUUID(),
      ...checkpointVectors,
      sourceVersionVector: checkpointEnd,
      updateData: checkpoint,
    },
    {
      id: crypto.randomUUID(),
      ...laterVectors,
      updateData: later,
    },
  ]);

  expect(getTextValue(behindReader)).toContain(" local");
  expect(getTextValue(behindReader)).toContain(" remote");
  expect(getTextValue(behindReader)).toContain(" later");
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
