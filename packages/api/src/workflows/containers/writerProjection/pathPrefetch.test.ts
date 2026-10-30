import { expect, test } from "bun:test";
import {
  db,
  withDatabaseStatementCounter,
} from "@tearleads/api-shared/postgres";
import {
  accessManifestHeads,
  accessManifests,
  containers,
} from "@tearleads/api-shared/schema";
import { CONTAINER_NOT_FOUND_ERROR_CODE } from "@tearleads/validators/response";
import { and, eq, inArray } from "drizzle-orm";
import { createOwnedTree } from "../../../../test/helpers/ownedContainerTree";
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

async function headManifestHash(containerId: string): Promise<string> {
  const [head] = await db
    .select({ manifestHash: accessManifestHeads.manifestHash })
    .from(accessManifestHeads)
    .where(
      and(
        eq(accessManifestHeads.objectKind, "container"),
        eq(accessManifestHeads.objectId, containerId),
      ),
    );
  if (!head) throw new Error("Expected a container head");
  return head.manifestHash;
}

test("an unreadable or incomplete bundle refuses only its own containers in a prefetched batch", async () => {
  const tree = await createOwnedTree(0);
  try {
    const healthy = await tree.createChild(tree.rootId);
    const malformed = await tree.createChild(tree.rootId);
    const malformedChild = await tree.createChild(malformed);
    const incomplete = await tree.createChild(tree.rootId);
    await db
      .update(accessManifests)
      .set({ state: [] })
      .where(
        eq(accessManifests.manifestHash, await headManifestHash(malformed)),
      );
    const incompleteHash = await headManifestHash(incomplete);
    await db
      .update(accessManifests)
      .set({ eventHash: `missing-${crypto.randomUUID()}` })
      .where(eq(accessManifests.manifestHash, incompleteHash));
    // An orphan whose walk stops at its missing parent, before its head.
    const orphan = crypto.randomUUID();
    await db.insert(containers).values({
      id: orphan,
      organizationId: tree.organizationId,
      parentId: crypto.randomUUID(),
    });
    await db.insert(accessManifestHeads).values({
      epoch: 1,
      manifestHash: incompleteHash,
      objectId: orphan,
      objectKind: "container",
      organizationId: tree.organizationId,
    });

    const userId = tree.owner.userId;
    const results = await resolveContainerAccessProjectionBatch({
      containerIds: [tree.rootId, healthy, malformed, malformedChild, orphan],
      executor: db,
      minimumAccessLevel: "read",
      userId,
    });
    expect(results.get(tree.rootId)?.status).toBe("fulfilled");
    expect(results.get(healthy)?.status).toBe("fulfilled");
    for (const containerId of [malformed, malformedChild, orphan]) {
      const result = results.get(containerId);
      if (result?.status !== "rejected") throw new Error("Expected a refusal");
      expect(await singleError(containerId, userId)).toEqual(result.reason);
    }

    // A missing event fails the batch as the walk that reaches it always has,
    // not earlier: the prefetch leaves the bundle for that walk to reload.
    const single = await singleError(incomplete, userId);
    await expect(
      resolveContainerAccessProjectionBatch({
        containerIds: [healthy, incomplete],
        executor: db,
        minimumAccessLevel: "read",
        userId,
      }),
    ).rejects.toEqual(single);
  } finally {
    tree.close();
  }
}, 180_000);
