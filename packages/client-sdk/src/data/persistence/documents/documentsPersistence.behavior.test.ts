import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { sqlDocumentsPersistence } from "./documentsPersistence";

const emptyDocumentState = {
  contentKeyBundle: null,
  documentKekTargets: null,
  documentManifestBundle: null,
};

test("concurrent document saves are serialized on a shared SQLite connection", async () => {
  const { close, execSql } = await createTestExecSql(
    "documents-persistence-behavior-test",
  );

  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);

    await expect(
      Promise.all([
        sqlDocumentsPersistence.saveDocument(execSql, {
          id: "default",
          containerId: "root-container",
          documentId: null,
          text: "first",
          loroSnapshot: "snapshot-1",
          accessEpoch: 1,
        }),
        sqlDocumentsPersistence.saveDocument(execSql, {
          id: "default",
          containerId: "root-container",
          documentId: null,
          text: "second",
          loroSnapshot: "snapshot-2",
          accessEpoch: 2,
        }),
      ]),
    ).resolves.toEqual([expect.any(String), expect.any(String)]);

    await expect(
      sqlDocumentsPersistence.loadDocument(execSql, "default"),
    ).resolves.toEqual({
      id: "default",
      containerId: "root-container",
      documentId: null,
      documentKind: "note",
      lastCommitLsn: null,
      text: "second",
      title: "second",
      loroSnapshot: "snapshot-2",
      accessEpoch: 2,
      ...emptyDocumentState,
    });
  } finally {
    close();
  }
});

test("upsertDiscoveredDocument reuses an existing local note bound to the remote document id", async () => {
  const { close, execSql } = await createTestExecSql(
    "documents-persistence-behavior-test",
  );

  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);

    await sqlDocumentsPersistence.saveDocument(
      execSql,
      {
        id: "local-note",
        containerId: "shared-container",
        documentId: "remote-document",
        text: "Existing local note",
        loroSnapshot: "snapshot-1",
        accessEpoch: 2,
      },
      {
        updatedAt: "2026-04-05T00:00:00.000Z",
      },
    );

    await expect(
      sqlDocumentsPersistence.upsertDiscoveredDocument(execSql, {
        accessEpoch: 3,
        containerId: "shared-container",
        createdAt: "2026-04-06T00:00:00.000Z",
        documentId: "remote-document",
        linkedContainerIds: ["shared-container"],
      }),
    ).resolves.toEqual({
      accessStateHash: null,
      id: "local-note",
      containerId: "shared-container",
      documentKind: "note",
      documentId: "remote-document",
      title: "Existing local note",
      updatedAt: "2026-04-05T00:00:00.000Z",
    });

    await expect(
      sqlDocumentsPersistence.loadDocument(execSql, "local-note"),
    ).resolves.toEqual({
      id: "local-note",
      containerId: "shared-container",
      documentId: "remote-document",
      documentKind: "note",
      lastCommitLsn: null,
      text: "Existing local note",
      title: "Existing local note",
      loroSnapshot: "snapshot-1",
      accessEpoch: 3,
      ...emptyDocumentState,
    });

    await expect(
      sqlDocumentsPersistence.loadDocument(execSql, "remote-document"),
    ).resolves.toBeNull();
  } finally {
    close();
  }
});

test("upsertDiscoveredDocument preserves document state for the same remote document id", async () => {
  const { close, execSql } = await createTestExecSql(
    "documents-persistence-behavior-test",
  );

  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);

    await sqlDocumentsPersistence.saveDocument(
      execSql,
      {
        accessEpoch: 2,
        accessStateHash: "access-state-hash-1",
        containerId: "shared-container",
        documentId: "remote-document",
        id: "local-note",
        lastCommitLsn: "0/10",
        loroSnapshot: "snapshot-1",
        text: "Existing local note",
        contentKeyBundle: JSON.stringify({
          contentKeyEpoch: 1,
          linkSetManifestHash: "document-manifest-hash-1",
        }),
        documentKekTargets: JSON.stringify({
          documentKeyTargetHash: "document-target-hash-1",
        }),
        documentManifestBundle: JSON.stringify({
          manifestHash: "document-manifest-hash-1",
        }),
      },
      {
        updatedAt: "2026-04-05T00:00:00.000Z",
      },
    );

    await sqlDocumentsPersistence.upsertDiscoveredDocument(execSql, {
      accessEpoch: 2,
      containerId: "shared-container",
      createdAt: "2026-04-06T00:00:00.000Z",
      documentId: "remote-document",
      linkedContainerIds: ["shared-container"],
    });

    await expect(
      sqlDocumentsPersistence.loadDocument(execSql, "local-note"),
    ).resolves.toMatchObject({
      accessStateHash: "access-state-hash-1",
      documentId: "remote-document",
      lastCommitLsn: "0/10",
      contentKeyBundle: JSON.stringify({
        contentKeyEpoch: 1,
        linkSetManifestHash: "document-manifest-hash-1",
      }),
      documentKekTargets: JSON.stringify({
        documentKeyTargetHash: "document-target-hash-1",
      }),
      documentManifestBundle: JSON.stringify({
        manifestHash: "document-manifest-hash-1",
      }),
    });
  } finally {
    close();
  }
});

test("relinkPersistedDocument clears document state for a different remote document id", async () => {
  const { close, execSql } = await createTestExecSql(
    "documents-persistence-behavior-test",
  );

  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);

    await sqlDocumentsPersistence.saveDocument(execSql, {
      accessEpoch: 2,
      containerId: "container-a",
      documentId: "remote-document-a",
      id: "local-note",
      lastCommitLsn: "0/10",
      loroSnapshot: "snapshot-1",
      text: "Existing local note",
      contentKeyBundle: JSON.stringify({
        contentKeyEpoch: 1,
      }),
      documentKekTargets: JSON.stringify({
        documentKeyTargetHash: "document-target-hash-1",
      }),
      documentManifestBundle: JSON.stringify({
        manifestHash: "document-manifest-hash-1",
      }),
    });

    await sqlDocumentsPersistence.relinkPersistedDocument(execSql, {
      accessEpoch: 3,
      accessStateHash: "access-state-hash-2",
      containerId: "container-b",
      documentId: "remote-document-b",
      localId: "local-note",
    });

    const note = await sqlDocumentsPersistence.loadDocument(
      execSql,
      "local-note",
    );

    expect(note).toMatchObject({
      accessEpoch: 3,
      containerId: "container-b",
      documentId: "remote-document-b",
      lastCommitLsn: null,
    });
    expect(note?.contentKeyBundle).toBeNull();
    expect(note?.documentKekTargets).toBeNull();
    expect(note?.documentManifestBundle).toBeNull();
  } finally {
    close();
  }
});

test("upsertDiscoveredDocument preserves the active local container when another linked container rediscovers the document", async () => {
  const { close, execSql } = await createTestExecSql(
    "documents-persistence-behavior-test",
  );

  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);

    await sqlDocumentsPersistence.saveDocument(
      execSql,
      {
        id: "local-note",
        containerId: "container-a",
        documentId: "remote-document",
        text: "Existing local note",
        loroSnapshot: "snapshot-1",
        accessEpoch: 2,
      },
      {
        updatedAt: "2026-04-05T01:00:00.000Z",
      },
    );

    await expect(
      sqlDocumentsPersistence.upsertDiscoveredDocument(execSql, {
        accessEpoch: 3,
        containerId: "container-b",
        createdAt: "2026-04-06T01:00:00.000Z",
        documentId: "remote-document",
        linkedContainerIds: ["container-a", "container-b"],
      }),
    ).resolves.toEqual({
      accessStateHash: null,
      id: "local-note",
      containerId: "container-a",
      documentKind: "note",
      documentId: "remote-document",
      title: "Existing local note",
      updatedAt: "2026-04-05T01:00:00.000Z",
    });

    await expect(
      sqlDocumentsPersistence.loadDocument(execSql, "local-note"),
    ).resolves.toEqual({
      id: "local-note",
      containerId: "container-a",
      documentId: "remote-document",
      documentKind: "note",
      lastCommitLsn: null,
      text: "Existing local note",
      title: "Existing local note",
      loroSnapshot: "snapshot-1",
      accessEpoch: 3,
      ...emptyDocumentState,
    });
  } finally {
    close();
  }
});

test("relinkPersistedDocument updates the stored container and clears stale bundles on epoch change", async () => {
  const { close, execSql } = await createTestExecSql(
    "documents-persistence-behavior-test",
  );

  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);

    await sqlDocumentsPersistence.saveDocument(
      execSql,
      {
        id: "local-note",
        containerId: "container-a",
        documentId: "remote-document",
        accessStateHash: "access-state-hash-1",
        lastCommitLsn: "0/10",
        text: "Existing local note",
        loroSnapshot: "snapshot-1",
        accessEpoch: 2,
        contentKeyBundle: "stale-content-key-bundle",
        documentKekTargets: "stale-kek-targets",
        documentManifestBundle: "stale-manifest-bundle",
      },
      {
        updatedAt: "2026-04-05T02:00:00.000Z",
      },
    );

    await expect(
      sqlDocumentsPersistence.relinkPersistedDocument(execSql, {
        accessEpoch: 3,
        containerId: "container-b",
        documentId: "remote-document",
        localId: "local-note",
      }),
    ).resolves.toEqual({
      accessStateHash: null,
      id: "local-note",
      containerId: "container-b",
      documentKind: "note",
      documentId: "remote-document",
      title: "Existing local note",
      updatedAt: "2026-04-05T02:00:00.000Z",
    });

    const reloadedNote = await sqlDocumentsPersistence.loadDocument(
      execSql,
      "local-note",
    );

    expect(reloadedNote).toEqual({
      id: "local-note",
      containerId: "container-b",
      documentId: "remote-document",
      documentKind: "note",
      lastCommitLsn: "0/10",
      text: "Existing local note",
      title: "Existing local note",
      loroSnapshot: "snapshot-1",
      accessEpoch: 3,
      ...emptyDocumentState,
    });
    expect(reloadedNote?.accessStateHash ?? null).toBeNull();
  } finally {
    close();
  }
});
