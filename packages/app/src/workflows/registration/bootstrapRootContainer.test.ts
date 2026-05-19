import { expect, test } from "bun:test";
import { loadContainers } from "@tearleads/client-sdk/data/persistence/containers/containerPersistence";
import type {
  ExecSql,
  ExecSqlClientLike,
} from "@tearleads/client-sdk/data/sqlite/sqlSchema";
import { bootstrapRootContainer } from "@tearleads/client-sdk/workflows/registration/bootstrapRootContainer";
import { createTestExecSql } from "../../../test/helpers/createTestExecSql";

function createBootstrapClient(execSql: ExecSql): ExecSqlClientLike {
  return {
    async exec({ bind, rowMode, sql }) {
      return {
        rows: await execSql(sql, bind, rowMode ? { rowMode } : undefined),
      };
    },
  };
}

test("bootstrapRootContainer creates one local root container and reuses it", async () => {
  const { close, execSql } = await createTestExecSql(
    "registration-root-container-test",
  );
  const client = createBootstrapClient(execSql);

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
  const client = createBootstrapClient(execSql);

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
