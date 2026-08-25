import { expect, test } from "bun:test";
import { execDatabaseStatement } from "@symcrypt/sqlite-worker/load-sqlite3";
import { initTestSqliteDatabase } from "@symcrypt/test-utils";
import type { ContainerContentsPersistence } from "../../data/persistence/container-contents/containerContentsPersistence";
import { sqlContainerContentsPersistence } from "../../data/persistence/container-contents/containerContentsPersistence";
import {
  type ClientSQLitePersistenceRuntime,
  createClientSQLitePersistenceRuntime,
} from "../../data/sqlite/sqlitePersistenceRuntime";
import type { SqlArrayRow, SqlRow } from "../../data/sqlite/sqlSchema";
import { upsertRemoteContainerState } from "./remoteContainerState";
import type {
  RemoteContainer,
  RemoteContainerHydrationHost,
  RemoteContainerHydrationState,
} from "./remoteHydration/types";

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

const remoteContainer: RemoteContainer = {
  createdAt: "2026-01-01T00:00:00.000Z",
  effectiveAccessLevel: "write",
  id: "container-1",
  metadataAccessEpoch: 1,
  metadataAccessStateHash: "access-1",
  metadataDocumentId: "metadata-1",
  metadataReferencedPrincipals: [],
  organizationId: "organization-1",
  parentId: "parent-1",
  systemSlot: null,
  updatedAt: "2026-01-02T00:00:00.000Z",
};

function createState(
  runtime: ClientSQLitePersistenceRuntime,
  persistence: ContainerContentsPersistence,
): RemoteContainerHydrationState {
  return {
    containersById: new Map(),
    persistence,
    runtime: {
      auth: { organizationId: "organization-1" },
      infra: { execSql: runtime.execSql },
    },
  } as RemoteContainerHydrationState;
}

const host: RemoteContainerHydrationHost = {
  persistContainerState: async () => {
    throw new Error("insert hydration must use its atomic persistence path");
  },
  updateSnapshot: () => {},
};

function upsert(
  state: RemoteContainerHydrationState,
  input?: {
    childIdsByParentId?: Map<string, Set<string>>;
    remoteContainer?: RemoteContainer;
  },
) {
  return upsertRemoteContainerState({
    childIdsByParentId: input?.childIdsByParentId,
    containerIdsWithPendingMetadataUpdates: new Set(),
    containerIdsWithPendingStructuralIntents: new Set(),
    host,
    remoteContainer: input?.remoteContainer ?? remoteContainer,
    state,
  });
}

test("a two-pane hydration insert loser adopts the durable winner", async () => {
  const dbName = `/${crypto.randomUUID()}.db`;
  const first = await openTestConnection({ dbName, key: "container-race" });
  await sqlContainerContentsPersistence.ensureSchema(first.runtime.execSql);
  const second = await openTestConnection({ dbName, key: "container-race" });
  let releaseFirstCommit = () => {};
  let reportFirstCommit = () => {};
  const firstCommitStarted = new Promise<void>((resolve) => {
    reportFirstCommit = resolve;
  });
  const firstCommitRelease = new Promise<void>((resolve) => {
    releaseFirstCommit = resolve;
  });
  const firstPersistence: ContainerContentsPersistence = {
    ...sqlContainerContentsPersistence,
    async commitHydratedContainer(execSql, input) {
      reportFirstCommit();
      await firstCommitRelease;
      return sqlContainerContentsPersistence.commitHydratedContainer(
        execSql,
        input,
      );
    },
  };

  try {
    await Promise.all(
      [first.runtime.execSql, second.runtime.execSql].map((execSql) =>
        execSql("PRAGMA busy_timeout = 5000"),
      ),
    );
    const firstState = createState(first.runtime, firstPersistence);
    const secondState = createState(
      second.runtime,
      sqlContainerContentsPersistence,
    );
    const childIdsByParentId = new Map<string, Set<string>>();
    const firstUpsert = upsert(firstState, { childIdsByParentId });
    await firstCommitStarted;
    const winningParentId = "parent-2";
    const secondResult = await upsert(secondState, {
      remoteContainer: { ...remoteContainer, parentId: winningParentId },
    });
    releaseFirstCommit();
    const firstResult = await firstUpsert;

    expect(secondResult?.container.id).toBe(remoteContainer.id);
    expect(firstResult?.container.id).toBe(remoteContainer.id);
    expect(firstState.containersById.has(remoteContainer.id)).toBe(true);
    expect(secondState.containersById.has(remoteContainer.id)).toBe(true);
    expect(childIdsByParentId.get(winningParentId)).toEqual(
      new Set([remoteContainer.id]),
    );
    expect(childIdsByParentId.has(remoteContainer.parentId as string)).toBe(
      false,
    );
    expect(
      await sqlContainerContentsPersistence.loadContainers(
        first.runtime.execSql,
      ),
    ).toHaveLength(1);
  } finally {
    releaseFirstCommit();
    first.close();
    second.close();
  }
});

test("an insert loser cannot repair or publish a concurrently deleted winner", async () => {
  const connection = await openTestConnection({
    dbName: `/${crypto.randomUUID()}.db`,
    key: "container-delete-race",
  });
  try {
    await sqlContainerContentsPersistence.ensureSchema(
      connection.runtime.execSql,
    );
    const winningState = createState(
      connection.runtime,
      sqlContainerContentsPersistence,
    );
    await upsert(winningState);
    const deletingPersistence: ContainerContentsPersistence = {
      ...sqlContainerContentsPersistence,
      commitHydratedContainer: async () => ({ committed: false }),
      async loadContainerMetadataState(execSql, containerId) {
        const stored =
          await sqlContainerContentsPersistence.loadContainerMetadataState(
            execSql,
            containerId,
          );
        await sqlContainerContentsPersistence.deleteContainer(
          execSql,
          containerId,
          {
            reason: "access_revoked",
            updatedAt: remoteContainer.updatedAt,
          },
        );
        return stored;
      },
    };
    const losingState = createState(connection.runtime, deletingPersistence);

    await expect(upsert(losingState)).resolves.toBeNull();
    expect(losingState.containersById.has(remoteContainer.id)).toBe(false);
    await expect(
      sqlContainerContentsPersistence.containerExists(
        connection.runtime.execSql,
        remoteContainer.id,
      ),
    ).resolves.toBe(false);
  } finally {
    connection.close();
  }
});
