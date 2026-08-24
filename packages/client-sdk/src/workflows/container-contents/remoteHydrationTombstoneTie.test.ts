import { expect, test } from "bun:test";
import { createTestExecSql } from "@symcrypt/test-utils";
import type {
  ListContainerParentLanesResponse,
  ListContainersResponse,
} from "@symcrypt/validators/response";
import {
  createContainerParentSyncLane,
  defaultContainerContentsPersistence,
  loadContainerSyncWatermark,
} from "./containerPersistence";
import { hydrateRemoteContainers } from "./remoteHydration";
import type { RemoteContainerHydrationState } from "./remoteHydration/types";

const timestamp = "2026-01-01T00:00:00.000Z";
const containerId = "equal-time-container";
const metadataDocumentId = "equal-time-metadata";

const remoteContainer: ListContainersResponse["items"][number] = {
  createdAt: timestamp,
  depth: 0,
  effectiveAccessLevel: "write",
  id: containerId,
  metadataAccessEpoch: 1,
  metadataAccessStateHash: "equal-time-access",
  metadataDocumentId,
  metadataReferencedPrincipals: [],
  organizationId: "organization-1",
  parentId: null,
  systemSlot: null,
  updatedAt: timestamp,
};

const pageWatermark = {
  id: "equal-time-page",
  updatedAt: timestamp,
};

function createState(input: {
  execSql: RemoteContainerHydrationState["runtime"]["infra"]["execSql"];
  includeItem?: boolean;
  reason: "access_revoked" | "deleted";
  waitForRequest?: (() => Promise<void>) | undefined;
}): RemoteContainerHydrationState {
  const rootPage: ListContainersResponse = {
    hasMore: false,
    items: input.includeItem === false ? [] : [remoteContainer],
    nextWatermark: pageWatermark,
    tombstones: [
      {
        containerId,
        depth: 0,
        parentId: null,
        reason: input.reason,
        updatedAt: timestamp,
      },
    ],
  };
  return {
    containersById: new Map(),
    persistence: defaultContainerContentsPersistence,
    runtime: {
      apiClient: {
        getCurrentPrincipalPolicy: async () => null,
        listContainerParentLanes: async (request: {
          lanes: ReadonlyArray<{
            laneId: string;
            parentId: string | null;
          }>;
        }): Promise<ListContainerParentLanesResponse> => {
          await input.waitForRequest?.();
          return {
            results: request.lanes.map(({ laneId, parentId }) => ({
              laneId,
              page:
                parentId === null
                  ? rootPage
                  : {
                      hasMore: false,
                      items: [],
                      nextWatermark: null,
                      tombstones: [],
                    },
            })),
          };
        },
      },
      auth: { isAuthenticated: true },
      infra: { dbStatus: "ready", execSql: input.execSql },
      state: { online: true },
      util: { log: () => {} },
    },
  } as unknown as RemoteContainerHydrationState;
}

test("an equal-time deletion beats a same-page live item and fences it", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-hydration-equal-deletion",
  );
  try {
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    const state = createState({ execSql, reason: "deleted" });
    await hydrateRemoteContainers({
      host: {
        persistContainerState: async () => {
          throw new Error("an equal-time deleted item must not hydrate");
        },
        updateSnapshot: () => {},
      },
      parentIds: [null],
      state,
    });

    expect(state.containersById.has(containerId)).toBe(false);
    await expect(
      loadContainerSyncWatermark(execSql, createContainerParentSyncLane(null)),
    ).resolves.toEqual(pageWatermark);
    await expect(
      defaultContainerContentsPersistence.commitHydratedContainer(execSql, {
        container: {
          effectiveAccessLevel: "write",
          icon: null,
          id: containerId,
          metadataDocumentId,
          name: "Deleted",
          organizationId: remoteContainer.organizationId,
          parentId: null,
        },
        expectedDormantRecord: null,
        purgeDormantMetadata: false,
        record: {
          accessEpoch: 1,
          accessStateHash: remoteContainer.metadataAccessStateHash,
          contentKeyBundle: null,
          documentId: metadataDocumentId,
          documentKekTargets: null,
          documentManifestBundle: null,
          id: containerId,
          lastCommitLsn: null,
          metadataUpdates: "",
          snapshotEndVersion: "",
        },
        remoteUpdatedAt: timestamp,
        saveOptions: {},
      }),
    ).resolves.toEqual({ committed: false });
  } finally {
    await close();
  }
});

test("an equal-time live item beats an access revocation", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-hydration-equal-revocation",
  );
  try {
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    const state = createState({ execSql, reason: "access_revoked" });
    await hydrateRemoteContainers({
      host: {
        persistContainerState: async () => {
          throw new Error("the equal-time live item should insert");
        },
        updateSnapshot: () => {},
      },
      parentIds: [null],
      state,
    });

    expect(state.containersById.has(containerId)).toBe(true);
    await expect(
      defaultContainerContentsPersistence.containerExists(execSql, containerId),
    ).resolves.toBe(true);
  } finally {
    await close();
  }
});

test("an absent access revocation fences another pane's delayed item", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-hydration-absent-revocation-fence",
  );
  try {
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    const state = createState({
      execSql,
      includeItem: false,
      reason: "access_revoked",
    });
    await hydrateRemoteContainers({
      host: {
        persistContainerState: async () => ({ status: "missing" }),
        updateSnapshot: () => {},
      },
      parentIds: [null],
      state,
    });

    await expect(
      defaultContainerContentsPersistence.commitHydratedContainer(execSql, {
        container: {
          effectiveAccessLevel: "write",
          icon: null,
          id: containerId,
          metadataDocumentId,
          name: "Delayed stale item",
          organizationId: remoteContainer.organizationId,
          parentId: null,
        },
        expectedDormantRecord: null,
        purgeDormantMetadata: false,
        record: {
          accessEpoch: 1,
          accessStateHash: remoteContainer.metadataAccessStateHash,
          contentKeyBundle: null,
          documentId: metadataDocumentId,
          documentKekTargets: null,
          documentManifestBundle: null,
          id: containerId,
          lastCommitLsn: null,
          metadataUpdates: "",
          snapshotEndVersion: "",
        },
        remoteUpdatedAt: timestamp,
        saveOptions: {},
      }),
    ).resolves.toEqual({ committed: false });
  } finally {
    await close();
  }
});

test("a revocation during fetch fences its stale live response", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-hydration-revocation-during-fetch",
  );
  let releaseRequest = () => {};
  let markRequestStarted = () => {};
  const requestStarted = new Promise<void>((resolve) => {
    markRequestStarted = resolve;
  });
  const requestRelease = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  try {
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    await defaultContainerContentsPersistence.saveContainer(
      execSql,
      {
        effectiveAccessLevel: "write",
        icon: null,
        id: containerId,
        metadataDocumentId,
        name: "Previously live",
        organizationId: remoteContainer.organizationId,
        parentId: null,
      },
      {
        accessEpoch: 1,
        accessStateHash: remoteContainer.metadataAccessStateHash,
        contentKeyBundle: null,
        documentId: metadataDocumentId,
        documentKekTargets: null,
        documentManifestBundle: null,
        id: containerId,
        lastCommitLsn: null,
        metadataUpdates: "",
        snapshotEndVersion: "",
      },
    );
    const state = createState({
      execSql,
      reason: "access_revoked",
      waitForRequest: async () => {
        markRequestStarted();
        await requestRelease;
      },
    });
    const hydration = hydrateRemoteContainers({
      host: {
        persistContainerState: async () => ({ status: "missing" }),
        updateSnapshot: () => {},
      },
      parentIds: [null],
      state,
    });

    await requestStarted;
    await defaultContainerContentsPersistence.deleteContainers(
      execSql,
      [{ containerId, reason: "access_revoked", updatedAt: timestamp }],
      { retainMetadataForContainerIds: [containerId] },
    );
    releaseRequest();
    await hydration;

    expect(state.containersById.has(containerId)).toBe(false);
    await expect(
      defaultContainerContentsPersistence.containerExists(execSql, containerId),
    ).resolves.toBe(false);
  } finally {
    releaseRequest();
    await close();
  }
});
