import { expect, test } from "bun:test";
import { bytesToBase64 } from "@symcrypt/encoding";
import { exportAllUpdates } from "@symcrypt/loro";
import { createTestExecSql } from "@symcrypt/test-utils";
import {
  createContainerMetadataDocument,
  writeContainerMetadataValue,
} from "../../data/containers/containerMetadataDocument";
import { defaultContainerContentsPersistence } from "./containerPersistence";
import { reattachDormantContainerMetadata } from "./remoteHydration/reattachMetadata";

const T1 = "2026-01-01T00:00:01.000Z";
const T2 = "2026-01-01T00:00:02.000Z";
const T3 = "2026-01-01T00:00:03.000Z";

test("revoke, restore, and restart preserve metadata page-one recovery", async () => {
  const { close, execSql } = await createTestExecSql(
    "dormant-metadata-recovery-marker",
  );
  try {
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    const metadataDoc = await createContainerMetadataDocument("container-1");
    writeContainerMetadataValue(metadataDoc, { icon: null, name: "Retained" });
    const metadataUpdates = bytesToBase64(exportAllUpdates(metadataDoc));
    const container = {
      effectiveAccessLevel: "write" as const,
      icon: null,
      id: "container-1",
      metadataDocumentId: "metadata-1",
      name: "Retained",
      organizationId: "organization-1",
      parentId: null,
      serverCreatedAt: T1,
      serverUpdatedAt: T1,
    };
    const record = {
      accessEpoch: 1,
      accessStateHash: "access-1",
      documentId: "metadata-1",
      id: container.id,
      metadataUpdates,
      snapshotEndVersion: "",
    };
    await defaultContainerContentsPersistence.saveContainer(
      execSql,
      container,
      record,
      {
        localUpdatedAt: T1,
        serverTimestamps: { createdAt: T1, updatedAt: T1 },
      },
    );
    await execSql(
      `UPDATE documents SET pull_continuation = 'malformed-progress'
       WHERE app_kind = 'container-metadata' AND local_id = ?`,
      [container.id],
    );
    await defaultContainerContentsPersistence.deleteContainers(
      execSql,
      [
        {
          containerId: container.id,
          reason: "access_revoked",
          updatedAt: T2,
        },
      ],
      { retainMetadataForContainerIds: [container.id] },
    );

    const dormant =
      await defaultContainerContentsPersistence.loadContainerMetadataRecord(
        execSql,
        container.id,
      );
    expect(dormant?.pullContinuationRecoveryRequired).toBe(true);
    const restoredDoc = await createContainerMetadataDocument(container.id);
    const reattached = reattachDormantContainerMetadata({
      defaultName: "Untitled",
      doc: restoredDoc,
      dormantRecord: dormant,
      remoteMetadataDocumentId: "metadata-1",
    });
    expect(reattached.pullContinuationRecoveryRequired).toBe(true);

    await expect(
      defaultContainerContentsPersistence.commitHydratedContainer(execSql, {
        container: {
          ...container,
          name: reattached.name,
          serverUpdatedAt: T3,
        },
        expectedDormantRecord: dormant,
        purgeDormantMetadata: false,
        record: {
          ...record,
          lastCommitLsn: reattached.lastCommitLsn,
          metadataUpdates: reattached.initialSnapshot,
          ...(reattached.pullContinuation === undefined
            ? {}
            : { pullContinuation: reattached.pullContinuation }),
          pullContinuationRecoveryRequired: true,
          snapshotEndVersion: reattached.snapshotEndVersion,
        },
        remoteUpdatedAt: T3,
        saveOptions: {
          serverTimestamps: { createdAt: T1, updatedAt: T3 },
        },
      }),
    ).resolves.toMatchObject({ committed: true });

    const restarted =
      await defaultContainerContentsPersistence.loadContainerMetadataState(
        execSql,
        container.id,
      );
    expect(restarted?.record?.pullContinuationRecoveryRequired).toBe(true);
    expect(restarted?.record?.pullContinuation).toBeUndefined();
  } finally {
    close();
  }
});
