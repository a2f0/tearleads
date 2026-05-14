import { expect, test } from "bun:test";
import { createTestExecSql } from "../../../../test/helpers/createTestExecSql";
import { sqlExplorerPersistence } from "../explorer/explorerPersistence";
import {
  ensureContainerTables,
  loadContainers,
  saveContainer,
} from "./containerPersistence";

test("ensureContainerTables backfills local container timestamps and preserves server fields", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-persistence-created-at-test",
  );
  const existingUpdatedAt = "2026-05-01T00:00:00.000Z";

  try {
    await execSql(`
      CREATE TABLE containers (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        parent_id TEXT,
        metadata_document_id TEXT,
        updated_at TEXT NOT NULL
      )
    `);
    await execSql(`
      CREATE TABLE container_projection (
        container_id TEXT PRIMARY KEY,
        display_name TEXT,
        icon TEXT,
        updated_at TEXT NOT NULL
      )
    `);
    await execSql(
      `
        INSERT INTO containers (
          id,
          organization_id,
          parent_id,
          metadata_document_id,
          updated_at
        )
        VALUES (
          'container-1',
          'org-1',
          NULL,
          NULL,
          :updatedAt
        )
      `,
      { ":updatedAt": existingUpdatedAt },
    );
    await execSql(
      `
        INSERT INTO container_projection (
          container_id,
          display_name,
          icon,
          updated_at
        )
        VALUES (
          'container-1',
          'Original',
          NULL,
          :updatedAt
        )
      `,
      { ":updatedAt": existingUpdatedAt },
    );

    await ensureContainerTables(execSql);

    const [loadedContainer] = await loadContainers(execSql);
    expect(loadedContainer?.createdAt).toBe(existingUpdatedAt);
    expect(loadedContainer?.localCreatedAt).toBe(existingUpdatedAt);
    expect(loadedContainer?.localUpdatedAt).toBe(existingUpdatedAt);
    expect(loadedContainer?.serverCreatedAt).toBeNull();
    expect(loadedContainer?.serverUpdatedAt).toBeNull();
    expect(loadedContainer?.updatedAt).toBe(existingUpdatedAt);

    await saveContainer(execSql, {
      id: "container-1",
      organizationId: "org-1",
      parentId: null,
      metadataDocumentId: null,
      name: "Renamed",
      icon: null,
    });

    const [renamedContainer] = await loadContainers(execSql);
    expect(renamedContainer?.createdAt).toBe(existingUpdatedAt);
    expect(renamedContainer?.localCreatedAt).toBe(existingUpdatedAt);
    expect(renamedContainer?.localUpdatedAt).not.toBe(existingUpdatedAt);
    expect(renamedContainer?.serverCreatedAt).toBeNull();
    expect(renamedContainer?.serverUpdatedAt).toBeNull();
    expect(renamedContainer?.updatedAt).not.toBe(existingUpdatedAt);
  } finally {
    close();
  }
});

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
