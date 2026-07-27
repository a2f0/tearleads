import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { sqlDocumentContainerProjectionPersistence } from "../containers/documentContainerProjectionPersistence";
import {
  applyContainerDocumentTombstones,
  sqlDocumentsPersistence,
} from "./documentsPersistence";

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
