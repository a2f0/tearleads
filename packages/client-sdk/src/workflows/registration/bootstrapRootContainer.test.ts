import { expect, test } from "bun:test";
import { createTestExecSql } from "@symcrypt/test-utils";
import { execSqlClientFromExecSql } from "../../../test/helpers/execSqlClient";
import { loadContainers } from "../../data/persistence/containers/containerPersistence";
import { bootstrapRootContainer } from "./bootstrapRootContainer";

test("bootstrapRootContainer creates one local root container and reuses it", async () => {
  const { close, execSql } = await createTestExecSql(
    "registration-root-container-test",
  );
  const client = execSqlClientFromExecSql(execSql);

  try {
    const created = await bootstrapRootContainer(client);
    expect(created.created).toBe(true);
    expect(created.containerId).toHaveLength(36);

    const reused = await bootstrapRootContainer(client);
    expect(reused).toEqual({
      containerId: created.containerId,
      created: false,
    });

    const containers = await loadContainers(execSql);
    expect(containers).toEqual([
      expect.objectContaining({
        id: created.containerId,
        organizationId: "",
        parentId: null,
        metadataDocumentId: null,
        name: "/",
        icon: null,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      }),
    ]);
  } finally {
    close();
  }
});

test("bootstrapRootContainer serializes concurrent root creation attempts", async () => {
  const { close, execSql } = await createTestExecSql(
    "registration-root-container-concurrent-test",
  );
  const client = execSqlClientFromExecSql(execSql);

  try {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => bootstrapRootContainer(client)),
    );
    const createdResults = results.filter((result) => result.created);
    const rootContainerIds = new Set(
      results.map((result) => result.containerId),
    );

    expect(createdResults).toHaveLength(1);
    expect(rootContainerIds.size).toBe(1);

    const containers = await loadContainers(execSql);
    expect(containers).toHaveLength(1);
    expect(containers[0]?.id).toBe(createdResults[0]?.containerId);
  } finally {
    close();
  }
});
