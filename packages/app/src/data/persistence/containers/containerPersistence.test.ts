import { expect, test } from "bun:test";
import { createTestExecSql } from "../../../../test/helpers/createTestExecSql";
import { sqlExplorerPersistence } from "../explorer/explorerPersistence";
import { loadContainers } from "./containerPersistence";

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
