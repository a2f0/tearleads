import { expect, test } from "bun:test";
import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { CONTAINER_NOT_FOUND_ERROR_CODE } from "@tearleads/validators/response";
import { loadContainerAccessPath } from "./accessPaths";
import { createContainerWriterProjectionContext } from "./context";
import type { ContainerPathRow } from "./types";

function rowExecutor(
  rows: readonly (ContainerPathRow | null)[],
): DatabaseSession {
  let index = 0;
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            const row = rows[index];
            index += 1;
            return row === null || row === undefined ? [] : [row];
          },
        }),
      }),
    }),
  } as unknown as DatabaseSession;
}

test("container path absence distinguishes the target from an ancestor", async () => {
  const targetExecutor = rowExecutor([null]);
  await expect(
    loadContainerAccessPath(
      createContainerWriterProjectionContext(targetExecutor),
      "missing-target",
    ),
  ).rejects.toMatchObject({
    code: CONTAINER_NOT_FOUND_ERROR_CODE,
    status: 404,
  });

  const ancestorExecutor = rowExecutor([
    {
      id: "child",
      organizationId: "organization-1",
      parentId: "missing-parent",
    },
    null,
  ]);
  await expect(
    loadContainerAccessPath(
      createContainerWriterProjectionContext(ancestorExecutor),
      "child",
    ),
  ).rejects.toMatchObject({
    code: undefined,
    status: 409,
  });
});
