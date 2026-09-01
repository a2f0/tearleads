import { expect, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import { sqlContainerContentsPersistence } from "../../../data/persistence/container-contents/containerContentsPersistence";
import { createTestContainerState } from "./containerState.testFixtures";
import { deleteContainerState } from "./delete";
import type { ContainerWorkflowRuntime } from "./types";

const T2 = "2026-01-01T00:00:02.000Z";
const T3 = "2026-01-01T00:00:03.000Z";
const T4 = "2026-01-01T00:00:04.000Z";

test("remote deletion uses the server clock for its hydration fence", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-delete-server-clock",
  );
  const containerState = createTestContainerState({
    id: "container-1",
    parentId: "parent-1",
  });
  const runtime = {
    apiClient: createMockApiClient({
      deleteContainerResult: async (containerId: string) => ({
        data: { containerId, deletedAt: T3 },
        ok: true,
      }),
    }),
    infra: { execSql },
  } as unknown as ContainerWorkflowRuntime;

  try {
    await sqlContainerContentsPersistence.ensureSchema(execSql);
    containerState.container =
      await sqlContainerContentsPersistence.saveContainer(
        execSql,
        containerState.container,
        containerState.record,
        {
          localUpdatedAt: T2,
          serverTimestamps: { createdAt: T2, updatedAt: T2 },
        },
      );
    await expect(
      deleteContainerState({
        containerState,
        persistence: sqlContainerContentsPersistence,
        runtime,
      }),
    ).resolves.toBe("deleted");

    const hydrate = (updatedAt: string) =>
      sqlContainerContentsPersistence.commitHydratedContainer(execSql, {
        container: {
          ...containerState.container,
          serverUpdatedAt: updatedAt,
        },
        expectedDormantRecord: null,
        purgeDormantMetadata: false,
        record: containerState.record,
        remoteUpdatedAt: updatedAt,
        saveOptions: {},
      });

    await expect(hydrate(T2)).resolves.toEqual({ committed: false });
    await expect(hydrate(T4)).resolves.toMatchObject({ committed: true });
  } finally {
    await close();
  }
});
