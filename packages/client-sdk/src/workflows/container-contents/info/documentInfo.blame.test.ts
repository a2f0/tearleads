import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  derivePeerId,
  encodeVersionVector,
  exportFullHistorySnapshot,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { createDocumentWriterProjection } from "../../../../test/helpers/documentInfoFixtures";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import { loadDocumentInfo } from "./documentInfo";

test("loadDocumentInfo blames live characters using the persisted snapshot", async () => {
  const { close, execSql } = await createTestExecSql(
    "containerContents-document-info-blame-test",
  );

  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);

    const doc = await createDocument("writer-seed");
    const peerId = await derivePeerId("writer-seed");
    doc.getText("text").update("hello");
    doc.commit();

    await sqlDocumentsPersistence.saveDocument(
      execSql,
      {
        accessEpoch: 1,
        accessStateHash: "document-access-state-hash",
        containerId: "container-1",
        contentKeyBundle: "{}",
        documentId: "document-1",
        documentKekTargets: "{}",
        documentKind: "note",
        documentManifestBundle: JSON.stringify({
          manifestHash: "local-document-manifest-hash",
        }),
        id: "local-document-1",
        lastCommitLsn: "commit-lsn-1",
        snapshotEndVersion: encodeVersionVector(doc),
        text: "hello",
        title: "Hello",
      },
      { updatedAt: "2026-05-18T10:00:00.000Z" },
    );
    await sqlDocumentsPersistence.replaceHistoryCheckpoint?.(execSql, {
      coveredTailIds: [],
      endVersionVector: encodeVersionVector(doc),
      force: true,
      localId: "local-document-1",
      snapshot: bytesToBase64(exportFullHistorySnapshot(doc)),
    });

    const info = await loadDocumentInfo({
      apiClient: {
        getDocumentWriterProjection: async () =>
          createDocumentWriterProjection(),
        listDocumentAttachments: async () => [],
        getDocumentEditAttribution: async () => ({
          attributionRevision: 1,
          documentId: "document-1",
          segments: [
            {
              peerId,
              startCounter: 0,
              endCounter: 3,
              writerUserId: "writer-1",
              writerKeyFingerprint: "fp-1",
              authorityKind: "direct",
            },
            {
              peerId,
              startCounter: 3,
              endCounter: 5,
              writerUserId: "writer-2",
              writerKeyFingerprint: "fp-2",
              authorityKind: "baseline",
            },
          ],
        }),
      },
      execSql,
      localId: "local-document-1",
      reportSecurityIncident: async () => undefined,
      remoteInfoMode: "if-synced",
    });

    expect(info.remoteInfo?.characterBlame).toEqual({
      writers: [
        {
          writerUserId: "writer-1",
          writerKeyFingerprint: "fp-1",
          characterCount: 3,
          directCharacterCount: 3,
          baselineCharacterCount: 0,
          hasDirectAuthority: true,
          hasBaselineAuthority: false,
        },
        {
          writerUserId: "writer-2",
          writerKeyFingerprint: "fp-2",
          characterCount: 2,
          directCharacterCount: 0,
          baselineCharacterCount: 2,
          hasDirectAuthority: false,
          hasBaselineAuthority: true,
        },
      ],
      totalCharacterCount: 5,
      unattributedCharacterCount: 0,
    });
    expect(info.remoteInfo?.blameRanges).toEqual([
      {
        startIndex: 0,
        endIndex: 3,
        text: "hel",
        writerUserId: "writer-1",
        writerKeyFingerprint: "fp-1",
        authorityKind: "direct",
      },
      {
        startIndex: 3,
        endIndex: 5,
        text: "lo",
        writerUserId: "writer-2",
        writerKeyFingerprint: "fp-2",
        authorityKind: "baseline",
      },
    ]);
  } finally {
    close();
  }
});

test("loadDocumentInfo blames structured-document fields using the snapshot", async () => {
  const { close, execSql } = await createTestExecSql(
    "containerContents-document-field-blame-test",
  );

  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);

    const doc = await createDocument("writer-seed");
    const peerId = await derivePeerId("writer-seed");
    doc.getMap("fields").set("firstName", "Ada");
    doc.getMap("fields").set("lastName", "Lovelace");
    doc.commit();

    await sqlDocumentsPersistence.saveDocument(
      execSql,
      {
        accessEpoch: 1,
        accessStateHash: "document-access-state-hash",
        containerId: "container-1",
        contentKeyBundle: "{}",
        documentId: "document-1",
        documentKekTargets: "{}",
        documentKind: "contact",
        documentManifestBundle: JSON.stringify({
          manifestHash: "local-document-manifest-hash",
        }),
        id: "local-document-1",
        lastCommitLsn: "commit-lsn-1",
        snapshotEndVersion: encodeVersionVector(doc),
        text: "",
        title: "Ada Lovelace",
      },
      { updatedAt: "2026-05-18T10:00:00.000Z" },
    );
    await sqlDocumentsPersistence.replaceHistoryCheckpoint?.(execSql, {
      coveredTailIds: [],
      endVersionVector: encodeVersionVector(doc),
      force: true,
      localId: "local-document-1",
      snapshot: bytesToBase64(exportFullHistorySnapshot(doc)),
    });

    const info = await loadDocumentInfo({
      apiClient: {
        getDocumentWriterProjection: async () =>
          createDocumentWriterProjection(),
        listDocumentAttachments: async () => [],
        getDocumentEditAttribution: async () => ({
          attributionRevision: 1,
          documentId: "document-1",
          segments: [
            {
              peerId,
              startCounter: 0,
              endCounter: 10,
              writerUserId: "writer-1",
              writerKeyFingerprint: "fp-1",
              authorityKind: "direct",
            },
          ],
        }),
      },
      execSql,
      localId: "local-document-1",
      reportSecurityIncident: async () => undefined,
      remoteInfoMode: "if-synced",
    });

    expect(info.remoteInfo?.fieldBlame).toEqual([
      {
        fieldKey: "firstName",
        writerUserId: "writer-1",
        writerKeyFingerprint: "fp-1",
      },
      {
        fieldKey: "lastName",
        writerUserId: "writer-1",
        writerKeyFingerprint: "fp-1",
      },
    ]);
    expect(info.remoteInfo?.blameRanges).toEqual([]);
  } finally {
    close();
  }
});

test("loadDocumentInfo degrades to null blame for an unreadable snapshot", async () => {
  const { close, execSql } = await createTestExecSql(
    "containerContents-document-info-corrupt-snapshot-test",
  );

  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    // A corrupt/garbage persisted history checkpoint must not blank the whole
    // Info panel — blame degrades to null while the rest of remoteInfo still
    // loads.
    await sqlDocumentsPersistence.saveDocument(
      execSql,
      {
        accessEpoch: 1,
        accessStateHash: "document-access-state-hash",
        containerId: "container-1",
        contentKeyBundle: "{}",
        documentId: "document-1",
        documentKekTargets: "{}",
        documentKind: "note",
        documentManifestBundle: JSON.stringify({
          manifestHash: "local-document-manifest-hash",
        }),
        id: "local-document-1",
        lastCommitLsn: "commit-lsn-1",
        snapshotEndVersion: "",
        text: "hello",
        title: "Hello",
      },
      { updatedAt: "2026-05-18T10:00:00.000Z" },
    );
    await sqlDocumentsPersistence.replaceHistoryCheckpoint?.(execSql, {
      coveredTailIds: [],
      endVersionVector: "",
      force: true,
      localId: "local-document-1",
      snapshot: "!!!not-valid-base64-or-loro!!!",
    });

    const info = await loadDocumentInfo({
      apiClient: {
        getDocumentWriterProjection: async () =>
          createDocumentWriterProjection(),
        listDocumentAttachments: async () => [],
        getDocumentEditAttribution: async () => ({
          attributionRevision: 1,
          documentId: "document-1",
          segments: [],
        }),
      },
      execSql,
      localId: "local-document-1",
      reportSecurityIncident: async () => undefined,
      remoteInfoMode: "if-synced",
    });

    expect(info.remoteInfo).not.toBeNull();
    expect(info.remoteInfo?.characterBlame).toBeNull();
    expect(info.remoteInfo?.blameRanges).toBeNull();
    expect(info.remoteInfo?.fieldBlame).toBeNull();
    expect(info.remoteInfo?.contentKeyEpoch).toBe(2);
  } finally {
    close();
  }
});
