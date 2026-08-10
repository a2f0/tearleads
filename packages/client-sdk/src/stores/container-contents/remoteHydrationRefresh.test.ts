import { expect, test } from "bun:test";
import {
  type RefreshRootContainerLike,
  refreshRootRemoteHydration,
} from "./remoteHydrationRefresh";

type RefreshOptions = Parameters<
  Parameters<typeof refreshRootRemoteHydration>[0]["requestHydration"]
>[0];

function serverRootContainer(input: {
  id: string;
  organizationId: string | null;
}) {
  return {
    container: {
      id: input.id,
      metadataDocumentId: `${input.id}-metadata`,
      organizationId: input.organizationId,
      parentId: null,
    },
  };
}

function localOnlyRootContainer(id: string) {
  return {
    container: {
      id,
      metadataDocumentId: null,
      organizationId: "",
      parentId: null,
    },
  };
}

function readyRefreshState(
  containerId: string | null = "root-container",
  options: {
    containers?: ReadonlyArray<[string, RefreshRootContainerLike]>;
    organizationId?: string | null;
  } = {},
) {
  return {
    containerParentIdsNeedingHydration: new Set<string | null>(),
    containersById: new Map<string, RefreshRootContainerLike>(
      options.containers ?? [],
    ),
    initialized: true,
    remoteHydrationPromise: null,
    runtime: {
      auth: {
        isAuthenticated: true,
        organizationId: options.organizationId ?? null,
      },
      infra: { dbStatus: "ready" },
      state: { containerId, online: true },
    },
  };
}

// The default (no includeActiveRootChildLane) path backs the automatic
// shared_with_you / startup catch-up discovery, which must re-list the top-level
// lane unwatermarked so a newly shared root (whose updatedAt does not bump the
// viewer's watermark) is discovered.
test("root refresh defaults to only the top-level lane, re-listed unwatermarked", async () => {
  const requests: RefreshOptions[] = [];

  await expect(
    refreshRootRemoteHydration({
      requestHydration: async (options) => {
        requests.push(options);
      },
      state: readyRefreshState("root-container"),
    }),
  ).resolves.toBe(true);

  expect(requests).toEqual([
    {
      followDiscoveredParentLanes: false,
      parentIds: [null],
      resetRootLaneWatermark: true,
    },
  ]);
});

test("root refresh can include the active root child lane for provisioned bootstrap", async () => {
  const requests: RefreshOptions[] = [];

  await expect(
    refreshRootRemoteHydration({
      includeActiveRootChildLane: true,
      requestHydration: async (options) => {
        requests.push(options);
      },
      state: readyRefreshState("root-container"),
    }),
  ).resolves.toBe(true);

  expect(requests).toEqual([
    {
      followDiscoveredParentLanes: false,
      parentIds: [null, "root-container"],
    },
  ]);
});

test("root refresh falls back to only the top-level lane before a root is known", async () => {
  const requests: RefreshOptions[] = [];

  await refreshRootRemoteHydration({
    includeActiveRootChildLane: true,
    requestHydration: async (options) => {
      requests.push(options);
    },
    state: readyRefreshState(null),
  });

  expect(requests[0]?.parentIds).toEqual([null]);
});

// Regression: after a cold-cache login the active root id is still the pre-auth
// device-first LOCAL root, but Trash lives under the reconciled SERVER root. The
// child lane must target the server root already in the tree, not the stale id,
// or the poll lists a dead lane, never pulls Trash, and spins its whole budget.
test("root refresh targets the reconciled server root, not a stale local root id", async () => {
  const requests: RefreshOptions[] = [];

  await refreshRootRemoteHydration({
    includeActiveRootChildLane: true,
    requestHydration: async (options) => {
      requests.push(options);
    },
    state: readyRefreshState("local-root", {
      containers: [
        ["local-root", localOnlyRootContainer("local-root")],
        [
          "server-root",
          serverRootContainer({ id: "server-root", organizationId: "org-1" }),
        ],
      ],
      organizationId: "org-1",
    }),
  });

  expect(requests[0]?.parentIds).toEqual([null, "server-root"]);
});

// A top-level container that belongs to another organization (a foreign shared
// root) must never be mistaken for the viewer's own root child lane.
test("root refresh ignores a foreign-organization root when resolving the child lane", async () => {
  const requests: RefreshOptions[] = [];

  await refreshRootRemoteHydration({
    includeActiveRootChildLane: true,
    requestHydration: async (options) => {
      requests.push(options);
    },
    state: readyRefreshState("local-root", {
      containers: [
        [
          "foreign-root",
          serverRootContainer({ id: "foreign-root", organizationId: "org-2" }),
        ],
      ],
      organizationId: "org-1",
    }),
  });

  expect(requests[0]?.parentIds).toEqual([null, "local-root"]);
});
