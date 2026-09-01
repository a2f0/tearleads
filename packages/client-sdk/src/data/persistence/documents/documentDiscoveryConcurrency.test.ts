import { expect, test } from "bun:test";
import { execDatabaseStatement } from "@tearleads/sqlite-worker/load-sqlite3";
import { initTestSqliteDatabase } from "@tearleads/test-utils";
import { createClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import type { SqlArrayRow, SqlRow } from "../../sqlite/sqlSchema";
import { loadDocumentPurgeCheckpoint } from "../documentPurgeCheckpointPersistence";
import { advanceKeyingCheckpointsAtomically } from "../keyingCheckpointAdvancePersistence";
import { sqlDocumentsPersistence } from "./documentsPersistence";

async function openCoordinatedDocumentConnections() {
  const db = await initTestSqliteDatabase({
    cipher: "chacha20",
    dbName: `/${crypto.randomUUID()}.db`,
    key: "document-discovery-race",
  });
  let transactionOwner: symbol | null = null;
  let transactionReleased: Promise<void> = Promise.resolve();
  let releaseTransaction = () => {};
  let firstReadArmed = false;
  let releaseFirstRead = () => {};
  let firstReadReleased: Promise<void> = Promise.resolve();
  let signalFirstRead = () => {};
  let firstRead: Promise<void> = Promise.resolve();
  let signalSecondBegin = () => {};
  const secondBegin = new Promise<void>((resolve) => {
    signalSecondBegin = resolve;
  });

  const createRuntime = (role: "first" | "second") => {
    const owner = Symbol(role);
    return createClientSQLitePersistenceRuntime({
      exec: async (options) => {
        const command = options.sql.trimStart().toUpperCase();
        const beginsTransaction = command.startsWith("BEGIN");
        const endsTransaction =
          command.startsWith("COMMIT") || command.startsWith("ROLLBACK");
        if (beginsTransaction) {
          if (role === "second") signalSecondBegin();
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
          const rows = execDatabaseStatement(db, options) as Array<
            SqlRow | SqlArrayRow
          >;
          if (
            role === "first" &&
            firstReadArmed &&
            command.startsWith("SELECT") &&
            command.includes('"SNAPSHOT_END_VERSION"')
          ) {
            firstReadArmed = false;
            signalFirstRead();
            await firstReadReleased;
          }
          return { rows };
        } finally {
          if (endsTransaction && transactionOwner === owner) {
            transactionOwner = null;
            releaseTransaction();
          }
        }
      },
    });
  };
  const first = createRuntime("first");
  await sqlDocumentsPersistence.ensureSchema(first.execSql);
  return {
    armFirstDocumentRead() {
      firstReadArmed = true;
      firstRead = new Promise<void>((resolve) => {
        signalFirstRead = resolve;
      });
      firstReadReleased = new Promise<void>((resolve) => {
        releaseFirstRead = resolve;
      });
      return { firstRead, releaseFirstRead };
    },
    close: () => db.close(),
    first,
    second: createRuntime("second"),
    secondBegin,
  };
}

test.each([
  "discovery",
  "relink",
] as const)("%s cannot overwrite a newer pane's document frontier", async (operation) => {
  const race = await openCoordinatedDocumentConnections();
  let releasePausedRead = () => {};
  const base = {
    accessEpoch: 1,
    containerId: "container-a",
    documentId: "remote-document",
    id: "local-document",
    lastCommitLsn: "0/1",
    pendingBaseVersion: "base-frontier",
    pullContinuation: {
      commitLsn: "0/1",
      commitLsnMode: "tracked" as const,
      cursor: "base-cursor",
    },
    snapshotEndVersion: "base-frontier",
    text: "base",
  };
  try {
    await sqlDocumentsPersistence.saveDocument(race.first.execSql, base);
    const { firstRead, releaseFirstRead } = race.armFirstDocumentRead();
    releasePausedRead = releaseFirstRead;
    const structuralWrite =
      operation === "discovery"
        ? sqlDocumentsPersistence.upsertDiscoveredDocument(race.first.execSql, {
            accessEpoch: 1,
            containerId: "container-b",
            createdAt: "2026-08-25T00:00:00.000Z",
            documentId: base.documentId,
            linkedContainerIds: ["container-b"],
          })
        : sqlDocumentsPersistence.relinkPersistedDocument(race.first.execSql, {
            accessEpoch: 1,
            containerId: "container-b",
            documentId: base.documentId,
            localId: base.id,
          });
    await firstRead;

    const frontierWrite = sqlDocumentsPersistence.saveDocument(
      race.second.execSql,
      {
        ...base,
        lastCommitLsn: "0/9",
        pendingBaseVersion: "newer-frontier",
        pullContinuation: {
          commitLsn: "0/9",
          commitLsnMode: "tracked",
          cursor: "newer-cursor",
        },
        snapshotEndVersion: "newer-frontier",
        text: "newer",
      },
    );
    await race.secondBegin;
    releaseFirstRead();
    await Promise.all([structuralWrite, frontierWrite]);

    await expect(
      sqlDocumentsPersistence.loadDocument(race.second.execSql, base.id),
    ).resolves.toMatchObject({
      lastCommitLsn: "0/9",
      pendingBaseVersion: "newer-frontier",
      pullContinuation: { commitLsn: "0/9", cursor: "newer-cursor" },
      snapshotEndVersion: "newer-frontier",
      text: "newer",
    });
  } finally {
    releasePausedRead();
    race.close();
  }
});

test("discovery cannot recreate a document after its purge checkpoint commits", async () => {
  const race = await openCoordinatedDocumentConnections();
  const documentId = "purged-remote-document";
  let releasePurge = () => {};
  const purgeReleased = new Promise<void>((resolve) => {
    releasePurge = resolve;
  });
  let signalPurgeLocked = () => {};
  const purgeLocked = new Promise<void>((resolve) => {
    signalPurgeLocked = resolve;
  });

  try {
    const purge = sqlDocumentsPersistence.deleteDocumentSideRowsIfAbsent(
      race.first.execSql,
      "purged-local-document",
      documentId,
      async (transactionExecSql) => {
        signalPurgeLocked();
        await purgeReleased;
        await advanceKeyingCheckpointsAtomically({
          access: [],
          documentPurgeCheckpoint: {
            documentId,
            documentManifestHash: "document-manifest-hash",
            organizationId: "organization",
            purgeEventHash: "purge-event-hash",
          },
          execSql: transactionExecSql,
          policies: [],
        });
      },
    );
    await purgeLocked;

    const discovery = sqlDocumentsPersistence.upsertDiscoveredDocument(
      race.second.execSql,
      {
        accessEpoch: 1,
        containerId: "container",
        createdAt: "2026-08-26T00:00:00.000Z",
        documentId,
        linkedContainerIds: ["container"],
      },
    );
    releasePurge();

    const [purgeResult, discoveryResult] = await Promise.allSettled([
      purge,
      discovery,
    ]);
    expect(purgeResult).toEqual({ status: "fulfilled", value: true });
    expect(discoveryResult).toMatchObject({
      reason: { code: "rollback" },
      status: "rejected",
    });
    await expect(
      loadDocumentPurgeCheckpoint(race.second.execSql, documentId),
    ).resolves.toMatchObject({ documentId });
    await expect(
      sqlDocumentsPersistence.loadDocument(
        race.second.execSql,
        "purged-local-document",
      ),
    ).resolves.toBeNull();
  } finally {
    releasePurge();
    race.close();
  }
});
