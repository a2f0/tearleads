import { expect, test } from "bun:test";
import { execDatabaseStatement } from "@tearleads/sqlite-worker/load-sqlite3";
import { initTestSqliteDatabase } from "@tearleads/test-utils";
import type { ContainerContentsPersistence } from "../../data/persistence/container-contents/containerContentsPersistence";
import { sqlContainerContentsPersistence } from "../../data/persistence/container-contents/containerContentsPersistence";
import {
  type ClientSQLitePersistenceRuntime,
  createClientSQLitePersistenceRuntime,
} from "../../data/sqlite/sqlitePersistenceRuntime";
import type { SqlArrayRow, SqlRow } from "../../data/sqlite/sqlSchema";
import {
  installContainerMetadataRecord,
  persistContainerMetadataStateFromRuntime,
} from "./metadataPersistence";
import { upsertRemoteContainerState } from "./remoteContainerState";
import type {
  ContainerState,
  RemoteContainer,
  RemoteContainerHydrationHost,
  RemoteContainerHydrationState,
} from "./remoteHydration/types";
import { hydrateStoredContainerState } from "./storedContainerState";

async function openTestConnection(input: {
  dbName: string;
  key: string;
}): Promise<{
  close: () => void;
  runtime: ClientSQLitePersistenceRuntime;
}> {
  const db = await initTestSqliteDatabase({ ...input, cipher: "chacha20" });
  return {
    close: () => db.close(),
    runtime: createClientSQLitePersistenceRuntime({
      exec: async (options) => ({
        rows: execDatabaseStatement(db, options) as Array<SqlRow | SqlArrayRow>,
      }),
    }),
  };
}

const T1 = "2026-01-01T00:00:01.000Z";
const T2 = "2026-01-01T00:00:02.000Z";
const T3 = "2026-01-01T00:00:03.000Z";

const staleRemoteContainer: RemoteContainer = {
  createdAt: T1,
  effectiveAccessLevel: "write",
  id: "container-1",
  metadataAccessEpoch: 1,
  metadataAccessStateHash: "access-1",
  metadataDocumentId: "metadata-1",
  metadataReferencedPrincipals: [],
  organizationId: "organization-1",
  parentId: "stale-parent",
  systemSlot: null,
  updatedAt: T2,
};

function createHost(input: {
  persistence: ContainerContentsPersistence;
  state: RemoteContainerHydrationState;
}): RemoteContainerHydrationHost {
  return {
    async persistContainerState(
      candidate,
      patch,
      _updateView,
      saveOptions,
      mutationOptions,
    ) {
      const persisted = await persistContainerMetadataStateFromRuntime({
        metadataState: candidate,
        patch,
        persistence: input.persistence,
        preserveDurableStructureWhenPending:
          mutationOptions?.preserveDurableStructureWhenPending,
        runtime: input.state.runtime,
        saveOptions,
      });
      if (!persisted) return { status: "missing" };
      candidate.container = persisted.container;
      installContainerMetadataRecord(candidate, persisted.record);
      if (persisted.mutationSuperseded || persisted.syncIdentitySuperseded) {
        const cached = input.state.containersById.get(candidate.container.id);
        if (cached && cached !== candidate) {
          cached.container = candidate.container;
          cached.doc = candidate.doc;
          installContainerMetadataRecord(cached, candidate.record);
        }
        return { record: persisted.record, status: "identity-superseded" };
      }
      return { record: persisted.record, status: "persisted" };
    },
    updateSnapshot: () => {},
  };
}

test("stale same-identity hydration cannot overwrite a newer pane", async () => {
  const dbName = `/${crypto.randomUUID()}.db`;
  const first = await openTestConnection({ dbName, key: "container-update" });
  await sqlContainerContentsPersistence.ensureSchema(first.runtime.execSql);
  const second = await openTestConnection({ dbName, key: "container-update" });
  try {
    await Promise.all(
      [first.runtime.execSql, second.runtime.execSql].map((execSql) =>
        execSql("PRAGMA busy_timeout = 5000"),
      ),
    );
    const record = {
      accessEpoch: 1,
      accessStateHash: "access-1",
      documentId: "metadata-1",
      id: staleRemoteContainer.id,
      metadataUpdates: "",
      snapshotEndVersion: "",
    };
    await sqlContainerContentsPersistence.saveContainer(
      first.runtime.execSql,
      {
        effectiveAccessLevel: "write",
        icon: null,
        id: staleRemoteContainer.id,
        metadataDocumentId: staleRemoteContainer.metadataDocumentId,
        name: "Container",
        organizationId: staleRemoteContainer.organizationId,
        parentId: "initial-parent",
      },
      record,
      {
        localUpdatedAt: T1,
        serverTimestamps: { createdAt: T1, updatedAt: T1 },
      },
    );
    const staleStored =
      await sqlContainerContentsPersistence.loadContainerMetadataState(
        first.runtime.execSql,
        staleRemoteContainer.id,
      );
    if (!staleStored) throw new Error("Expected stale pane state");
    const staleState = await hydrateStoredContainerState({
      execSql: first.runtime.execSql,
      persistence: sqlContainerContentsPersistence,
      storedContainer: staleStored,
    });

    await sqlContainerContentsPersistence.saveContainer(
      second.runtime.execSql,
      {
        ...staleStored.container,
        effectiveAccessLevel: "admin",
        parentId: "newer-parent",
      },
      record,
      {
        localUpdatedAt: T3,
        serverTimestamps: { createdAt: T1, updatedAt: T3 },
      },
    );
    const state = {
      containersById: new Map<string, ContainerState>([
        [staleRemoteContainer.id, staleState],
      ]),
      persistence: sqlContainerContentsPersistence,
      runtime: { infra: { execSql: first.runtime.execSql } },
    } as RemoteContainerHydrationState;
    await expect(
      upsertRemoteContainerState({
        containerIdsWithPendingMetadataUpdates: new Set(),
        containerIdsWithPendingStructuralIntents: new Set(),
        host: createHost({
          persistence: sqlContainerContentsPersistence,
          state,
        }),
        remoteContainer: staleRemoteContainer,
        state,
      }),
    ).resolves.toBeNull();

    await expect(
      sqlContainerContentsPersistence.loadContainerMetadataState(
        first.runtime.execSql,
        staleRemoteContainer.id,
      ),
    ).resolves.toMatchObject({
      container: {
        effectiveAccessLevel: "admin",
        parentId: "newer-parent",
        serverUpdatedAt: T3,
      },
    });
    expect(
      state.containersById.get(staleRemoteContainer.id)?.container,
    ).toMatchObject({
      effectiveAccessLevel: "admin",
      parentId: "newer-parent",
      serverUpdatedAt: T3,
    });
  } finally {
    first.close();
    second.close();
  }
});

test("pending structural hydration preserves a newer pane move", async () => {
  const dbName = `/${crypto.randomUUID()}.db`;
  const first = await openTestConnection({ dbName, key: "pending-move" });
  await sqlContainerContentsPersistence.ensureSchema(first.runtime.execSql);
  const second = await openTestConnection({ dbName, key: "pending-move" });
  try {
    await Promise.all(
      [first.runtime.execSql, second.runtime.execSql].map((execSql) =>
        execSql("PRAGMA busy_timeout = 5000"),
      ),
    );
    const record = {
      accessEpoch: 1,
      accessStateHash: "access-1",
      documentId: "metadata-1",
      id: staleRemoteContainer.id,
      metadataUpdates: "",
      snapshotEndVersion: "",
    };
    await sqlContainerContentsPersistence.saveContainer(
      first.runtime.execSql,
      {
        effectiveAccessLevel: "write",
        icon: null,
        id: staleRemoteContainer.id,
        metadataDocumentId: staleRemoteContainer.metadataDocumentId,
        name: "Container",
        organizationId: staleRemoteContainer.organizationId,
        parentId: "initial-parent",
      },
      record,
      {
        localUpdatedAt: T1,
        serverTimestamps: { createdAt: T1, updatedAt: T1 },
      },
    );
    const staleStored =
      await sqlContainerContentsPersistence.loadContainerMetadataState(
        first.runtime.execSql,
        staleRemoteContainer.id,
      );
    if (!staleStored) throw new Error("Expected stale pane state");
    const staleState = await hydrateStoredContainerState({
      execSql: first.runtime.execSql,
      persistence: sqlContainerContentsPersistence,
      storedContainer: staleStored,
    });
    staleState.record.accessStateHash = "access-1";

    await sqlContainerContentsPersistence.saveContainer(
      second.runtime.execSql,
      { ...staleStored.container, parentId: "newer-parent" },
      record,
      {
        localUpdatedAt: T3,
        moveIntent: {
          parentContainerId: "newer-parent",
          previousParentContainerId: "initial-parent",
        },
      },
    );
    const state = {
      containersById: new Map<string, ContainerState>([
        [staleRemoteContainer.id, staleState],
      ]),
      persistence: sqlContainerContentsPersistence,
      runtime: { infra: { execSql: first.runtime.execSql } },
    } as RemoteContainerHydrationState;

    await expect(
      upsertRemoteContainerState({
        containerIdsWithPendingMetadataUpdates: new Set(),
        // The page-level intent scan raced before the second pane queued its
        // move. The commit-time check must still preserve that durable intent.
        containerIdsWithPendingStructuralIntents: new Set(),
        host: createHost({
          persistence: sqlContainerContentsPersistence,
          state,
        }),
        remoteContainer: staleRemoteContainer,
        state,
      }),
    ).resolves.toBe(staleState);

    await expect(
      sqlContainerContentsPersistence.loadContainerMetadataState(
        first.runtime.execSql,
        staleRemoteContainer.id,
      ),
    ).resolves.toMatchObject({
      container: {
        parentId: "newer-parent",
        localUpdatedAt: T3,
        serverUpdatedAt: T2,
      },
    });
    expect(staleState.container).toMatchObject({
      parentId: "newer-parent",
      localUpdatedAt: T3,
      serverUpdatedAt: T2,
    });
    await expect(
      sqlContainerContentsPersistence.listUnsyncedMoveIntents(
        first.runtime.execSql,
      ),
    ).resolves.toHaveLength(1);
  } finally {
    first.close();
    second.close();
  }
});
