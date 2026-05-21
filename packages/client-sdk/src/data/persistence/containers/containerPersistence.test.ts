import { expect, test } from "bun:test";
import { createTestExecSql } from "../../../../test/helpers/createTestExecSql";
import { sqlExplorerPersistence } from "../explorer/explorerPersistence";
import {
  loadContainerDisplayNamesByIds,
  loadContainers,
} from "./containerPersistence";
import { sqlDocumentContainerProjectionPersistence } from "./documentContainerProjectionPersistence";

test("explorer container saves display server timestamps separately from local timestamps", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-persistence-server-timestamps-test",
  );
  const localUpdatedAt = "2026-05-01T00:00:00.000Z";
  const serverCreatedAt = "2026-05-02T00:00:00.000Z";
  const serverUpdatedAt = "2026-05-03T00:00:00.000Z";

  try {
    await sqlExplorerPersistence.ensureSchema(execSql);
    await sqlExplorerPersistence.saveContainer(
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
    await sqlExplorerPersistence.ensureSchema(execSql);
    await sqlExplorerPersistence.saveContainer(
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
    await sqlExplorerPersistence.saveContainer(
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

test("explorer document reassignment folds duplicate links into the target container", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-document-reassignment-conflict-test",
  );

  try {
    await sqlExplorerPersistence.ensureSchema(execSql);
    await sqlDocumentContainerProjectionPersistence.replaceDocumentLinks(
      execSql,
      "document-1",
      ["local-root", "remote-root"],
    );

    await sqlExplorerPersistence.reassignContainerDocuments(execSql, {
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
