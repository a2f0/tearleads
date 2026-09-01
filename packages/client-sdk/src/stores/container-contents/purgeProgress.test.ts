import { expect, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import { waitFor } from "../../../test/helpers/waitFor";
import type { DomainScope } from "../../data/domainScope";
import type { PurgeProgress } from "../../workflows/container-contents/container-state/purgeProgress";
import { createContainerContentsStore } from "./containerContentsStore";
import {
  createContainerContentsTestRuntime,
  seedLocalRootContainer,
} from "./runtime.testFixtures";

// These tests drive the real recursive purge engine through the store over an
// in-memory SQLite, but keep every container LOCAL-ONLY (created offline, so
// record.documentId is null). A local-only subtree tears down with no apiClient
// round-trips and no documents, which isolates exactly the new behavior:
// determinate progress, the Empty-Trash "keep the bin" path, and cancellation.

const ROOT_CONTAINER_ID = "purge-progress-root";
const TRASH_SLOT =
  "sys_v1_ccccccccccccccccccccccccccccccccccccccccccc" as ContainerSystemSlot;

async function withOfflineStore(
  body: (
    store: ReturnType<typeof createContainerContentsStore>,
  ) => Promise<void>,
): Promise<void> {
  const { close, execSql } = await createTestExecSql("purge-progress-test");
  try {
    await seedLocalRootContainer(execSql, {
      rootContainerId: ROOT_CONTAINER_ID,
    });
    const runtime = createContainerContentsTestRuntime({
      apiClient: createMockApiClient({
        listContainerParentLanes: async () => null,
      }),
      containerId: ROOT_CONTAINER_ID,
      domainScope: {} as DomainScope,
      execSql,
      online: false,
    });
    const store = createContainerContentsStore(runtime);
    store.updateRuntime(runtime);

    await waitFor(
      () => store.getSnapshot().ready,
      "Container contents store did not become ready.",
      2_000,
    );

    await body(store);
  } finally {
    close();
  }
}

function nodeIds(
  store: ReturnType<typeof createContainerContentsStore>,
): string[] {
  return store.getSnapshot().nodes.map((node) => node.id);
}

async function createChildOrThrow(
  store: ReturnType<typeof createContainerContentsStore>,
  parentId: string,
  name: string,
): Promise<string> {
  const node = await store.createChild(parentId, name);
  if (!node) {
    throw new Error(`Failed to create container "${name}"`);
  }
  return node.id;
}

test("purgeContainer removes the whole subtree and reports determinate progress", async () => {
  await withOfflineStore(async (store) => {
    const a = await createChildOrThrow(store, ROOT_CONTAINER_ID, "A");
    const a1 = await createChildOrThrow(store, a, "A1");
    const a2 = await createChildOrThrow(store, a, "A2");

    const progress: PurgeProgress[] = [];
    const purged = await store.purgeContainer(a, {
      onProgress: (p) => progress.push(p),
    });

    expect(purged).toBe(true);
    const ids = nodeIds(store);
    expect(ids).toContain(ROOT_CONTAINER_ID);
    expect(ids).not.toContain(a);
    expect(ids).not.toContain(a1);
    expect(ids).not.toContain(a2);

    // Three containers, no documents: a determinate 0/3 -> 3/3 bar.
    expect(progress[0]).toEqual({
      completedCount: 0,
      failedCount: 0,
      totalCount: 3,
    });
    expect(progress.at(-1)).toEqual({
      completedCount: 3,
      failedCount: 0,
      totalCount: 3,
    });
  });
});

test("emptyTrash destroys everything under the Trash bin but keeps the bin", async () => {
  await withOfflineStore(async (store) => {
    const trash = await store.ensureSystemContainer(TRASH_SLOT, "Trash", {
      skipAdvancedManagedRoot: true,
    });
    if (!trash) {
      throw new Error("Failed to provision Trash");
    }
    const t1 = await createChildOrThrow(store, trash.id, "Trashed");
    const t1a = await createChildOrThrow(store, t1, "Nested");

    const progress: PurgeProgress[] = [];
    const emptied = await store.emptyTrash(trash.id, {
      onProgress: (p) => progress.push(p),
    });

    expect(emptied).toBe(true);
    const ids = nodeIds(store);
    // The bin survives; everything under it is gone.
    expect(ids).toContain(trash.id);
    expect(ids).not.toContain(t1);
    expect(ids).not.toContain(t1a);

    // Two descendant containers deleted; the bin is excluded from the total.
    expect(progress.at(-1)).toEqual({
      completedCount: 2,
      failedCount: 0,
      totalCount: 2,
    });
  });
});

test("purgeContainer aborts before deleting anything when the signal is already aborted", async () => {
  await withOfflineStore(async (store) => {
    const a = await createChildOrThrow(store, ROOT_CONTAINER_ID, "A");
    const a1 = await createChildOrThrow(store, a, "A1");

    const controller = new AbortController();
    controller.abort();
    const purged = await store.purgeContainer(a, { signal: controller.signal });

    // A cancelled run is not a successful purge, and nothing was destroyed.
    expect(purged).toBe(false);
    const ids = nodeIds(store);
    expect(ids).toContain(a);
    expect(ids).toContain(a1);
  });
});
