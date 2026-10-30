import { expect, test } from "bun:test";
import {
  db,
  withDatabaseStatementCounter,
} from "@tearleads/api-shared/postgres";
import { containers } from "@tearleads/api-shared/schema";
import { CONTAINER_NOT_FOUND_ERROR_CODE } from "@tearleads/validators/response";
import { inArray } from "drizzle-orm";
import {
  resolveContainerAccessProjection,
  resolveContainerAccessProjectionBatch,
} from "../writerProjection";
import { prefetchContainerAccessPaths } from "./accessPaths";
import { createContainerWriterProjectionContext } from "./context";

async function singleError(containerId: string, userId: string) {
  try {
    await resolveContainerAccessProjection({
      containerId,
      executor: db,
      minimumAccessLevel: "read",
      userId,
    });
  } catch (error) {
    return error;
  }
  throw new Error("Expected the single walk to fail");
}

test("the prefetched batch walk refuses missing rows and heads as the single walk does", async () => {
  const organizationId = crypto.randomUUID();
  const orphanId = crypto.randomUUID();
  const headlessId = crypto.randomUUID();
  const unknownId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  await db.insert(containers).values([
    { id: orphanId, organizationId, parentId: crypto.randomUUID() },
    { id: headlessId, organizationId, parentId: null },
  ]);
  try {
    const results = await resolveContainerAccessProjectionBatch({
      containerIds: [orphanId, headlessId, unknownId],
      executor: db,
      minimumAccessLevel: "read",
      userId,
    });
    const expected = {
      [orphanId]: { message: "Container path ancestor not found", status: 409 },
      [headlessId]: { message: "Container manifest head missing", status: 409 },
      [unknownId]: {
        code: CONTAINER_NOT_FOUND_ERROR_CODE,
        message: "Container not found",
        status: 404,
      },
    };
    for (const [containerId, refusal] of Object.entries(expected)) {
      const result = results.get(containerId);
      if (result?.status !== "rejected") throw new Error("Expected a refusal");
      expect(result.reason).toMatchObject(refusal);
      expect(await singleError(containerId, userId)).toEqual(result.reason);
    }
  } finally {
    await db
      .delete(containers)
      .where(inArray(containers.id, [orphanId, headlessId]));
  }
});

test("the path prefetch reads ids in chunks of 500 and caches only rows it found", async () => {
  const containerIds = Array.from({ length: 600 }, () => crypto.randomUUID());
  const context = createContainerWriterProjectionContext(db);
  const counter = { statements: 0 };
  await withDatabaseStatementCounter(counter, () =>
    prefetchContainerAccessPaths(context, containerIds),
  );
  expect(counter.statements).toBe(2);
  expect(context.containerPathRowById.size).toBe(0);
  expect(context.currentManifestBundleByContainerId.size).toBe(0);
});
