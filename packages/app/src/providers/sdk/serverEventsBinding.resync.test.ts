import { expect, test } from "bun:test";
import type { Tearleads } from "@tearleads/client-sdk";
import { resyncContainerAccess } from "./serverEventsBinding";

interface EnqueueCall {
  containerId: string;
  scope: string;
  force: boolean;
}

interface RefreshRootLaneOptions {
  parentIds?: ReadonlyArray<string | null> | undefined;
}

interface TreeNode {
  id: string;
  parentId: string | null;
}

function createResyncHarness(options?: {
  nodes?: TreeNode[];
  throwOnReconciler?: boolean;
  throwOnOpenTree?: boolean;
}) {
  const enqueueCalls: EnqueueCall[] = [];
  const refreshCalls: string[] = [];
  const refreshRootLaneOptions: (RefreshRootLaneOptions | undefined)[] = [];
  const nodes = options?.nodes ?? [];

  const openTree = () => {
    if (options?.throwOnOpenTree) {
      throw new Error("runtime not ready");
    }
    return {
      getSnapshot: () => ({ nodes }),
      refresh: () => {
        refreshCalls.push("refresh");
        return Promise.resolve(false);
      },
      refreshRootLane: (rootLaneOptions?: RefreshRootLaneOptions) => {
        refreshCalls.push("refreshRootLane");
        refreshRootLaneOptions.push(rootLaneOptions);
        return Promise.resolve(true);
      },
    };
  };

  const reconciler = () => {
    return {
      enqueueContainer: (
        containerId: string,
        scope: string,
        force: boolean,
      ) => {
        if (options?.throwOnReconciler) {
          throw new Error("runtime not ready");
        }
        enqueueCalls.push({ containerId, force, scope });
      },
    };
  };

  const tearleads = {
    deviceFirst: {
      open: () => ({
        containerStore: openTree(),
        reconciler: reconciler(),
      }),
    },
  } as unknown as Tearleads;

  return { enqueueCalls, refreshCalls, refreshRootLaneOptions, tearleads };
}

test("resync_required re-validates only the flagged container via the reconciler", async () => {
  const { enqueueCalls, tearleads } = createResyncHarness();

  await resyncContainerAccess(tearleads, "container-1");

  // The scoped re-validation is what actually drops a now-unauthorized container
  // (revocation) or re-syncs a still-authorized one — it must target exactly the
  // flagged container, forced, in the active scope.
  expect(enqueueCalls).toEqual([
    { containerId: "container-1", force: true, scope: "active" },
  ]);
});

test("resync_required re-lists the root lane, not the whole tree", async () => {
  const { refreshCalls, tearleads } = createResyncHarness();

  await resyncContainerAccess(tearleads, "container-1");

  // A single access change must not trigger the all-parent-lanes crawl
  // (openTree().refresh(), reserved for explicit user refresh); it re-lists the
  // root lane. Regressing to refresh() is what caused the membership-change
  // request storm (#1281).
  expect(refreshCalls).toEqual(["refreshRootLane"]);
});

test("resync_required for a nested container also re-lists its parent lane", async () => {
  // A deleted nested container's tombstone is returned only by its parent lane
  // (rootDiscoveryVisible=false), never the root lane, so the resync must re-list
  // that parent lane to apply the tombstone and drop the stale container.
  const { refreshRootLaneOptions, tearleads } = createResyncHarness({
    nodes: [
      { id: "root", parentId: null },
      { id: "nested", parentId: "root" },
    ],
  });

  await resyncContainerAccess(tearleads, "nested");

  expect(refreshRootLaneOptions).toEqual([{ parentIds: ["root"] }]);
});

test("resync_required for a top-level container adds no parent lane", async () => {
  // A top-level container's tombstone IS returned by the root lane (parentId null
  // or rootDiscoveryVisible=true), so no extra parent lane is needed.
  const { refreshRootLaneOptions, tearleads } = createResyncHarness({
    nodes: [{ id: "root", parentId: null }],
  });

  await resyncContainerAccess(tearleads, "root");

  expect(refreshRootLaneOptions).toEqual([undefined]);
});

test("resync_required for an unknown container adds no parent lane", async () => {
  // The flagged container is not in the local tree (nothing to remove locally);
  // re-list only the root lane so a new top-level grant still surfaces.
  const { refreshRootLaneOptions, tearleads } = createResyncHarness({
    nodes: [{ id: "root", parentId: null }],
  });

  await resyncContainerAccess(tearleads, "unknown");

  expect(refreshRootLaneOptions).toEqual([undefined]);
});

test("resync_required still re-lists the root lane when the reconciler is unavailable", async () => {
  const { enqueueCalls, refreshCalls, tearleads } = createResyncHarness({
    throwOnReconciler: true,
  });

  await resyncContainerAccess(tearleads, "container-1");

  expect(enqueueCalls).toEqual([]);
  expect(refreshCalls).toEqual(["refreshRootLane"]);
});

test("resync_required tolerates a not-ready container tree", async () => {
  const { refreshCalls, tearleads } = createResyncHarness({
    throwOnOpenTree: true,
  });

  await expect(
    resyncContainerAccess(tearleads, "container-1"),
  ).resolves.toBeUndefined();
  expect(refreshCalls).toEqual([]);
});
