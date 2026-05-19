import { expect, test } from "bun:test";
import {
  listDocumentsByContainerIds,
  sqlDocumentsPersistence,
} from "@tearleads/client-sdk/data/persistence/documents/documentsPersistence";
import { createTestExecSql } from "../../../../test/helpers/createTestExecSql";

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

test("listDocumentsByContainerIds only returns notes for the requested containers", async () => {
  const { close, execSql } = await createTestExecSql(
    "documents-persistence-behavior-test",
  );

  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);

    await sqlDocumentsPersistence.saveDocument(execSql, {
      id: "note-a",
      containerId: "container-a",
      documentId: "document-a",
      text: "Note A",
      loroSnapshot: "snapshot-a",
      accessEpoch: 1,
    });
    await sqlDocumentsPersistence.saveDocument(execSql, {
      id: "note-b",
      containerId: "container-b",
      documentId: "document-b",
      text: "Note B",
      loroSnapshot: "snapshot-b",
      accessEpoch: 1,
    });
    await sqlDocumentsPersistence.saveDocument(execSql, {
      id: "note-c",
      containerId: "container-c",
      documentId: "document-c",
      text: "Note C",
      loroSnapshot: "snapshot-c",
      accessEpoch: 1,
    });

    await expect(
      listDocumentsByContainerIds(execSql, ["container-a", "container-c"]),
    ).resolves.toEqual([
      {
        accessStateHash: null,
        id: "note-c",
        containerId: "container-c",
        documentKind: "note",
        documentId: "document-c",
        title: "Note C",
        updatedAt: expect.any(String),
      },
      {
        accessStateHash: null,
        id: "note-a",
        containerId: "container-a",
        documentKind: "note",
        documentId: "document-a",
        title: "Note A",
        updatedAt: expect.any(String),
      },
    ]);
  } finally {
    close();
  }
});

test("listDocumentsByContainerIdsOrDocumentIds returns directly and indirectly linked notes", async () => {
  const { close, execSql } = await createTestExecSql(
    "documents-persistence-behavior-test",
  );

  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);

    await sqlDocumentsPersistence.saveDocument(execSql, {
      id: "direct-note",
      containerId: "shared-container",
      documentId: "direct-document",
      text: "Direct Note",
      loroSnapshot: "snapshot-direct",
      accessEpoch: 1,
    });
    await sqlDocumentsPersistence.saveDocument(execSql, {
      id: "linked-note",
      containerId: "outside-container",
      documentId: "linked-document",
      text: "Linked Note",
      loroSnapshot: "snapshot-linked",
      accessEpoch: 1,
    });
    await sqlDocumentsPersistence.saveDocument(execSql, {
      id: "unrelated-note",
      containerId: "outside-container",
      documentId: "unrelated-document",
      text: "Unrelated Note",
      loroSnapshot: "snapshot-unrelated",
      accessEpoch: 1,
    });

    await expect(
      sqlDocumentsPersistence.listDocumentsByContainerIdsOrDocumentIds(
        execSql,
        {
          containerIds: ["shared-container"],
          documentIds: ["linked-document"],
        },
      ),
    ).resolves.toEqual([
      {
        accessStateHash: null,
        id: "linked-note",
        containerId: "outside-container",
        documentKind: "note",
        documentId: "linked-document",
        title: "Linked Note",
        updatedAt: expect.any(String),
      },
      {
        accessStateHash: null,
        id: "direct-note",
        containerId: "shared-container",
        documentKind: "note",
        documentId: "direct-document",
        title: "Direct Note",
        updatedAt: expect.any(String),
      },
    ]);
  } finally {
    close();
  }
});

test("listDocuments reads driver license titles and document kinds from projection metadata", async () => {
  const { close, execSql } = await createTestExecSql(
    "documents-persistence-behavior-test",
  );

  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);

    await sqlDocumentsPersistence.saveDocument(execSql, {
      id: "drivers-license",
      containerId: "identity-container",
      documentId: "document-license",
      documentKind: "drivers_license",
      text: "",
      title: "Driver's License D1234567",
      loroSnapshot: "snapshot-license",
      accessEpoch: 1,
    });

    await expect(
      sqlDocumentsPersistence.listDocuments(execSql),
    ).resolves.toEqual([
      {
        accessStateHash: null,
        id: "drivers-license",
        containerId: "identity-container",
        documentKind: "drivers_license",
        documentId: "document-license",
        title: "Driver's License D1234567",
        updatedAt: expect.any(String),
      },
    ]);
  } finally {
    close();
  }
});

test("listDocuments reads masked credit card titles and document kinds from projection metadata", async () => {
  const { close, execSql } = await createTestExecSql(
    "documents-persistence-behavior-test",
  );

  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);

    await sqlDocumentsPersistence.saveDocument(execSql, {
      id: "credit-card",
      containerId: "billing-container",
      documentId: "document-card",
      documentKind: "credit_card",
      text: "",
      title: "Credit Card ending in 1234",
      loroSnapshot: "snapshot-card",
      accessEpoch: 1,
    });

    await expect(
      sqlDocumentsPersistence.listDocuments(execSql),
    ).resolves.toEqual([
      {
        accessStateHash: null,
        id: "credit-card",
        containerId: "billing-container",
        documentKind: "credit_card",
        documentId: "document-card",
        title: "Credit Card ending in 1234",
        updatedAt: expect.any(String),
      },
    ]);
  } finally {
    close();
  }
});

test("upsertDiscoveredDocument uses the remote createdAt for a newly discovered document", async () => {
  const { close, execSql } = await createTestExecSql(
    "documents-persistence-behavior-test",
  );

  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);

    await expect(
      sqlDocumentsPersistence.upsertDiscoveredDocument(execSql, {
        accessEpoch: 1,
        containerId: "shared-container",
        createdAt: "2026-04-06T12:00:00.000Z",
        documentId: "remote-document",
        linkedContainerIds: ["shared-container"],
      }),
    ).resolves.toEqual({
      accessStateHash: null,
      id: "remote-document",
      containerId: "shared-container",
      documentKind: "note",
      documentId: "remote-document",
      title: "Untitled note",
      updatedAt: "2026-04-06T12:00:00.000Z",
    });

    await expect(
      sqlDocumentsPersistence.listDocuments(execSql),
    ).resolves.toEqual([
      {
        accessStateHash: null,
        id: "remote-document",
        containerId: "shared-container",
        documentKind: "note",
        documentId: "remote-document",
        title: "Untitled note",
        updatedAt: "2026-04-06T12:00:00.000Z",
      },
    ]);
  } finally {
    close();
  }
});
