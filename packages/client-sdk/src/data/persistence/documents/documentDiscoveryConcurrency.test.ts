import { expect, test } from "bun:test";
import type { DatabaseConnectionRegistryOptions } from "@tearleads/sqlite-worker/database-connections";
import { createSharedWorkerSqliteConnections } from "../../../../test/helpers/data/sharedWorkerSqliteConnections";
import { isDatabaseTransactionBusyError } from "../../sqlite/availability/databaseUnavailable";
import { deleteDocumentPlacements } from "../container-contents/documentContainerProjectionPersistence";
import { KeyingCheckpointRepository } from "../keyingCheckpoints/keyingCheckpointRepository";
import { sqlDocumentsPersistence } from "./documentsPersistence";

async function openCoordinatedDocumentConnections(
  options: {
    readonly leaseBounds?:
      | DatabaseConnectionRegistryOptions["leaseBounds"]
      | undefined;
  } = {},
) {
  let firstReadArmed = false;
  let releaseFirstRead = () => {};
  let firstReadReleased: Promise<void> = Promise.resolve();
  let signalFirstRead = () => {};
  let firstRead: Promise<void> = Promise.resolve();
  let signalSecondBegin = () => {};
  const secondBegin = new Promise<void>((resolve) => {
    signalSecondBegin = resolve;
  });

  const shared = createSharedWorkerSqliteConnections({
    afterExec: async ({ command, role }) => {
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
    },
    beforeExec: ({ command, role }) => {
      if (role === "second" && command.startsWith("BEGIN")) {
        signalSecondBegin();
      }
    },
    key: "document-discovery-race",
    leaseBounds: options.leaseBounds,
  });

  const first = await shared.connect("first");
  await sqlDocumentsPersistence.ensureSchema(first.execSql);
  const second = await shared.connect("second");
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
    close: () => shared.close(),
    first,
    second,
    secondBegin,
  };
}

test.each(["discovery", "relink"] as const)(
  "%s cannot overwrite a newer pane's document frontier",
  async (operation) => {
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
          ? sqlDocumentsPersistence.upsertDiscoveredDocument(
              race.first.execSql,
              {
                accessEpoch: 1,
                containerId: "container-b",
                createdAt: "2026-08-25T00:00:00.000Z",
                documentId: base.documentId,
                linkedContainerIds: ["container-b"],
              },
            )
          : sqlDocumentsPersistence.relinkPersistedDocument(
              race.first.execSql,
              {
                accessEpoch: 1,
                containerId: "container-b",
                documentId: base.documentId,
                localId: base.id,
              },
            );
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
      await race.close();
    }
  },
);

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
        await new KeyingCheckpointRepository(
          transactionExecSql,
        ).advanceKeyingCheckpointsAtomically({
          access: [],
          documentPurgeCheckpoint: {
            documentId,
            documentManifestHash: "document-manifest-hash",
            organizationId: "organization",
            purgeEventHash: "purge-event-hash",
          },
          policies: [],
        });
      },
      deleteDocumentPlacements,
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
      new KeyingCheckpointRepository(
        race.second.execSql,
      ).loadDocumentPurgeCheckpoint(documentId),
    ).resolves.toMatchObject({ documentId });
    await expect(
      sqlDocumentsPersistence.loadDocument(
        race.second.execSql,
        "purged-local-document",
      ),
    ).resolves.toBeNull();
  } finally {
    releasePurge();
    await race.close();
  }
});

test("a busy refusal behind an in-flight purge is not a rollback verdict and retries cleanly", async () => {
  const race = await openCoordinatedDocumentConnections({
    leaseBounds: { idleMs: 60_000, waitMs: 50 },
  });
  const documentId = "busy-discovery-document";
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
      "busy-local-document",
      documentId,
      async () => {
        signalPurgeLocked();
        await purgeReleased;
      },
      deleteDocumentPlacements,
    );
    await purgeLocked;

    const refused = await sqlDocumentsPersistence
      .upsertDiscoveredDocument(race.second.execSql, {
        accessEpoch: 1,
        containerId: "container",
        createdAt: "2026-08-26T00:00:00.000Z",
        documentId,
        linkedContainerIds: ["container"],
      })
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(isDatabaseTransactionBusyError(refused)).toBe(true);
    expect(refused).not.toMatchObject({ code: "rollback" });

    releasePurge();
    await expect(purge).resolves.toBe(true);

    const retried = await sqlDocumentsPersistence.upsertDiscoveredDocument(
      race.second.execSql,
      {
        accessEpoch: 1,
        containerId: "container",
        createdAt: "2026-08-26T00:00:00.000Z",
        documentId,
        linkedContainerIds: ["container"],
      },
    );
    expect(retried.documentId).toBe(documentId);
  } finally {
    releasePurge();
    await race.close();
  }
});
