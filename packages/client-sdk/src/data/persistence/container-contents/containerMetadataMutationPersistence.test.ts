import { expect, test } from "bun:test";
import { execDatabaseStatement } from "@tearleads/sqlite-worker/load-sqlite3";
import { initTestSqliteDatabase } from "@tearleads/test-utils";
import {
  type ClientSQLitePersistenceRuntime,
  createClientSQLitePersistenceRuntime,
} from "../../sqlite/sqlitePersistenceRuntime";
import type { SqlArrayRow, SqlRow } from "../../sqlite/sqlSchema";
import { sqlContainerContentsPersistence } from "./containerContentsPersistence";

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

async function openCoordinatedConnections(key: string) {
  const db = await initTestSqliteDatabase({
    cipher: "chacha20",
    dbName: `/${crypto.randomUUID()}.db`,
    key,
  });
  let transactionOwner: symbol | null = null;
  let transactionReleased: Promise<void> = Promise.resolve();
  let releaseTransaction = () => {};
  const beginStatements: string[] = [];
  const createRuntime = (): ClientSQLitePersistenceRuntime => {
    const owner = Symbol("pane-executor");
    return createClientSQLitePersistenceRuntime({
      exec: async (options) => {
        const command = options.sql.trim().toUpperCase();
        const beginsTransaction = command.startsWith("BEGIN");
        const endsTransaction =
          command.startsWith("COMMIT") || command.startsWith("ROLLBACK");
        if (beginsTransaction) {
          beginStatements.push(command);
          while (transactionOwner !== null && transactionOwner !== owner) {
            await transactionReleased;
          }
          if (transactionOwner === null) {
            transactionOwner = owner;
            transactionReleased = new Promise<void>((resolve) => {
              releaseTransaction = resolve;
            });
          }
        } else {
          while (transactionOwner !== null && transactionOwner !== owner) {
            await transactionReleased;
          }
        }
        try {
          return {
            rows: execDatabaseStatement(db, options) as Array<
              SqlRow | SqlArrayRow
            >,
          };
        } finally {
          if (endsTransaction && transactionOwner === owner) {
            transactionOwner = null;
            releaseTransaction();
          }
        }
      },
    });
  };
  const first = createRuntime();
  await sqlContainerContentsPersistence.ensureSchema(first.execSql);
  return {
    beginStatements,
    close: () => db.close(),
    first,
    second: createRuntime(),
  };
}

const T1 = "2026-01-01T00:00:01.000Z";
const T2 = "2026-01-01T00:00:02.000Z";
const T3 = "2026-01-01T00:00:03.000Z";

test("a stale metadata mutation cannot erase a hydrated creation timestamp", async () => {
  const dbName = `/${crypto.randomUUID()}.db`;
  const first = await openTestConnection({ dbName, key: "metadata-cas" });
  await sqlContainerContentsPersistence.ensureSchema(first.runtime.execSql);
  const second = await openTestConnection({ dbName, key: "metadata-cas" });
  try {
    await Promise.all(
      [first.runtime.execSql, second.runtime.execSql].map((execSql) =>
        execSql("PRAGMA busy_timeout = 5000"),
      ),
    );
    const container = {
      effectiveAccessLevel: "write" as const,
      icon: null,
      id: "container-1",
      metadataDocumentId: "metadata-1",
      name: "Container",
      organizationId: "organization-1",
      parentId: null,
    };
    const record = {
      accessEpoch: 1,
      accessStateHash: "access-1",
      documentId: "metadata-1",
      id: container.id,
      metadataUpdates: "",
      snapshotEndVersion: "",
    };
    await sqlContainerContentsPersistence.saveContainer(
      first.runtime.execSql,
      container,
      record,
      {
        localUpdatedAt: T2,
        serverTimestamps: { createdAt: null, updatedAt: T2 },
      },
    );
    const staleState =
      await sqlContainerContentsPersistence.loadContainerMetadataState(
        first.runtime.execSql,
        container.id,
      );
    if (!staleState?.record) throw new Error("Expected stale metadata state");
    expect(staleState.container.serverCreatedAt).toBeNull();

    await sqlContainerContentsPersistence.saveContainer(
      second.runtime.execSql,
      staleState.container,
      staleState.record,
      {
        localUpdatedAt: T2,
        serverTimestamps: { createdAt: T1, updatedAt: T2 },
      },
    );

    const result = await sqlContainerContentsPersistence.commitMetadataMutation(
      first.runtime.execSql,
      {
        acceptedPendingUpdateIds: [],
        container: { ...staleState.container, name: "Stale rename" },
        expectedContainer: staleState.container,
        expectedRecord: staleState.record,
        record: { ...staleState.record, metadataUpdates: "stale update" },
        saveOptions: { localUpdatedAt: T3 },
        settleAcceptedPendingOnConflict: false,
      },
    );

    expect(result).toMatchObject({
      committed: false,
      currentState: {
        container: { name: "Container", serverCreatedAt: T1 },
      },
    });
    await expect(
      sqlContainerContentsPersistence.loadContainerMetadataState(
        first.runtime.execSql,
        container.id,
      ),
    ).resolves.toMatchObject({
      container: { name: "Container", serverCreatedAt: T1 },
      record: { metadataUpdates: "" },
    });
  } finally {
    first.close();
    second.close();
  }
});

test("overlapping metadata CAS writes return one conflict without busy-snapshot", async () => {
  const { beginStatements, close, first, second } =
    await openCoordinatedConnections("metadata-cas-overlap");
  try {
    const container = {
      effectiveAccessLevel: "write" as const,
      icon: null,
      id: "container-overlap",
      metadataDocumentId: "metadata-overlap",
      name: "Base",
      organizationId: "organization-1",
      parentId: null,
    };
    const record = {
      accessEpoch: 1,
      accessStateHash: "access-1",
      documentId: "metadata-overlap",
      id: container.id,
      metadataUpdates: "base",
      snapshotEndVersion: "base-version",
    };
    await sqlContainerContentsPersistence.saveContainer(
      first.execSql,
      container,
      record,
      { localUpdatedAt: T1 },
    );
    const expected =
      await sqlContainerContentsPersistence.loadContainerMetadataState(
        first.execSql,
        container.id,
      );
    const expectedRecord = expected?.record;
    if (!expected || !expectedRecord) {
      throw new Error("Expected initial metadata state");
    }
    beginStatements.length = 0;
    const mutate = (execSql: typeof first.execSql, suffix: string) =>
      sqlContainerContentsPersistence.commitMetadataMutation(execSql, {
        acceptedPendingUpdateIds: [],
        container: { ...expected.container, name: suffix },
        expectedContainer: expected.container,
        expectedRecord,
        record: {
          ...expectedRecord,
          metadataUpdates: suffix,
          snapshotEndVersion: `${suffix}-version`,
        },
        saveOptions: { localUpdatedAt: T2 },
        settleAcceptedPendingOnConflict: false,
      });

    const results = await Promise.all([
      mutate(first.execSql, "first"),
      mutate(second.execSql, "second"),
    ]);

    expect(results.filter(({ committed }) => committed)).toHaveLength(1);
    expect(results.filter(({ committed }) => !committed)).toHaveLength(1);
    expect(beginStatements).toEqual(["BEGIN IMMEDIATE", "BEGIN IMMEDIATE"]);
  } finally {
    close();
  }
});

test("metadata failure clearance commits only with the expected state", async () => {
  const { close, runtime } = await openTestConnection({
    dbName: `/${crypto.randomUUID()}.db`,
    key: "metadata-failure-clearance-cas",
  });
  try {
    await sqlContainerContentsPersistence.ensureSchema(runtime.execSql);
    const container = {
      effectiveAccessLevel: "write" as const,
      icon: null,
      id: "container-failure-clearance",
      metadataDocumentId: "metadata-failure-clearance",
      name: "Container",
      organizationId: "organization-1",
      parentId: null,
    };
    const record = {
      accessEpoch: 1,
      accessStateHash: "access-1",
      documentId: container.metadataDocumentId,
      id: container.id,
      metadataUpdates: "current",
      snapshotEndVersion: "current-version",
    };
    await sqlContainerContentsPersistence.saveContainer(
      runtime.execSql,
      container,
      record,
      { localUpdatedAt: T1 },
    );
    await runtime.execSql(
      `INSERT INTO document_sync_failures
        (app_kind, local_id, status, message, attempted_at)
       VALUES ('container-metadata', ?, NULL, 'quarantined', ?)`,
      [container.id, T2],
    );
    const current =
      await sqlContainerContentsPersistence.loadContainerMetadataState(
        runtime.execSql,
        container.id,
      );
    if (!current?.record) throw new Error("Expected metadata state");

    await expect(
      sqlContainerContentsPersistence.commitMetadataMutation(runtime.execSql, {
        acceptedPendingUpdateIds: [],
        clearSyncFailure: true,
        container: current.container,
        expectedContainer: current.container,
        expectedRecord: { ...current.record, metadataUpdates: "stale" },
        record: current.record,
        settleAcceptedPendingOnConflict: false,
      }),
    ).resolves.toMatchObject({ committed: false });
    expect(
      await runtime.execSql(
        `SELECT message FROM document_sync_failures
         WHERE app_kind = 'container-metadata' AND local_id = ?`,
        [container.id],
      ),
    ).toEqual([{ message: "quarantined" }]);

    await expect(
      sqlContainerContentsPersistence.commitMetadataMutation(runtime.execSql, {
        acceptedPendingUpdateIds: [],
        clearSyncFailure: true,
        container: current.container,
        expectedContainer: current.container,
        expectedRecord: current.record,
        record: current.record,
        settleAcceptedPendingOnConflict: false,
      }),
    ).resolves.toMatchObject({ committed: true });
    expect(
      await runtime.execSql(
        `SELECT message FROM document_sync_failures
         WHERE app_kind = 'container-metadata' AND local_id = ?`,
        [container.id],
      ),
    ).toEqual([]);
  } finally {
    close();
  }
});

test("an out-of-order remote mutation cannot roll back a metadata access epoch", async () => {
  const { close, runtime } = await openTestConnection({
    dbName: `/${crypto.randomUUID()}.db`,
    key: "metadata-access-epoch-order",
  });
  try {
    await sqlContainerContentsPersistence.ensureSchema(runtime.execSql);
    const container = {
      effectiveAccessLevel: "write" as const,
      icon: null,
      id: "container-epoch-order",
      metadataDocumentId: "metadata-epoch-order",
      name: "Container",
      organizationId: "organization-1",
      parentId: null,
    };
    const currentRecord = {
      accessEpoch: 2,
      accessStateHash: "access-2",
      documentId: container.metadataDocumentId,
      id: container.id,
      metadataUpdates: "current",
      snapshotEndVersion: "current-version",
    };
    await sqlContainerContentsPersistence.saveContainer(
      runtime.execSql,
      container,
      currentRecord,
      {
        localUpdatedAt: T2,
        serverTimestamps: { createdAt: T1, updatedAt: T2 },
      },
    );
    const expected =
      await sqlContainerContentsPersistence.loadContainerMetadataState(
        runtime.execSql,
        container.id,
      );
    if (!expected?.record) throw new Error("Expected current metadata state");

    const result = await sqlContainerContentsPersistence.commitMetadataMutation(
      runtime.execSql,
      {
        acceptedPendingUpdateIds: [],
        container: expected.container,
        expectedContainer: expected.container,
        expectedRecord: expected.record,
        record: {
          ...expected.record,
          accessEpoch: 1,
          accessStateHash: "access-1",
          metadataUpdates: "stale",
          snapshotEndVersion: "stale-version",
        },
        saveOptions: {
          localUpdatedAt: T2,
          serverTimestamps: { createdAt: T1, updatedAt: T2 },
        },
        settleAcceptedPendingOnConflict: false,
      },
    );

    expect(result).toMatchObject({
      committed: false,
      currentState: {
        record: {
          accessEpoch: 2,
          accessStateHash: "access-2",
          metadataUpdates: "current",
        },
      },
      staleServerState: true,
    });
    await expect(
      sqlContainerContentsPersistence.loadContainerMetadataState(
        runtime.execSql,
        container.id,
      ),
    ).resolves.toMatchObject({
      record: {
        accessEpoch: 2,
        accessStateHash: "access-2",
        metadataUpdates: "current",
      },
    });

    const replacementExpected =
      await sqlContainerContentsPersistence.loadContainerMetadataState(
        runtime.execSql,
        container.id,
      );
    if (!replacementExpected?.record) {
      throw new Error("Expected metadata state before replacement");
    }
    const replacement =
      await sqlContainerContentsPersistence.commitMetadataMutation(
        runtime.execSql,
        {
          acceptedPendingUpdateIds: [],
          container: {
            ...replacementExpected.container,
            metadataDocumentId: "replacement-metadata",
          },
          expectedContainer: replacementExpected.container,
          expectedRecord: replacementExpected.record,
          record: {
            ...replacementExpected.record,
            accessEpoch: 1,
            accessStateHash: "replacement-access-1",
            documentId: "replacement-metadata",
          },
          saveOptions: {
            localUpdatedAt: T2,
            serverTimestamps: { createdAt: T1, updatedAt: T2 },
          },
          settleAcceptedPendingOnConflict: false,
        },
      );
    expect(replacement).toMatchObject({ committed: true });
    await expect(
      sqlContainerContentsPersistence.loadContainerMetadataState(
        runtime.execSql,
        container.id,
      ),
    ).resolves.toMatchObject({
      record: {
        accessEpoch: 1,
        accessStateHash: "replacement-access-1",
        documentId: "replacement-metadata",
      },
    });
  } finally {
    close();
  }
});
