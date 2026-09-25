import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import type {
  ListContainerParentLanesResponse,
  ListContainersResponse,
} from "@tearleads/validators/response";
import { createSignedContainerDirectory } from "../../../test/helpers/signedContainerDirectory";
import { defaultContainerContentsPersistence } from "./containerPersistence";
import { insertTestPendingUpdate } from "./documentQueries.testFixtures";
import { hydrateRemoteContainers } from "./remoteHydration";
import { getApplicableRemoteContainerItems } from "./remoteHydration/tombstoneApplication";
import type { RemoteContainerHydrationState } from "./remoteHydration/types";

const T0 = "2026-01-01T00:00:00.000Z";
const ORG = "org-1";
const rootItem: ListContainersResponse["items"][number] = {
  createdAt: T0,
  depth: 0,
  effectiveAccessLevel: "admin",
  id: "root-1",
  metadataAccessEpoch: 1,
  metadataAccessStateHash: "root-access",
  metadataDocumentId: "root-1-metadata",
  metadataReferencedPrincipals: [],
  organizationId: ORG,
  parentId: null,
  systemSlot: null,
  updatedAt: T0,
};
const childItem: ListContainersResponse["items"][number] = {
  ...rootItem,
  depth: 1,
  effectiveAccessLevel: "admin",
  id: "child-1",
  metadataAccessStateHash: "child-access",
  metadataDocumentId: "child-1-metadata",
  parentId: "root-1",
};

const empty: ListContainersResponse = {
  hasMore: false,
  items: [],
  nextWatermark: null,
  tombstones: [],
};

const directory = await createSignedContainerDirectory([
  {
    id: "folder-p",
    parentId: "root-1",
    metadataDocumentId: "p-meta",
    organizationId: ORG,
  },
  {
    id: "folder-q",
    parentId: "root-1",
    metadataDocumentId: "q-meta",
    organizationId: ORG,
  },
  {
    id: "folder-c",
    parentId: "folder-q",
    metadataDocumentId: "c-meta",
    organizationId: ORG,
  },
  {
    id: "root-1",
    parentId: null,
    organizationId: ORG,
    metadataDocumentId: "root-1-metadata",
  },
  {
    id: "child-1",
    parentId: "root-1",
    organizationId: ORG,
    metadataDocumentId: "child-1-metadata",
  },
]);

function createState(
  execSql: RemoteContainerHydrationState["runtime"]["infra"]["execSql"],
  pages: (parentId: string | null) => ListContainersResponse,
  containersById: RemoteContainerHydrationState["containersById"],
): RemoteContainerHydrationState {
  return {
    containersById,
    persistence: defaultContainerContentsPersistence,
    runtime: {
      resolveTrustedUserIdentity: directory.resolveTrustedUserIdentity,
      apiClient: {
        getContainerWriterProjection: directory.getContainerWriterProjection,
        evictContainerWriterProjection: () => {},
        getCurrentPrincipalPolicy: async () => null,
        listContainerParentLanes: async (request: {
          lanes: ReadonlyArray<{ laneId: string; parentId: string | null }>;
        }): Promise<ListContainerParentLanesResponse> => ({
          results: request.lanes.map(({ laneId, parentId }) => ({
            laneId,
            page: pages(parentId),
          })),
        }),
      },
      auth: { isAuthenticated: true, userId: "user-1" },
      infra: { dbStatus: "ready", execSql },
      state: { online: true },
      util: { log: () => {} },
    },
  } as unknown as RemoteContainerHydrationState;
}

const host = {
  persistContainerState: async () => {
    throw new Error("unexpected update");
  },
  updateSnapshot: () => {},
};

test("unsigned deletion preserves queued metadata and permits verified rediscovery", async () => {
  const { close, execSql } = await createTestExecSql(
    "probe-container-tombstone",
  );
  try {
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    const containersById: RemoteContainerHydrationState["containersById"] =
      new Map();

    // 1. Honest hydration: root-1 and its child child-1.
    await hydrateRemoteContainers({
      host,
      parentIds: [null],
      state: createState(
        execSql,
        (parentId) =>
          parentId === null
            ? {
                ...empty,
                items: [rootItem],
                nextWatermark: { id: "root-1", updatedAt: T0 },
              }
            : parentId === "root-1"
              ? {
                  ...empty,
                  items: [childItem],
                  nextWatermark: { id: "child-1", updatedAt: T0 },
                }
              : empty,
        containersById,
      ),
    });
    expect(containersById.has("root-1")).toBe(true);
    expect(containersById.has("child-1")).toBe(true);

    const childState = containersById.get("child-1");
    if (!childState) throw new Error("Expected hydrated child");
    childState.container =
      await defaultContainerContentsPersistence.saveContainer(
        execSql,
        childState.container,
        childState.record,
        {
          moveIntent: {
            parentContainerId: "move-destination",
            previousParentContainerId: "root-1",
          },
        },
      );
    const localRecord = {
      ...childState.record,
      id: "local-child",
      documentId: null,
    };
    const localContainer =
      await defaultContainerContentsPersistence.saveContainer(
        execSql,
        {
          ...childState.container,
          id: "local-child",
          parentId: "child-1",
          metadataDocumentId: null,
        },
        localRecord,
        { createIntent: { parentContainerId: "child-1" } },
      );
    containersById.set("local-child", {
      ...childState,
      container: localContainer,
      record: localRecord,
    });

    // 2. A queued (unsynced) rename of child-1.
    await insertTestPendingUpdate({
      appKind: "container-metadata",
      createdAt: T0,
      execSql,
      id: "rename-child-1",
      localId: "child-1",
    });
    const pendingBefore = await execSql(
      "SELECT id FROM document_pending_updates WHERE local_id = ?",
      ["child-1"],
    );
    expect(pendingBefore.length).toBe(1);

    const metadataBeforeTombstone =
      await defaultContainerContentsPersistence.loadContainerMetadataRecord(
        execSql,
        "child-1",
      );
    // 3. One malicious root-lane page: a `deleted` tombstone for root-1, which
    //    has a server-side child (an honest DELETE refuses non-leaf containers),
    //    with a canonical but fabricated far-future timestamp.
    await hydrateRemoteContainers({
      host,
      parentIds: [null],
      state: createState(
        execSql,
        (parentId) =>
          parentId === null
            ? {
                ...empty,
                tombstones: [
                  {
                    containerId: "root-1",
                    depth: 0,
                    parentId: null,
                    reason: "deleted",
                    updatedAt: "9999-01-01T00:00:00.000Z",
                  },
                ],
              }
            : empty,
        containersById,
      ),
    });
    expect(containersById.has("root-1")).toBe(false);
    expect(containersById.has("child-1")).toBe(false);
    await expect(
      defaultContainerContentsPersistence.containerExists(execSql, "child-1"),
    ).resolves.toBe(false);
    const pendingAfter = await execSql(
      "SELECT id FROM document_pending_updates WHERE local_id = ?",
      ["child-1"],
    );
    // The unsigned deletion must not destroy queued local edits.
    expect(pendingAfter.length).toBe(1);
    expect(
      await defaultContainerContentsPersistence.containerExists(
        execSql,
        "local-child",
      ),
    ).toBe(true);
    expect(
      await defaultContainerContentsPersistence.listPendingCreateIntents(
        execSql,
      ),
    ).toEqual([
      expect.objectContaining({
        containerId: "local-child",
        parentContainerId: "child-1",
      }),
    ]);
    expect(
      await defaultContainerContentsPersistence.listUnsyncedMoveIntents(
        execSql,
      ),
    ).toEqual([
      expect.objectContaining({
        containerId: "child-1",
        parentContainerId: "move-destination",
      }),
    ]);
    // A page started before the parent tombstone observed no child fence.
    // Its saved metadata still matches: only the removal generation can reject it.
    const staleChild =
      await defaultContainerContentsPersistence.commitHydratedContainer(
        execSql,
        {
          container: childState.container,
          record: childState.record,
          expectedDormantRecord: metadataBeforeTombstone,
          expectedHydrationTombstone: null,
          purgeDormantMetadata: false,
          remoteUpdatedAt: T0,
          saveOptions: {},
        },
      );
    expect(staleChild.committed).toBe(false);
    const fences = await execSql(
      "SELECT container_id, reason, updated_at FROM container_hydration_tombstones ORDER BY container_id",
    );
    expect(fences).toEqual([
      {
        container_id: "child-1",
        reason: "deleted",
        updated_at: "9999-01-01T00:00:00.000Z",
      },
      {
        container_id: "root-1",
        reason: "deleted",
        updated_at: "9999-01-01T00:00:00.000Z",
      },
    ]);

    // 4. The server returns to honesty and serves root-1 and child-1 again (a
    //    full relisting with lane watermarks reset). Verified data restores both.
    await hydrateRemoteContainers({
      host,
      parentIds: [null],
      resetAllLaneWatermarks: true,
      followDiscoveredParentLanes: true,
      state: createState(
        execSql,
        (parentId) =>
          parentId === null
            ? { ...empty, items: [rootItem] }
            : parentId === "root-1"
              ? { ...empty, items: [childItem] }
              : empty,
        containersById,
      ),
    });
    expect(containersById.has("root-1")).toBe(true);
    await expect(
      defaultContainerContentsPersistence.containerExists(execSql, "root-1"),
    ).resolves.toBe(true);
  } finally {
    await close();
  }
});

test("a child moved before its old parent is deleted remains recoverable", async () => {
  const { close, execSql } = await createTestExecSql("probe-inherited-fence");
  try {
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    const containersById: RemoteContainerHydrationState["containersById"] =
      new Map();
    const t1 = "2026-01-05T00:00:00.000Z"; // C moved from P to Q
    const t2 = "2026-01-06T00:00:00.000Z"; // P (now an empty leaf) deleted
    const p = {
      ...childItem,
      id: "folder-p",
      metadataDocumentId: "p-meta",
      parentId: "root-1",
    };
    const q = {
      ...childItem,
      id: "folder-q",
      metadataDocumentId: "q-meta",
      parentId: "root-1",
    };
    const c = {
      ...childItem,
      depth: 2,
      id: "folder-c",
      metadataDocumentId: "c-meta",
      parentId: "folder-p",
    };
    // Initial honest state: root-1 > {P > C, Q}.
    await hydrateRemoteContainers({
      host,
      parentIds: [null],
      state: createState(
        execSql,
        (parentId) =>
          parentId === null
            ? { ...empty, items: [rootItem] }
            : parentId === "root-1"
              ? { ...empty, items: [p, q] }
              : parentId === "folder-p"
                ? { ...empty, items: [c] }
                : empty,
        containersById,
      ),
    });
    expect(containersById.get("folder-c")?.container.parentId).toBe("folder-p");
    // The user renamed C offline (queued metadata edit).
    await insertTestPendingUpdate({
      appKind: "container-metadata",
      createdAt: T0,
      execSql,
      id: "rename-c",
      localId: "folder-c",
    });

    // Honest server after t2: root-1 lane carries P's deletion tombstone; the
    // Q lane lists C (moved at t1). The device happens to apply root-1 first.
    await hydrateRemoteContainers({
      host,
      parentIds: ["root-1"],
      state: createState(
        execSql,
        (parentId) =>
          parentId === "root-1"
            ? {
                ...empty,
                tombstones: [
                  {
                    containerId: "folder-p",
                    depth: 1,
                    parentId: "root-1",
                    reason: "deleted",
                    updatedAt: t2,
                  },
                ],
              }
            : empty,
        containersById,
      ),
    });
    expect(containersById.has("folder-c")).toBe(false);
    await hydrateRemoteContainers({
      host,
      parentIds: ["folder-q"],
      state: createState(
        execSql,
        (parentId) =>
          parentId === "folder-q"
            ? {
                ...empty,
                items: [{ ...c, parentId: "folder-q", updatedAt: t1 }],
              }
            : empty,
        containersById,
      ),
    });
    const fence = await execSql(
      "SELECT reason, updated_at FROM container_hydration_tombstones WHERE container_id = 'folder-c'",
    );
    const renameLeft = await execSql(
      "SELECT id FROM document_pending_updates WHERE local_id = 'folder-c'",
    );

    expect(renameLeft.length).toBe(1);
    expect(fence).toEqual([]);
    expect(containersById.get("folder-c")?.container.parentId).toBe("folder-q");
  } finally {
    await close();
  }
});

test("malformed unsigned tombstone clocks are refused before application", () => {
  expect(() =>
    getApplicableRemoteContainerItems({
      ...empty,
      tombstones: [
        {
          containerId: "root-1",
          parentId: null,
          depth: 0,
          reason: "deleted",
          updatedAt: "~",
        },
      ],
    }),
  ).toThrow("timestamp is not canonical");
});
