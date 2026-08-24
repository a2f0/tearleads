import { expect, test } from "bun:test";
import { createTestExecSql } from "@symcrypt/test-utils";
import { sqlDocumentContainerProjectionPersistence } from "../containers/documentContainerProjectionPersistence";
import {
  applyContainerDocumentTombstones,
  sqlDocumentsPersistence,
} from "./documentsPersistence";

test("document creation rolls back rows and queue when its projection fails", async () => {
  const { close, execSql } = await createTestExecSql(
    "documents-persistence-create-projection-rollback",
  );
  const document = {
    accessEpoch: 1,
    containerId: "container-1",
    documentId: null,
    id: "local-document-1",
    snapshotEndVersion: "end-version-1",
    text: "Created offline",
  };
  const historyCheckpoint = {
    endVersionVector: "end-version-1",
    snapshot: "snapshot-1",
  };
  const options = {
    pendingUpdate: {
      partialEndVersionVector: "end-version-1",
      partialStartVersionVector: "start-version-1",
      sourceVersionVector: null,
      updateData: "update-1",
    },
  };

  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await expect(
      sqlDocumentsPersistence.createDocumentWithHistoryCheckpoint(
        execSql,
        document,
        historyCheckpoint,
        options,
        async (transactionExecSql) => {
          await transactionExecSql(
            'CREATE TABLE IF NOT EXISTS "failed_projection" ("local_id" TEXT PRIMARY KEY)',
          );
          await transactionExecSql(
            'INSERT INTO "failed_projection" ("local_id") VALUES (?)',
            [document.id],
          );
          throw new Error("projection failed");
        },
      ),
    ).rejects.toThrow("projection failed");
    await expect(
      sqlDocumentsPersistence.loadDocument(execSql, document.id),
    ).resolves.toBeNull();
    await expect(
      sqlDocumentsPersistence.listPendingUpdates(execSql, document.id),
    ).resolves.toEqual([]);

    await expect(
      sqlDocumentsPersistence.createDocumentWithHistoryCheckpoint(
        execSql,
        document,
        historyCheckpoint,
        options,
        async (transactionExecSql) => {
          await transactionExecSql(
            'CREATE TABLE IF NOT EXISTS "successful_projection" ("local_id" TEXT PRIMARY KEY)',
          );
          await transactionExecSql(
            'INSERT INTO "successful_projection" ("local_id") VALUES (?)',
            [document.id],
          );
        },
      ),
    ).resolves.not.toBeNull();
    await expect(
      sqlDocumentsPersistence.loadDocument(execSql, document.id),
    ).resolves.toMatchObject(document);
    await expect(
      sqlDocumentsPersistence.listPendingUpdates(execSql, document.id),
    ).resolves.toHaveLength(1);
  } finally {
    close();
  }
});

test("saveDocumentAndDeletePendingUpdates saves document rows and clears accepted updates", async () => {
  const { close, execSql } = await createTestExecSql(
    "documents-persistence-sync-save-test",
  );

  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await sqlDocumentsPersistence.enqueuePendingUpdate(execSql, {
      localId: "local-document-1",
      partialEndVersionVector: "end-1",
      partialStartVersionVector: "start-1",
      sourceVersionVector: null,
      updateData: "update-1",
    });
    await sqlDocumentsPersistence.enqueuePendingUpdate(execSql, {
      localId: "local-document-1",
      partialEndVersionVector: "end-2",
      partialStartVersionVector: "start-2",
      sourceVersionVector: null,
      updateData: "update-2",
    });
    const pendingUpdates = await sqlDocumentsPersistence.listPendingUpdates(
      execSql,
      "local-document-1",
    );
    const acceptedUpdate = pendingUpdates[0];
    const retainedUpdate = pendingUpdates[1];
    if (!acceptedUpdate || !retainedUpdate) {
      throw new Error("Expected two pending updates to be enqueued.");
    }

    await expect(
      sqlDocumentsPersistence.saveDocumentAndDeletePendingUpdates(
        execSql,
        {
          accessEpoch: 2,
          accessStateHash: "access-state-hash-2",
          containerId: "container-1",
          documentId: "remote-document-1",
          documentKekTargets: "document-kek-targets-2",
          documentManifestBundle: "document-manifest-bundle-2",
          contentKeyBundle: "content-key-bundle-2",
          id: "local-document-1",
          lastCommitLsn: "0/16B6C50",
          snapshotEndVersion: "end-version-2",
          text: "Saved text",
        },
        [acceptedUpdate.id, acceptedUpdate.id, "missing"],
        { updatedAt: "2026-05-07T00:00:00.000Z" },
      ),
    ).resolves.toBe("2026-05-07T00:00:00.000Z");

    await expect(
      sqlDocumentsPersistence.listPendingUpdates(execSql, "local-document-1"),
    ).resolves.toEqual([retainedUpdate]);
    await expect(
      sqlDocumentsPersistence.loadDocument(execSql, "local-document-1"),
    ).resolves.toMatchObject({
      accessEpoch: 2,
      accessStateHash: "access-state-hash-2",
      containerId: "container-1",
      documentId: "remote-document-1",
      documentKekTargets: "document-kek-targets-2",
      documentManifestBundle: "document-manifest-bundle-2",
      contentKeyBundle: "content-key-bundle-2",
      id: "local-document-1",
      lastCommitLsn: "0/16B6C50",
      snapshotEndVersion: "end-version-2",
      text: "Saved text",
    });
  } finally {
    close();
  }
});

test("commitDocumentMutation aborts a stale generation before durable writes", async () => {
  const { close, execSql } = await createTestExecSql(
    "documents-persistence-stale-generation",
  );
  const currentDocument = {
    accessEpoch: 1,
    containerId: "container-1",
    documentId: "remote-document-1",
    id: "local-document-1",
    snapshotEndVersion: "before",
    text: "before",
  };

  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await sqlDocumentsPersistence.saveDocument(execSql, currentDocument);

    await expect(
      sqlDocumentsPersistence.commitDocumentMutation(
        execSql,
        {
          acceptedPendingUpdateIds: [],
          document: {
            ...currentDocument,
            snapshotEndVersion: "after",
            text: "stale write",
          },
          expectedRecord: currentDocument,
          pendingUpdate: {
            partialEndVersionVector: "after",
            partialStartVersionVector: "before",
            sourceVersionVector: null,
            updateData: "c3RhbGUtdXBkYXRl",
          },
          settleAcceptedPendingOnConflict: false,
          stillCurrent: () => false,
        },
        async () => {
          throw new Error("A stale mutation must not save its projection");
        },
      ),
    ).resolves.toMatchObject({
      committed: false,
      currentRecord: currentDocument,
    });
    await expect(
      sqlDocumentsPersistence.loadDocument(execSql, currentDocument.id),
    ).resolves.toMatchObject(currentDocument);
    await expect(
      sqlDocumentsPersistence.listPendingUpdates(execSql, currentDocument.id),
    ).resolves.toEqual([]);
  } finally {
    close();
  }
});

test("commitDocumentMutation settles accepted ids only in its document scope", async () => {
  const { close, execSql } = await createTestExecSql(
    "documents-persistence-accepted-scope",
  );
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const documentA = {
      accessEpoch: 1,
      containerId: "container-1",
      documentId: "remote-a",
      id: "local-a",
      snapshotEndVersion: "version-a",
      text: "A",
    };
    await sqlDocumentsPersistence.saveDocument(execSql, documentA);
    await sqlDocumentsPersistence.saveDocument(execSql, {
      ...documentA,
      documentId: "remote-b",
      id: "local-b",
      snapshotEndVersion: "version-b",
      text: "B",
    });
    await sqlDocumentsPersistence.enqueuePendingUpdate(execSql, {
      localId: "local-a",
      partialEndVersionVector: "end-a",
      partialStartVersionVector: "start-a",
      sourceVersionVector: null,
      updateData: "update-a",
    });
    await sqlDocumentsPersistence.enqueuePendingUpdate(execSql, {
      localId: "local-b",
      partialEndVersionVector: "end-b",
      partialStartVersionVector: "start-b",
      sourceVersionVector: null,
      updateData: "update-b",
    });
    const storedA = await sqlDocumentsPersistence.loadDocument(
      execSql,
      "local-a",
    );
    if (!storedA) throw new Error("Expected stored document A");
    const acceptedA = (
      await sqlDocumentsPersistence.listPendingUpdates(execSql, "local-a")
    )[0]?.id;
    const foreignB = (
      await sqlDocumentsPersistence.listPendingUpdates(execSql, "local-b")
    )[0]?.id;
    if (!acceptedA || !foreignB) throw new Error("Expected pending updates");

    await expect(
      sqlDocumentsPersistence.commitDocumentMutation(
        execSql,
        {
          acceptedPendingUpdateIds: [acceptedA, foreignB],
          document: storedA,
          expectedRecord: storedA,
          settleAcceptedPendingOnConflict: false,
        },
        async () => {},
      ),
    ).resolves.toMatchObject({ committed: true });
    await expect(
      sqlDocumentsPersistence.listPendingUpdates(execSql, "local-a"),
    ).resolves.toEqual([]);
    await expect(
      sqlDocumentsPersistence.listPendingUpdates(execSql, "local-b"),
    ).resolves.toHaveLength(1);
  } finally {
    close();
  }
});

test("container document tombstones remove links and repair selected container", async () => {
  const { close, execSql } = await createTestExecSql(
    "documents-persistence-test",
  );

  try {
    await sqlDocumentContainerProjectionPersistence.replaceDocumentLinksBatch(
      execSql,
      [
        {
          containerIds: ["container-a", "container-b"],
          documentId: "document-1",
        },
      ],
    );
    await sqlDocumentsPersistence.upsertDiscoveredDocument(execSql, {
      accessEpoch: 1,
      accessStateHash: "access-state-hash-1",
      containerId: "container-a",
      createdAt: "2026-05-05T00:00:00.000Z",
      documentId: "document-1",
      linkedContainerIds: ["container-a", "container-b"],
    });

    await expect(
      applyContainerDocumentTombstones(execSql, [
        {
          containerId: "container-a",
          documentId: "document-1",
          updatedAt: "2026-05-05T00:05:00.000Z",
        },
      ]),
    ).resolves.toEqual([
      {
        accessStateHash: "access-state-hash-1",
        containerId: "container-b",
        documentId: "document-1",
        documentKind: "note",
        effectiveAccessLevel: "read",
        id: "document-1",
        title: "Syncing document...",
        updatedAt: "2026-05-05T00:05:00.000Z",
      },
    ]);
    await expect(
      sqlDocumentContainerProjectionPersistence.listLinkedContainerIds(
        execSql,
        "document-1",
      ),
    ).resolves.toEqual(["container-b"]);
    await expect(
      sqlDocumentsPersistence.loadDocument(execSql, "document-1"),
    ).resolves.toMatchObject({
      containerId: "container-b",
      documentId: "document-1",
    });

    await expect(
      applyContainerDocumentTombstones(execSql, [
        {
          containerId: "container-b",
          documentId: "document-1",
          updatedAt: "2026-05-05T00:10:00.000Z",
        },
      ]),
    ).resolves.toEqual([
      {
        accessStateHash: "access-state-hash-1",
        containerId: null,
        documentId: "document-1",
        documentKind: "note",
        effectiveAccessLevel: "read",
        id: "document-1",
        title: "Syncing document...",
        updatedAt: "2026-05-05T00:10:00.000Z",
      },
    ]);
    await expect(
      sqlDocumentContainerProjectionPersistence.listLinkedContainerIds(
        execSql,
        "document-1",
      ),
    ).resolves.toEqual([]);
    await expect(
      sqlDocumentsPersistence.loadDocument(execSql, "document-1"),
    ).resolves.toMatchObject({
      containerId: null,
      documentId: "document-1",
    });
  } finally {
    close();
  }
});
