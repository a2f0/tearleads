import { expect, test } from "bun:test";
import {
  createContainerParentLaneBatchMock as batchParentLanes,
  createMockApiClient,
  createTestExecSql,
} from "@symcrypt/test-utils";
import type { ListContainersResponse } from "@symcrypt/validators/response";
import { waitFor } from "../../../test/helpers/waitFor";
import type { DomainScope } from "../../data/domainScope";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { defaultContainerContentsPersistence } from "../../workflows/container-contents/containerPersistence";
import { createContainerContentsStore } from "./containerContentsStore";
import {
  createContainerContentsTestRuntime,
  emptyListContainersResponse,
  seedLocalRootContainer,
} from "./runtime.testFixtures";

function activeRootChildSummary(): ListContainersResponse {
  return {
    hasMore: false,
    items: [
      {
        createdAt: "2026-06-19T00:00:00.000Z",
        depth: 1,
        effectiveAccessLevel: "admin",
        id: "active-root-trash",
        metadataAccessEpoch: 1,
        metadataAccessStateHash: "active-root-trash-access-hash",
        metadataDocumentId: "active-root-trash-metadata-document",
        metadataReferencedPrincipals: [],
        organizationId: "org-1",
        parentId: "active-root",
        systemSlot: "sys_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        updatedAt: "2026-06-19T00:00:00.000Z",
      },
    ],
    nextWatermark: {
      id: "active-root-trash",
      updatedAt: "2026-06-19T00:00:00.000Z",
    },
    tombstones: [],
  };
}

function serverRootNullLanePage(): ListContainersResponse {
  return {
    hasMore: false,
    items: [
      {
        createdAt: "2026-06-18T00:00:00.000Z",
        depth: 0,
        effectiveAccessLevel: "admin",
        id: "server-root",
        metadataAccessEpoch: 1,
        metadataAccessStateHash: "server-root-access-hash",
        metadataDocumentId: "server-root-metadata-document",
        metadataReferencedPrincipals: [],
        organizationId: "org-1",
        parentId: null,
        systemSlot: null,
        updatedAt: "2026-06-18T00:00:00.000Z",
      },
    ],
    nextWatermark: { id: "server-root", updatedAt: "2026-06-18T00:00:00.000Z" },
    tombstones: [],
  };
}

function serverTrashChildSummary(): ListContainersResponse {
  return {
    hasMore: false,
    items: [
      {
        createdAt: "2026-06-19T00:00:00.000Z",
        depth: 1,
        effectiveAccessLevel: "admin",
        id: "server-trash",
        metadataAccessEpoch: 1,
        metadataAccessStateHash: "server-trash-access-hash",
        metadataDocumentId: "server-trash-metadata-document",
        metadataReferencedPrincipals: [],
        organizationId: "org-1",
        parentId: "server-root",
        systemSlot: "sys_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        updatedAt: "2026-06-19T00:00:00.000Z",
      },
    ],
    nextWatermark: {
      id: "server-trash",
      updatedAt: "2026-06-19T00:00:00.000Z",
    },
    tombstones: [],
  };
}

async function saveNestedChildContainer(execSql: ExecSql): Promise<void> {
  await defaultContainerContentsPersistence.saveContainer(
    execSql,
    {
      icon: null,
      id: "nested-child",
      effectiveAccessLevel: "read",
      metadataDocumentId: "nested-child-metadata-document",
      name: "Nested",
      organizationId: "org-1",
      parentId: "server-root",
    },
    null,
  );
}

function nestedChildDeletionTombstonePage(): ListContainersResponse {
  return {
    hasMore: false,
    items: [],
    nextWatermark: {
      id: "nested-child",
      updatedAt: "2027-01-01T00:00:00.000Z",
    },
    tombstones: [
      {
        containerId: "nested-child",
        depth: 1,
        parentId: "server-root",
        reason: "deleted",
        updatedAt: "2027-01-01T00:00:00.000Z",
      },
    ],
  };
}

test("root-lane refresh hydrates the active root's system children", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-contents-store-active-root-child-refresh-test",
  );
  const domainScope = {} as DomainScope;
  const parentIds: Array<string | null | undefined> = [];

  try {
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    await defaultContainerContentsPersistence.saveContainer(
      execSql,
      {
        icon: null,
        id: "active-root",
        effectiveAccessLevel: "admin",
        metadataDocumentId: "active-root-metadata-document",
        name: "/",
        organizationId: "org-1",
        parentId: null,
      },
      null,
    );

    const runtime = createContainerContentsTestRuntime({
      apiClient: createMockApiClient({
        listContainerParentLanes: batchParentLanes(async ({ parentId }) => {
          parentIds.push(parentId);
          return parentId === "active-root"
            ? activeRootChildSummary()
            : emptyListContainersResponse();
        }),
      }),
      containerId: "active-root",
      domainScope,
      execSql,
    });
    const store = createContainerContentsStore(runtime);

    store.updateRuntime(runtime);

    await waitFor(
      () => store.getSnapshot().ready,
      "Container contents store did not become ready.",
    );

    await store.refreshRootLane({ includeActiveRootChildLane: true });

    expect(parentIds).toContain(null);
    expect(parentIds).toContain("active-root");
    expect(store.getSnapshot().nodes.map((node) => node.id)).toContain(
      "active-root-trash",
    );
  } finally {
    close();
  }
});

// Regression (bootstrap "You"/Trash flicker): the provisioned-container poll drives
// this refresh every ~250ms until the slot surfaces. After a cold-cache login the
// active root id is still the pre-auth device-first LOCAL root, but the org-born
// Trash lives under the reconciled SERVER root. The poll must target the server
// root's child lane (resolved from the tree), not the stale active root id — else
// it lists a dead lane, never pulls Trash, and spins its whole budget churning the
// sidebar. Without the fix this refresh lists [null, "stale-local-root"], never
// touches "server-root", and Trash never appears.
test("provisioned root-lane refresh surfaces Trash under the reconciled server root despite a stale active root id", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-contents-store-stale-root-provisioned-pull-test",
  );
  const domainScope = {} as DomainScope;
  const listedParentIds: Array<string | null | undefined> = [];

  try {
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    // Post-reconcile state: only the SERVER root is in the tree, but the session's
    // active root id was never re-pointed off the deleted local root.
    await seedLocalRootContainer(execSql, { rootContainerId: "server-root" });

    const runtime = createContainerContentsTestRuntime({
      apiClient: createMockApiClient({
        listContainerParentLanes: batchParentLanes(async ({ parentId }) => {
          listedParentIds.push(parentId);
          return parentId === "server-root"
            ? serverTrashChildSummary()
            : emptyListContainersResponse();
        }),
      }),
      containerId: "stale-local-root",
      domainScope,
      execSql,
    });
    const store = createContainerContentsStore(runtime);

    store.updateRuntime(runtime);

    await waitFor(
      () => store.getSnapshot().ready,
      "Container contents store did not become ready.",
    );

    await store.refreshRootLane({ includeActiveRootChildLane: true });

    expect(listedParentIds).toContain("server-root");
    expect(store.getSnapshot().nodes.map((node) => node.id)).toContain(
      "server-trash",
    );
  } finally {
    close();
  }
});

// Option 1 (instant Trash surfacing): a server-provisioned system container is
// written to local SQLite by persistRegistrationBootstrap in the SAME flow as
// registration / org-creation. `refreshLocalContainers` must surface it into the
// snapshot from that local row with NO server round-trip, so it appears as
// instantly as the device-first Contacts instead of waiting for the remote
// root-lane poll — and stay idempotent with any later remote pull (merge keyed by
// container id, never a duplicate). Here the remote list only ever returns empty,
// so a surfaced Trash can only have come from the local re-read.
test("refreshLocalContainers surfaces a newly persisted container from local SQLite", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-contents-store-local-refresh-surface-test",
  );
  const domainScope = {} as DomainScope;
  let parentLaneCalls = 0;

  try {
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    await defaultContainerContentsPersistence.saveContainer(
      execSql,
      {
        icon: null,
        id: "active-root",
        effectiveAccessLevel: "admin",
        metadataDocumentId: "active-root-metadata-document",
        name: "/",
        organizationId: "org-1",
        parentId: null,
      },
      null,
    );

    const runtime = createContainerContentsTestRuntime({
      apiClient: createMockApiClient({
        listContainerParentLanes: batchParentLanes(async () => {
          parentLaneCalls += 1;
          return emptyListContainersResponse();
        }),
      }),
      containerId: "active-root",
      domainScope,
      execSql,
    });
    const store = createContainerContentsStore(runtime);

    store.updateRuntime(runtime);

    await waitFor(
      () => store.getSnapshot().ready,
      "Container contents store did not become ready.",
    );

    // The provisioned Trash is not in the tree yet.
    expect(store.getSnapshot().nodes.map((node) => node.id)).not.toContain(
      "provisioned-trash",
    );

    // Simulate registration persisting the server-provisioned Trash to local
    // SQLite AFTER the store already initialized (the fresh-registration case).
    await defaultContainerContentsPersistence.saveContainer(
      execSql,
      {
        icon: "trash",
        id: "provisioned-trash",
        effectiveAccessLevel: "admin",
        metadataDocumentId: "provisioned-trash-metadata-document",
        name: "Trash",
        organizationId: "org-1",
        parentId: "active-root",
        systemSlot: "sys_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
      null,
    );

    const listCallsBeforeSurface = parentLaneCalls;
    await store.refreshLocalContainers();

    // Surfaced from local SQLite (the remote list only returns empty, so it could
    // not have come from the network), with no remote list issued by the surface.
    expect(store.getSnapshot().nodes.map((node) => node.id)).toContain(
      "provisioned-trash",
    );
    expect(parentLaneCalls).toBe(listCallsBeforeSurface);

    // Idempotent with a repeat surface (and any later remote pull): keyed by
    // container id, so it reconciles in place rather than inserting a duplicate.
    await store.refreshLocalContainers();
    expect(
      store
        .getSnapshot()
        .nodes.filter((node) => node.id === "provisioned-trash"),
    ).toHaveLength(1);
  } finally {
    close();
  }
});

// The resync_required handler passes a flagged container's parent lane to
// refreshRootLane so a deleted nested container is dropped without the full crawl.
// A deleted nested container the viewer reached via its parent is tombstoned
// rootDiscoveryVisible=false, so its tombstone comes back ONLY from the parent
// lane. Re-listing that parent lane must apply the tombstone and remove the stale
// container from the tree.
test("resync parent-lane refresh applies a deleted nested container's tombstone", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-contents-store-nested-delete-parent-lane-test",
  );
  const domainScope = {} as DomainScope;
  const listedParentIds: Array<string | null | undefined> = [];

  try {
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    await seedLocalRootContainer(execSql, { rootContainerId: "server-root" });
    await saveNestedChildContainer(execSql);

    const runtime = createContainerContentsTestRuntime({
      apiClient: createMockApiClient({
        listContainerParentLanes: batchParentLanes(async ({ parentId }) => {
          listedParentIds.push(parentId);
          if (parentId === "server-root") {
            return nestedChildDeletionTombstonePage();
          }
          if (parentId === null) {
            return serverRootNullLanePage();
          }
          return emptyListContainersResponse();
        }),
      }),
      containerId: "server-root",
      domainScope,
      execSql,
    });
    const store = createContainerContentsStore(runtime);

    store.updateRuntime(runtime);

    await waitFor(
      () => store.getSnapshot().ready,
      "Container contents store did not become ready.",
    );

    await store.refreshLocalContainers();
    expect(store.getSnapshot().nodes.map((node) => node.id)).toContain(
      "nested-child",
    );

    await store.refreshRootLane({ parentIds: ["server-root"] });

    expect(listedParentIds).toContain("server-root");
    expect(store.getSnapshot().nodes.map((node) => node.id)).not.toContain(
      "nested-child",
    );
  } finally {
    close();
  }
});

// The counterpart that proves the parent lane is load-bearing: a root-only refresh
// (no parentIds) never lists the parent lane, so the parent-only tombstone is never
// fetched and the deleted nested container stays stale — the exact regression the
// resync parent-lane fix prevents.
test("root-only refresh leaves a deleted nested container's parent-only tombstone stale", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-contents-store-nested-delete-root-only-test",
  );
  const domainScope = {} as DomainScope;
  const listedParentIds: Array<string | null | undefined> = [];

  try {
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    await seedLocalRootContainer(execSql, { rootContainerId: "server-root" });
    await saveNestedChildContainer(execSql);

    const runtime = createContainerContentsTestRuntime({
      apiClient: createMockApiClient({
        listContainerParentLanes: batchParentLanes(async ({ parentId }) => {
          listedParentIds.push(parentId);
          if (parentId === "server-root") {
            return nestedChildDeletionTombstonePage();
          }
          if (parentId === null) {
            return serverRootNullLanePage();
          }
          return emptyListContainersResponse();
        }),
      }),
      containerId: "server-root",
      domainScope,
      execSql,
    });
    const store = createContainerContentsStore(runtime);

    store.updateRuntime(runtime);

    await waitFor(
      () => store.getSnapshot().ready,
      "Container contents store did not become ready.",
    );

    await store.refreshLocalContainers();
    expect(store.getSnapshot().nodes.map((node) => node.id)).toContain(
      "nested-child",
    );

    await store.refreshRootLane();

    expect(listedParentIds).not.toContain("server-root");
    expect(store.getSnapshot().nodes.map((node) => node.id)).toContain(
      "nested-child",
    );
  } finally {
    close();
  }
});

// Regression (bootstrap churn engine): each provisioned poll must NOT re-list the
// root (null) lane unwatermarked. An unwatermarked re-list every tick makes
// hydrateRemoteContainers count every listed container as "changed", re-firing
// updateSnapshot()+scheduleSync() on every one of the ~40 polls and repainting the
// sidebar for the whole window. Once a lane reports its next watermark, later polls
// must resume from it. Without the fix (resetRootLaneWatermark:true), every null-
// lane request carries a null watermark.
test("repeated provisioned root-lane refreshes do not re-list the root lane unwatermarked", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-contents-store-provisioned-pull-watermark-test",
  );
  const domainScope = {} as DomainScope;
  const nullLaneWatermarks: Array<unknown> = [];

  try {
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    await seedLocalRootContainer(execSql, { rootContainerId: "server-root" });

    const runtime = createContainerContentsTestRuntime({
      apiClient: createMockApiClient({
        listContainerParentLanes: batchParentLanes(
          async ({ parentId, watermark }) => {
            if (parentId === null) {
              nullLaneWatermarks.push(watermark ?? null);
              return serverRootNullLanePage();
            }
            return parentId === "server-root"
              ? serverTrashChildSummary()
              : emptyListContainersResponse();
          },
        ),
      }),
      containerId: "server-root",
      domainScope,
      execSql,
    });
    const store = createContainerContentsStore(runtime);

    store.updateRuntime(runtime);

    await waitFor(
      () => store.getSnapshot().ready,
      "Container contents store did not become ready.",
    );

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await store.refreshRootLane({ includeActiveRootChildLane: true });
    }

    // The first pull has no persisted watermark; every subsequent pull must resume
    // from the watermark the null lane reported, never re-list it unwatermarked.
    expect(nullLaneWatermarks.length).toBeGreaterThanOrEqual(2);
    expect(
      nullLaneWatermarks.slice(1).every((watermark) => watermark != null),
    ).toBe(true);
  } finally {
    close();
  }
});
