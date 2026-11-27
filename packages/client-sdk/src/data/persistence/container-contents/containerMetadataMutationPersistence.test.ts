import { expect, test } from "bun:test";
import type { DatabaseConnectionRegistryOptions } from "@tearleads/sqlite-worker/database-connections";
import { execDatabaseStatement } from "@tearleads/sqlite-worker/load-sqlite3";
import { initTestSqliteDatabase } from "@tearleads/test-utils";
import { createSharedWorkerSqliteConnections } from "../../../../test/helpers/data/sharedWorkerSqliteConnections";
import { isDatabaseTransactionBusyError } from "../../sqlite/availability/databaseUnavailable";
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

async function openCoordinatedConnections(
  key: string,
  options: {
    readonly leaseBounds?:
      | DatabaseConnectionRegistryOptions["leaseBounds"]
      | undefined;
  } = {},
) {
  const beginStatements: string[] = [];
  const shared = createSharedWorkerSqliteConnections({
    beforeExec: ({ command }) => {
      if (command.startsWith("BEGIN")) {
        beginStatements.push(command.trimEnd());
      }
    },
    key,
    leaseBounds: options.leaseBounds,
  });
  const first = await shared.connect("first");
  await sqlContainerContentsPersistence.ensureSchema(first.execSql);
  const second = await shared.connect("second");
  return {
    beginStatements,
    close: () => shared.close(),
    first,
    second,
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

async function seedMetadataState(
  execSql: ClientSQLitePersistenceRuntime["execSql"],
  id: string,
  metadataDocumentId: string,
) {
  await sqlContainerContentsPersistence.saveContainer(
    execSql,
    {
      effectiveAccessLevel: "write",
      icon: null,
      id,
      metadataDocumentId,
      name: "Base",
      organizationId: "organization-1",
      parentId: null,
    },
    {
      accessEpoch: 1,
      accessStateHash: "access-1",
      documentId: metadataDocumentId,
      id,
      metadataUpdates: "base",
      snapshotEndVersion: "base-version",
    },
    { localUpdatedAt: T1 },
  );
  const expected =
    await sqlContainerContentsPersistence.loadContainerMetadataState(
      execSql,
      id,
    );
  if (!expected?.record) throw new Error("Expected initial metadata state");
  return { container: expected.container, record: expected.record };
}

test("overlapping metadata CAS writes return one conflict without busy-snapshot", async () => {
  const { beginStatements, close, first, second } =
    await openCoordinatedConnections("metadata-cas-overlap");
  try {
    const expected = await seedMetadataState(
      first.execSql,
      "container-overlap",
      "metadata-overlap",
    );
    beginStatements.length = 0;
    const mutate = (execSql: typeof first.execSql, suffix: string) =>
      sqlContainerContentsPersistence.commitMetadataMutation(execSql, {
        acceptedPendingUpdateIds: [],
        container: { ...expected.container, name: suffix },
        expectedContainer: expected.container,
        expectedRecord: expected.record,
        record: {
          ...expected.record,
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
    await close();
  }
});

test("a metadata CAS write refused busy is not a conflict verdict and retries cleanly", async () => {
  const { close, first, second } = await openCoordinatedConnections(
    "metadata-cas-busy",
    { leaseBounds: { idleMs: 60_000, waitMs: 50 } },
  );
  try {
    const expected = await seedMetadataState(
      first.execSql,
      "container-busy",
      "metadata-busy",
    );
    const rename = () =>
      sqlContainerContentsPersistence.commitMetadataMutation(second.execSql, {
        acceptedPendingUpdateIds: [],
        container: { ...expected.container, name: "Renamed" },
        expectedContainer: expected.container,
        expectedRecord: expected.record,
        record: {
          ...expected.record,
          metadataUpdates: "renamed",
          snapshotEndVersion: "renamed-version",
        },
        saveOptions: { localUpdatedAt: T2 },
        settleAcceptedPendingOnConflict: false,
      });

    await first.execSql("BEGIN IMMEDIATE");
    const refused = await rename().then(
      () => null,
      (error: unknown) => error,
    );
    expect(isDatabaseTransactionBusyError(refused)).toBe(true);

    await first.execSql("ROLLBACK");
    await expect(rename()).resolves.toMatchObject({ committed: true });
  } finally {
    await first.execSql("ROLLBACK").catch(() => undefined);
    await close();
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
      `UPDATE documents
       SET sync_failure_message = 'quarantined', sync_failure_attempted_at = ?
       WHERE app_kind = 'container-metadata' AND local_id = ?`,
      [T2, container.id],
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
        `SELECT sync_failure_message AS message FROM documents
         WHERE app_kind = 'container-metadata' AND local_id = ?
           AND sync_failure_message IS NOT NULL`,
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
        `SELECT sync_failure_message AS message FROM documents
         WHERE app_kind = 'container-metadata' AND local_id = ?
           AND sync_failure_message IS NOT NULL`,
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
    // The signed metadata document id is immutable: a lower-epoch record for
    // another document is a rebinding, never a replacement.
    await expect(
      sqlContainerContentsPersistence.commitMetadataMutation(runtime.execSql, {
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
      }),
    ).rejects.toMatchObject({ code: "object_mismatch" });
    await expect(
      sqlContainerContentsPersistence.loadContainerMetadataState(
        runtime.execSql,
        container.id,
      ),
    ).resolves.toMatchObject({
      container: { metadataDocumentId: container.metadataDocumentId },
      record: {
        accessEpoch: 2,
        accessStateHash: "access-2",
        documentId: container.metadataDocumentId,
      },
    });
  } finally {
    close();
  }
});
