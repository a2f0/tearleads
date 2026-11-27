import { expect, test } from "bun:test";
import type { DatabaseConnectionRegistryOptions } from "@tearleads/sqlite-worker/database-connections";
import { createSharedWorkerSqliteConnections } from "../../../test/helpers/data/sharedWorkerSqliteConnections";
import { createDocumentProjectorRegistry } from "../../data/documents";
import { deleteDocumentPlacements } from "../../data/persistence/container-contents/documentContainerProjectionPersistence";
import { sqlDocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
import { isDatabaseTransactionBusyError } from "../../data/sqlite/availability/databaseUnavailable";
import { refuseDeletedDocumentPersist } from "./documentPersistGuards";

async function openDocumentRaceConnections(
  options: {
    readonly leaseBounds?:
      | DatabaseConnectionRegistryOptions["leaseBounds"]
      | undefined;
  } = {},
) {
  let releaseAbsentRead = () => {};
  const absentReadReleased = new Promise<void>((resolve) => {
    releaseAbsentRead = resolve;
  });
  let signalAbsentRead = () => {};
  const absentRead = new Promise<void>((resolve) => {
    signalAbsentRead = resolve;
  });
  let signalCreateBegin = () => {};
  const createBegin = new Promise<void>((resolve) => {
    signalCreateBegin = resolve;
  });
  let didPauseAbsentRead = false;

  const shared = createSharedWorkerSqliteConnections({
    afterExec: async ({ command, role }) => {
      if (
        role === "cleanup" &&
        !didPauseAbsentRead &&
        command.startsWith("SELECT") &&
        command.includes('FROM "DOCUMENTS"')
      ) {
        didPauseAbsentRead = true;
        signalAbsentRead();
        await absentReadReleased;
      }
    },
    beforeExec: ({ command, role }) => {
      if (role === "create" && command.startsWith("BEGIN")) {
        signalCreateBegin();
      }
    },
    key: "document-delete-create-race",
    leaseBounds: options.leaseBounds,
  });

  const cleanup = await shared.connect("cleanup");
  await sqlDocumentsPersistence.ensureSchema(cleanup.execSql);
  const create = await shared.connect("create");
  return {
    absentRead,
    cleanup,
    close: () => shared.close(),
    create,
    createBegin,
    releaseAbsentRead,
  };
}

test("an initializer racing absent-row cleanup keeps its new document", async () => {
  const race = await openDocumentRaceConnections();
  const localId = "racing-document";
  let clientProjectionDeletes = 0;
  const documentProjectors = createDocumentProjectorRegistry([
    {
      clientProjection: {
        delete: () => {
          clientProjectionDeletes += 1;
        },
        save: () => undefined,
        tables: [],
      },
      kind: "contact",
    },
  ]);
  try {
    const cleanup = refuseDeletedDocumentPersist({
      currentRecord: {
        accessEpoch: 1,
        containerId: "stale-container",
        documentId: "stale-document",
        documentKind: "contact",
        id: localId,
        snapshotEndVersion: "stale-version",
        text: "stale",
      },
      deleteDocumentPlacements,
      documentProjectors,
      execSql: race.cleanup.execSql,
      localId,
      persistence: sqlDocumentsPersistence,
    });
    await race.absentRead;

    const create = sqlDocumentsPersistence.createDocumentWithHistoryCheckpoint(
      race.create.execSql,
      {
        accessEpoch: 1,
        containerId: "fresh-container",
        documentId: "fresh-document",
        id: localId,
        snapshotEndVersion: "fresh-version",
        text: "fresh",
      },
      { endVersionVector: "fresh-version", snapshot: "fresh-snapshot" },
      undefined,
      async () => undefined,
    );
    await race.createBegin;
    race.releaseAbsentRead();

    expect(await cleanup).toBe(true);
    expect(await create).not.toBeNull();
    expect(clientProjectionDeletes).toBe(1);
    expect(
      await sqlDocumentsPersistence.loadDocument(race.create.execSql, localId),
    ).toMatchObject({ documentId: "fresh-document", text: "fresh" });
  } finally {
    race.releaseAbsentRead();
    await race.close();
  }
});

test("a create refused busy behind absent-row cleanup is not treated as an existing row and retries cleanly", async () => {
  const race = await openDocumentRaceConnections({
    leaseBounds: { idleMs: 60_000, waitMs: 50 },
  });
  const localId = "busy-racing-document";
  let clientProjectionDeletes = 0;
  const documentProjectors = createDocumentProjectorRegistry([
    {
      clientProjection: {
        delete: () => {
          clientProjectionDeletes += 1;
        },
        save: () => undefined,
        tables: [],
      },
      kind: "contact",
    },
  ]);
  let cleanup: Promise<unknown> = Promise.resolve();
  try {
    cleanup = refuseDeletedDocumentPersist({
      currentRecord: {
        accessEpoch: 1,
        containerId: "stale-container",
        documentId: "stale-document",
        documentKind: "contact",
        id: localId,
        snapshotEndVersion: "stale-version",
        text: "stale",
      },
      deleteDocumentPlacements,
      documentProjectors,
      execSql: race.cleanup.execSql,
      localId,
      persistence: sqlDocumentsPersistence,
    });
    await race.absentRead;

    const refused = await sqlDocumentsPersistence
      .createDocumentWithHistoryCheckpoint(
        race.create.execSql,
        {
          accessEpoch: 1,
          containerId: "fresh-container",
          documentId: "fresh-document",
          id: localId,
          snapshotEndVersion: "fresh-version",
          text: "fresh",
        },
        { endVersionVector: "fresh-version", snapshot: "fresh-snapshot" },
        undefined,
        async () => undefined,
      )
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(isDatabaseTransactionBusyError(refused)).toBe(true);

    race.releaseAbsentRead();
    expect(await cleanup).toBe(true);
    expect(clientProjectionDeletes).toBe(1);

    const retried =
      await sqlDocumentsPersistence.createDocumentWithHistoryCheckpoint(
        race.create.execSql,
        {
          accessEpoch: 1,
          containerId: "fresh-container",
          documentId: "fresh-document",
          id: localId,
          snapshotEndVersion: "fresh-version",
          text: "fresh",
        },
        { endVersionVector: "fresh-version", snapshot: "fresh-snapshot" },
        undefined,
        async () => undefined,
      );
    expect(retried).not.toBeNull();
    expect(
      await sqlDocumentsPersistence.loadDocument(race.create.execSql, localId),
    ).toMatchObject({ documentId: "fresh-document", text: "fresh" });
  } finally {
    race.releaseAbsentRead();
    await cleanup.catch(() => undefined);
    await race.close();
  }
});
