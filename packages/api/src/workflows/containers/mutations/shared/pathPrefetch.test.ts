import { expect, test } from "bun:test";
import {
  db,
  withDatabaseStatementCounter,
} from "@tearleads/api-shared/postgres";
import { accessManifestHeads } from "@tearleads/api-shared/schema";
import { and, eq } from "drizzle-orm";
import { createOwnedTree } from "../../../../../test/helpers/ownedContainerTree";
import {
  createContainerWriterProjectionContext,
  resolveContainerAccessProjection,
} from "../../writerProjection";
import type { ContainerMutationContext } from "../types";
import { assertCurrentContainerPath } from "./manifests";

test("mutation paths reload current heads as one set after clearing the pre-lock cache", async () => {
  const tree = await createOwnedTree(0);
  try {
    const child = await tree.createChild(tree.rootId);
    const leaf = await tree.createChild(child);
    const access = await resolveContainerAccessProjection({
      containerId: leaf,
      executor: db,
      minimumAccessLevel: "read",
      userId: tree.owner.userId,
    });
    const refs = access.verifiedPath.map((manifest) => ({
      containerId: manifest.state.containerId,
      manifestHash: manifest.manifestHash,
    }));
    await db.transaction(async (executor) => {
      const context: ContainerMutationContext = {
        executor,
        manifestHeadByContainerId: new Map(),
        verifiedManifestByHash: new Map(),
        writerProjectionContext:
          createContainerWriterProjectionContext(executor),
      };
      const initialCounter = { statements: 0 };
      const initial = await withDatabaseStatementCounter(initialCounter, () =>
        assertCurrentContainerPath(context, refs, "path"),
      );
      expect(initial).toEqual(access.verifiedPath);
      context.manifestHeadByContainerId.clear();
      const counter = { statements: 0 };
      expect(
        await withDatabaseStatementCounter(counter, () =>
          assertCurrentContainerPath(context, refs, "path"),
        ),
      ).toEqual(initial);
      console.info("mutation-path", {
        initial: initialCounter.statements,
        recheck: counter.statements,
      });
      expect(counter.statements).toBe(2);
      // Simulate a head changing before the post-lock verification: no cached
      // current head from the first check can authorize the second one.
      const original = refs[0];
      if (!original) throw new Error("Expected root reference");
      await executor
        .update(accessManifestHeads)
        .set({ manifestHash: "changed-head" })
        .where(
          and(
            eq(accessManifestHeads.objectKind, "container"),
            eq(accessManifestHeads.objectId, original.containerId),
          ),
        );
      context.manifestHeadByContainerId.clear();
      await expect(
        assertCurrentContainerPath(context, refs, "path"),
      ).rejects.toThrow("manifest head is stale");
      await executor
        .update(accessManifestHeads)
        .set({ manifestHash: original.manifestHash })
        .where(
          and(
            eq(accessManifestHeads.objectKind, "container"),
            eq(accessManifestHeads.objectId, original.containerId),
          ),
        );
    });
  } finally {
    tree.close();
  }
}, 180_000);
