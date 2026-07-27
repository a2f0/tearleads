import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { sqlContainerContentsPersistence } from "../container-contents/containerContentsPersistence";
import { sqlDocumentMoveIntentPersistence } from "../container-contents/documentMoveIntentPersistence";
import { sqlDocumentsPersistence } from "../documents/documentsPersistence";
import {
  loadContainerDisplayNamesByIds,
  loadContainers,
} from "./containerPersistence";
import { sqlDocumentContainerProjectionPersistence } from "./documentContainerProjectionPersistence";

const TEST_SYSTEM_SLOT = "sys_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

test("containerContents container saves display server timestamps separately from local timestamps", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-persistence-server-timestamps-test",
  );
  const localUpdatedAt = "2026-05-01T00:00:00.000Z";
  const serverCreatedAt = "2026-05-02T00:00:00.000Z";
  const serverUpdatedAt = "2026-05-03T00:00:00.000Z";

  try {
    await sqlContainerContentsPersistence.ensureSchema(execSql);
    await sqlContainerContentsPersistence.saveContainer(
      execSql,
      {
        id: "container-1",
        effectiveAccessLevel: "admin",
        organizationId: "org-1",
        parentId: null,
        metadataDocumentId: null,
        name: "Server folder",
        icon: null,
      },
      null,
      {
        localUpdatedAt,
        serverTimestamps: {
          createdAt: serverCreatedAt,
          updatedAt: serverUpdatedAt,
        },
      },
    );

    const [loadedContainer] = await loadContainers(execSql);
    expect(loadedContainer?.createdAt).toBe(serverCreatedAt);
    expect(loadedContainer?.updatedAt).toBe(serverUpdatedAt);
    expect(loadedContainer?.localCreatedAt).toBe(localUpdatedAt);
    expect(loadedContainer?.localUpdatedAt).toBe(localUpdatedAt);
    expect(loadedContainer?.serverCreatedAt).toBe(serverCreatedAt);
    expect(loadedContainer?.serverUpdatedAt).toBe(serverUpdatedAt);
  } finally {
    close();
  }
});

test("container display name lookup only returns requested local containers", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-display-name-lookup-test",
  );

  try {
    await sqlContainerContentsPersistence.ensureSchema(execSql);
    await sqlContainerContentsPersistence.saveContainer(
      execSql,
      {
        id: "container-1",
        effectiveAccessLevel: "admin",
        organizationId: "org-1",
        parentId: null,
        metadataDocumentId: null,
        name: "Planning",
        icon: null,
      },
      null,
    );
    await sqlContainerContentsPersistence.saveContainer(
      execSql,
      {
        id: "container-2",
        effectiveAccessLevel: "admin",
        organizationId: "org-1",
        parentId: null,
        metadataDocumentId: null,
        name: "Archive",
        icon: null,
      },
      null,
    );

    const displayNames = await loadContainerDisplayNamesByIds(execSql, [
      "container-1",
      "missing-container",
    ]);

    expect([...displayNames.entries()]).toEqual([["container-1", "Planning"]]);
  } finally {
    close();
  }
});

test("containerContents pending update lookup batches requested container ids", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-pending-update-batch-lookup-test",
  );

  try {
    await sqlContainerContentsPersistence.ensureSchema(execSql);
    await sqlContainerContentsPersistence.enqueuePendingUpdate(execSql, {
      containerId: "container-3",
      partialEndVersionVector: "container-3-end",
      partialStartVersionVector: "container-3-start",
      updateData: "container-3-update",
    });
    await sqlContainerContentsPersistence.enqueuePendingUpdate(execSql, {
      containerId: "container-1",
      partialEndVersionVector: "container-1-end",
      partialStartVersionVector: "container-1-start",
      updateData: "container-1-update",
    });

    await expect(
      sqlContainerContentsPersistence.listContainerIdsWithPendingUpdates(
        execSql,
        ["container-1", "container-1", "container-2", "container-3"],
      ),
    ).resolves.toEqual(["container-1", "container-3"]);
  } finally {
    close();
  }
});

test("root reconciliation folds duplicate document links into the remote root", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-document-reassignment-conflict-test",
  );

  try {
    await sqlContainerContentsPersistence.ensureSchema(execSql);
    await sqlDocumentContainerProjectionPersistence.replaceDocumentLinks(
      execSql,
      "document-1",
      ["local-root", "remote-root"],
    );
    await sqlDocumentMoveIntentPersistence.enqueueMoveIntent(execSql, {
      documentId: "source-document",
      localId: "source-local",
      sourceContainerId: "local-root",
      targetContainerId: "other-container",
    });
    await sqlDocumentMoveIntentPersistence.enqueueMoveIntent(execSql, {
      documentId: "target-document",
      localId: "target-local",
      sourceContainerId: "other-container",
      targetContainerId: "local-root",
    });
    for (const documentId of ["source-document", "target-document"]) {
      await sqlDocumentMoveIntentPersistence.recordMoveIntentError(execSql, {
        blocked: true,
        documentId,
        message: "stale root",
      });
    }

    await sqlContainerContentsPersistence.reconcileLocalRootContainer(execSql, {
      descendantReparents: [],
      localRootContainerId: "local-root",
      remoteOrganizationId: "remote-org",
      remoteRootContainerId: "remote-root",
      updatedAt: "2026-05-21T00:00:00.000Z",
    });

    await expect(
      sqlDocumentContainerProjectionPersistence.listLinkedContainerIds(
        execSql,
        "document-1",
      ),
    ).resolves.toEqual(["remote-root"]);
    await expect(
      execSql(
        `SELECT document_id, source_container_id, target_container_id,
                sync_status, last_error, last_attempted_at
         FROM document_move_intents
         ORDER BY document_id ASC`,
      ),
    ).resolves.toEqual([
      {
        document_id: "source-document",
        last_attempted_at: null,
        last_error: null,
        source_container_id: "remote-root",
        sync_status: "pending",
        target_container_id: "other-container",
      },
      {
        document_id: "target-document",
        last_attempted_at: null,
        last_error: null,
        source_container_id: "other-container",
        sync_status: "pending",
        target_container_id: "remote-root",
      },
    ]);
  } finally {
    close();
  }
});

test("containerContents system container reconciliation adopts local rows into the remote container", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-system-reconciliation-test",
  );

  try {
    await sqlContainerContentsPersistence.ensureSchema(execSql);
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await sqlContainerContentsPersistence.saveContainer(
      execSql,
      {
        id: "remote-system",
        effectiveAccessLevel: "admin",
        organizationId: "remote-org",
        parentId: "remote-root",
        metadataDocumentId: "remote-system",
        systemSlot: TEST_SYSTEM_SLOT,
        name: "Remote system",
        icon: null,
      },
      null,
    );
    await sqlContainerContentsPersistence.saveContainer(
      execSql,
      {
        id: "local-system",
        effectiveAccessLevel: "admin",
        organizationId: "local-org",
        parentId: "local-root",
        metadataDocumentId: null,
        systemSlot: TEST_SYSTEM_SLOT,
        name: "Local system",
        icon: null,
      },
      null,
      {
        createIntent: { parentContainerId: "local-root" },
      },
    );
    await sqlContainerContentsPersistence.saveContainer(
      execSql,
      {
        id: "local-child",
        effectiveAccessLevel: "admin",
        organizationId: "local-org",
        parentId: "local-system",
        metadataDocumentId: null,
        name: "Local child",
        icon: null,
      },
      null,
      {
        createIntent: { parentContainerId: "local-system" },
      },
    );
    await sqlContainerContentsPersistence.enqueuePendingUpdate(execSql, {
      containerId: "local-system",
      partialEndVersionVector: "local-system-end",
      partialStartVersionVector: "local-system-start",
      updateData: "local-system-update",
    });
    await sqlDocumentsPersistence.saveDocument(execSql, {
      accessEpoch: 1,
      accessStateHash: null,
      containerId: "local-system",
      contentKeyBundle: null,
      documentId: "document-1",
      documentKekTargets: null,
      documentKind: "note",
      documentManifestBundle: null,
      id: "document-local-1",
      lastCommitLsn: null,
      snapshotEndVersion: "",
      text: "Hello",
      title: "Hello",
    });
    await sqlDocumentContainerProjectionPersistence.replaceDocumentLinks(
      execSql,
      "document-1",
      ["local-system", "remote-system"],
    );

    await sqlContainerContentsPersistence.reconcileLocalSystemContainer(
      execSql,
      {
        localContainerId: "local-system",
        remoteContainerId: "remote-system",
        remoteOrganizationId: "remote-org",
        updatedAt: "2026-05-21T00:00:00.000Z",
      },
    );

    const loadedContainers = await loadContainers(execSql);
    expect(
      loadedContainers.some((container) => container.id === "local-system"),
    ).toBe(false);
    expect(loadedContainers).toContainEqual(
      expect.objectContaining({
        id: "remote-system",
        systemSlot: TEST_SYSTEM_SLOT,
      }),
    );
    expect(loadedContainers).toContainEqual(
      expect.objectContaining({
        id: "local-child",
        organizationId: "remote-org",
        parentId: "remote-system",
      }),
    );
    await expect(
      sqlDocumentContainerProjectionPersistence.listLinkedContainerIds(
        execSql,
        "document-1",
      ),
    ).resolves.toEqual(["remote-system"]);
    await expect(
      sqlDocumentsPersistence.loadDocument(execSql, "document-local-1"),
    ).resolves.toEqual(
      expect.objectContaining({
        containerId: "remote-system",
      }),
    );
    await expect(
      sqlContainerContentsPersistence.listPendingUpdates(
        execSql,
        "local-system",
      ),
    ).resolves.toEqual([]);
    await expect(
      sqlContainerContentsPersistence.listPendingCreateIntents(execSql),
    ).resolves.toEqual([
      expect.objectContaining({
        containerId: "local-child",
        parentContainerId: "remote-system",
      }),
    ]);
  } finally {
    close();
  }
});
