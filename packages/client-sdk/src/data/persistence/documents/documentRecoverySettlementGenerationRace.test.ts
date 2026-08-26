import { expect, test } from "bun:test";
import { openSharedDocumentPersistenceConnections } from "../../../../test/helpers/sharedDocumentPersistence";
import { sqlDocumentsPersistence } from "./documentsPersistence";

test("recovery generation fences stale conflict and response settlement", async () => {
  const { close, first, second } =
    await openSharedDocumentPersistenceConnections(
      "document-recovery-settlement-generation-race",
    );
  const base = {
    accessEpoch: 1,
    containerId: "container",
    documentId: "document",
    id: "local-document",
    snapshotEndVersion: "base-version",
    text: "base",
  };
  let releaseRecovery = () => {};
  const recoveryBlocked = new Promise<void>((resolve) => {
    releaseRecovery = resolve;
  });

  try {
    await sqlDocumentsPersistence.saveDocument(first.runtime.execSql, base);
    for (const suffix of ["first", "second"]) {
      await sqlDocumentsPersistence.enqueuePendingUpdate(
        first.runtime.execSql,
        {
          localId: base.id,
          partialEndVersionVector: `${suffix}-end`,
          partialStartVersionVector: `${suffix}-start`,
          updateData: btoa(`${suffix}-update`),
        },
      );
    }
    const pendingBeforeRecovery =
      await sqlDocumentsPersistence.listPendingUpdates(
        first.runtime.execSql,
        base.id,
      );
    expect(pendingBeforeRecovery).toHaveLength(2);
    const [firstPending, secondPending] = pendingBeforeRecovery;
    if (!firstPending || !secondPending) {
      throw new Error("Expected both pending updates");
    }
    const expectedRecord = await sqlDocumentsPersistence.loadDocument(
      first.runtime.execSql,
      base.id,
    );
    if (!expectedRecord) throw new Error("Expected the stored document");

    let signalRecoveryLock = () => {};
    const recoveryLocked = new Promise<void>((resolve) => {
      signalRecoveryLock = resolve;
    });
    const recovery = sqlDocumentsPersistence.commitDocumentMutation(
      first.runtime.execSql,
      {
        acceptedPendingUpdateIds: [],
        document: { ...expectedRecord, recoveryGeneration: 1 },
        expectedRecord,
        settleAcceptedPendingOnConflict: false,
      },
      async () => {
        signalRecoveryLock();
        await recoveryBlocked;
      },
    );
    await recoveryLocked;

    const staleConflict = sqlDocumentsPersistence.commitDocumentMutation(
      second.runtime.execSql,
      {
        acceptedPendingUpdateIds: [firstPending.id],
        document: { ...expectedRecord, text: "stale conflict" },
        expectedRecord,
        settleAcceptedPendingOnConflict: true,
      },
      async () => undefined,
    );
    releaseRecovery();

    await expect(recovery).resolves.toMatchObject({ committed: true });
    await expect(staleConflict).resolves.toMatchObject({ committed: false });
    await expect(
      sqlDocumentsPersistence.listPendingUpdates(
        first.runtime.execSql,
        base.id,
      ),
    ).resolves.toEqual(pendingBeforeRecovery);

    await sqlDocumentsPersistence.settleAcceptedPendingUpdates(
      second.runtime.execSql,
      {
        expectedRecord,
        pendingUpdateIds: [secondPending.id],
      },
    );
    await expect(
      sqlDocumentsPersistence.listPendingUpdates(
        first.runtime.execSql,
        base.id,
      ),
    ).resolves.toEqual(pendingBeforeRecovery);
  } finally {
    releaseRecovery();
    close();
  }
});
