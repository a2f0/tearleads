import { expect, test } from "bun:test";
import { createTestExecSql } from "../../../../test/helpers/createTestExecSql";
import { sqlContainerContentsPersistence } from "../container-contents/containerContentsPersistence";
import {
  loadContainerDisplayNamesByIds,
  loadContainers,
} from "./containerPersistence";
import { sqlDocumentContainerProjectionPersistence } from "./documentContainerProjectionPersistence";

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

test("containerContents document reassignment folds duplicate links into the target container", async () => {
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

    await sqlContainerContentsPersistence.reassignContainerDocuments(execSql, {
      fromContainerId: "local-root",
      toContainerId: "remote-root",
      updatedAt: "2026-05-21T00:00:00.000Z",
    });

    await expect(
      sqlDocumentContainerProjectionPersistence.listLinkedContainerIds(
        execSql,
        "document-1",
      ),
    ).resolves.toEqual(["remote-root"]);
  } finally {
    close();
  }
});
