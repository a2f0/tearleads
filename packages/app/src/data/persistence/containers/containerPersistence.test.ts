import { expect, test } from "bun:test";
import { createTestExecSql } from "../../../../test/helpers/createTestExecSql";
import {
  ensureContainerTables,
  loadContainers,
  saveContainer,
} from "./containerPersistence";

test("ensureContainerTables backfills and preserves container creation timestamps", async () => {
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
    expect(renamedContainer?.updatedAt).not.toBe(existingUpdatedAt);
  } finally {
    close();
  }
});
