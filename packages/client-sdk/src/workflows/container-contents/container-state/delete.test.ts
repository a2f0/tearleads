import { expect, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import { CONTAINER_NOT_FOUND_ERROR_CODE } from "@tearleads/validators/response";
import { sqlContainerContentsPersistence } from "../../../data/persistence/container-contents/containerContentsPersistence";
import { createTestContainerState } from "./containerState.testFixtures";
import { deleteContainerState } from "./delete";
import { deleteRemoteContainer } from "./remote";
import type { ContainerWorkflowRuntime } from "./types";

const T2 = "2026-01-01T00:00:02.000Z";
const T3 = "2026-01-01T00:00:03.000Z";
const T4 = "2026-01-01T00:00:04.000Z";

test("remote deletion fences only an exactly coded missing container", async () => {
  let reports = 0;
  const requestedOrganizationIds: (string | undefined)[] = [];
  const result = (code?: string, status = 404) => ({
    ...(code === undefined ? {} : { code }),
    kind: "http" as const,
    message: "delete failed",
    method: "DELETE" as const,
    ok: false as const,
    path: "/containers/container-1",
    report: () => {
      reports += 1;
    },
    status,
    statusText: "Not Found",
  });
  const runtime = (code?: string, status?: number) =>
    ({
      apiClient: {
        deleteContainerResult: async (
          _containerId: string,
          options?: { expectedPaymentRequiredOrganizationId?: string },
        ) => {
          requestedOrganizationIds.push(
            options?.expectedPaymentRequiredOrganizationId,
          );
          return result(code, status);
        },
      },
    }) as unknown as ContainerWorkflowRuntime;

  await expect(
    deleteRemoteContainer({
      containerId: "container-1",
      organizationId: "organization-1",
      runtime: runtime(CONTAINER_NOT_FOUND_ERROR_CODE),
    }),
  ).resolves.toEqual({ deletedAt: "9999-12-31T23:59:59.999Z" });

  for (const [code, status] of [
    [undefined, 404],
    ["unknown_code", 404],
    [` ${CONTAINER_NOT_FOUND_ERROR_CODE} `, 404],
    [CONTAINER_NOT_FOUND_ERROR_CODE, 409],
  ] as const) {
    await expect(
      deleteRemoteContainer({
        containerId: "container-1",
        organizationId: "organization-1",
        runtime: runtime(code, status),
      }),
    ).resolves.toBeNull();
  }
  expect(reports).toBe(4);
  expect(requestedOrganizationIds).toEqual(
    Array.from({ length: 5 }, () => "organization-1"),
  );
});

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
