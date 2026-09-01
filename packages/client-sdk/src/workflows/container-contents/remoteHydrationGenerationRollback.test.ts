import { expect, test } from "bun:test";
import { createTestExecSql } from "@symcrypt/test-utils";
import type {
  ListContainerParentLanesResponse,
  ListContainersResponse,
} from "@symcrypt/validators/response";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { defaultContainerContentsPersistence } from "./containerPersistence";
import { hydrateRemoteContainers } from "./remoteHydration";
import type {
  ContainerState,
  RemoteContainerHydrationState,
} from "./remoteHydration/types";

const timestamp = "2026-01-01T00:00:00.000Z";

function remoteContainer(id: string): ListContainersResponse["items"][number] {
  return {
    createdAt: timestamp,
    depth: 0,
    effectiveAccessLevel: "write",
    id,
    metadataAccessEpoch: 1,
    metadataAccessStateHash: `access-${id}`,
    metadataDocumentId: `metadata-${id}`,
    metadataReferencedPrincipals: [],
    organizationId: "organization-1",
    parentId: null,
    systemSlot: null,
    updatedAt: timestamp,
  };
}

function existingContainerState(id: string): ContainerState {
  const remote = remoteContainer(id);
  return {
    container: {
      effectiveAccessLevel: remote.effectiveAccessLevel,
      icon: null,
      id: remote.id,
      metadataDocumentId: remote.metadataDocumentId,
      name: id,
      organizationId: remote.organizationId,
      parentId: remote.parentId,
      updatedAt: remote.updatedAt,
    },
    doc: {},
    record: {
      accessEpoch: remote.metadataAccessEpoch,
      accessStateHash: remote.metadataAccessStateHash,
      contentKeyBundle: null,
      documentId: remote.metadataDocumentId,
      documentKekTargets: null,
      documentManifestBundle: null,
      id: remote.id,
      lastCommitLsn: null,
      metadataUpdates: "",
      snapshotEndVersion: "",
    },
  } as unknown as ContainerState;
}

function expireAfterBegin(execSql: ExecSql): {
  execSql: ExecSql;
  transactionStarted: () => boolean;
} {
  let transactionStarted = false;
  return {
    execSql: (async (...args: Parameters<ExecSql>) => {
      const rows = await execSql(...args);
      if (args[0].trim().toUpperCase().startsWith("BEGIN")) {
        transactionStarted = true;
      }
      return rows;
    }) as ExecSql,
    transactionStarted: () => transactionStarted,
  };
}

function createState(input: {
  containers: ReadonlyArray<ContainerState>;
  execSql: ExecSql;
  page: ListContainersResponse;
}): RemoteContainerHydrationState {
  return {
    containersById: new Map(
      input.containers.map((containerState) => [
        containerState.container.id,
        containerState,
      ]),
    ),
    persistence: defaultContainerContentsPersistence,
    runtime: {
      apiClient: {
        getCurrentPrincipalPolicy: async () => null,
        listContainerParentLanes: async (request: {
          lanes: ReadonlyArray<{ laneId: string; parentId: string | null }>;
        }): Promise<ListContainerParentLanesResponse> => ({
          results: request.lanes.map(({ laneId, parentId }) => ({
            laneId,
            page:
              parentId === null
                ? input.page
                : {
                    hasMore: false,
                    items: [],
                    nextWatermark: null,
                    tombstones: [],
                  },
          })),
        }),
      },
      auth: { isAuthenticated: true },
      infra: { dbStatus: "ready", execSql: input.execSql },
      state: { online: true },
      util: { log: () => {} },
    },
  } as unknown as RemoteContainerHydrationState;
}

test("an expired hydration insert rolls back after BEGIN", async () => {
  const database = await createTestExecSql("hydration-insert-generation");
  try {
    await defaultContainerContentsPersistence.ensureSchema(database.execSql);
    const guarded = expireAfterBegin(database.execSql);
    const discovered = remoteContainer("expired-insert");
    const state = createState({
      containers: [],
      execSql: guarded.execSql,
      page: {
        hasMore: false,
        items: [discovered],
        nextWatermark: null,
        tombstones: [],
      },
    });

    await hydrateRemoteContainers({
      host: {
        persistContainerState: async () => {
          throw new Error("insert hydration must use atomic persistence");
        },
        updateSnapshot: () => {},
      },
      isCurrent: () => !guarded.transactionStarted(),
      parentIds: [null],
      state,
    });

    expect(guarded.transactionStarted()).toBe(true);
    expect(state.containersById.has(discovered.id)).toBe(false);
    await expect(
      defaultContainerContentsPersistence.containerExists(
        database.execSql,
        discovered.id,
      ),
    ).resolves.toBe(false);
  } finally {
    database.close();
  }
});

test("an expired tombstone cascade rolls back after BEGIN", async () => {
  const database = await createTestExecSql("hydration-tombstone-generation");
  try {
    await defaultContainerContentsPersistence.ensureSchema(database.execSql);
    const existing = existingContainerState("expired-tombstone");
    existing.container =
      await defaultContainerContentsPersistence.saveContainer(
        database.execSql,
        existing.container,
        existing.record,
      );
    const guarded = expireAfterBegin(database.execSql);
    const state = createState({
      containers: [existing],
      execSql: guarded.execSql,
      page: {
        hasMore: false,
        items: [],
        nextWatermark: null,
        tombstones: [
          {
            containerId: existing.container.id,
            depth: 0,
            parentId: null,
            reason: "deleted",
            updatedAt: timestamp,
          },
        ],
      },
    });

    await hydrateRemoteContainers({
      host: {
        persistContainerState: async () => {
          throw new Error("tombstone hydration must not upsert containers");
        },
        updateSnapshot: () => {},
      },
      isCurrent: () => !guarded.transactionStarted(),
      parentIds: [null],
      state,
    });

    expect(guarded.transactionStarted()).toBe(true);
    expect(state.containersById.get(existing.container.id)).toBe(existing);
    await expect(
      defaultContainerContentsPersistence.containerExists(
        database.execSql,
        existing.container.id,
      ),
    ).resolves.toBe(true);
    await expect(
      defaultContainerContentsPersistence.loadContainerHydrationTombstones(
        database.execSql,
      ),
    ).resolves.toEqual([]);
  } finally {
    database.close();
  }
});
