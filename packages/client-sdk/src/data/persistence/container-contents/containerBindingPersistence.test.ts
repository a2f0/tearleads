import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import type { ExecSql } from "../../sqlite/sqlSchema";
import { sqlContainerContentsPersistence as persistence } from "./containerContentsPersistence";

const T1 = "2026-01-01T00:00:00.000Z";
const T2 = "2026-01-02T00:00:00.000Z";
const container = {
  effectiveAccessLevel: "write" as const,
  icon: null,
  id: "held-container",
  metadataDocumentId: "held-metadata",
  name: "Held",
  organizationId: "organization-1",
  parentId: "parent-1",
};
const record = {
  accessEpoch: 1,
  accessStateHash: "access-1",
  documentId: "held-metadata",
  id: container.id,
  metadataUpdates: "",
  snapshotEndVersion: "",
};

async function commitRemoteState(
  execSql: ExecSql,
  remote: { metadataDocumentId: string; organizationId: string },
) {
  const current = await persistence.loadContainerMetadataState(
    execSql,
    container.id,
  );
  if (!current?.record) throw new Error("Expected stored metadata state");
  return persistence.commitMetadataMutation(execSql, {
    acceptedPendingUpdateIds: [],
    container: { ...current.container, ...remote },
    expectedContainer: current.container,
    expectedRecord: current.record,
    record: { ...current.record, documentId: remote.metadataDocumentId },
    saveOptions: { serverTimestamps: { createdAt: T1, updatedAt: T2 } },
    settleAcceptedPendingOnConflict: false,
  });
}

test("a server response cannot move a held folder into another organization", async () => {
  const { close, execSql } = await createTestExecSql("held-binding-response");
  try {
    await persistence.ensureSchema(execSql);
    await persistence.saveContainer(execSql, container, record);
    await expect(
      commitRemoteState(execSql, {
        metadataDocumentId: container.metadataDocumentId,
        organizationId: "organization-2",
      }),
    ).rejects.toMatchObject({ code: "object_mismatch" });
    await expect(
      persistence.loadHeldContainerBinding(execSql, container.id),
    ).resolves.toEqual({
      metadataDocumentId: "held-metadata",
      ordinary: true,
      organizationId: "organization-1",
    });
  } finally {
    await close();
  }
});

test("an unbound local folder accepts its first binding", async () => {
  const { close, execSql } = await createTestExecSql("held-binding-first");
  try {
    await persistence.ensureSchema(execSql);
    await persistence.saveContainer(
      execSql,
      { ...container, metadataDocumentId: null, organizationId: "" },
      { ...record, documentId: null },
    );
    await expect(
      commitRemoteState(execSql, {
        metadataDocumentId: "held-metadata",
        organizationId: "organization-1",
      }),
    ).resolves.toMatchObject({ committed: true });
    await expect(
      persistence.loadHeldContainerBinding(execSql, container.id),
    ).resolves.toEqual({
      metadataDocumentId: "held-metadata",
      ordinary: true,
      organizationId: "organization-1",
    });
  } finally {
    await close();
  }
});

test("retained dormant metadata refuses another organization's relisting", async () => {
  const { close, execSql } = await createTestExecSql("held-binding-dormant");
  try {
    await persistence.ensureSchema(execSql);
    await persistence.saveContainer(execSql, container, record);
    // Revocation retains metadata only for unsynced private edits.
    await execSql(
      `INSERT INTO document_pending_updates
      (id, app_kind, local_id, update_data, partial_start_version_vector, partial_end_version_vector, created_at)
      VALUES ('pending-rename', 'container-metadata', ?, 'data', '', '', 'now')`,
      [container.id],
    );
    await persistence.deleteContainers(
      execSql,
      [{ containerId: container.id, reason: "access_revoked", updatedAt: T2 }],
      { discoveryOnly: true },
    );
    const dormantRecord = await persistence.loadContainerMetadataRecord(
      execSql,
      container.id,
    );
    const [fence] = await persistence.loadContainerHydrationTombstones(execSql);
    const relist = (organizationId: string) =>
      persistence.commitHydratedContainer(execSql, {
        container: { ...container, organizationId },
        expectedDormantRecord: dormantRecord,
        expectedHydrationTombstone: fence,
        record: { ...record, accessEpoch: 2 },
        remoteUpdatedAt: T2,
        saveOptions: {},
      });

    await expect(relist("organization-2")).rejects.toMatchObject({
      code: "object_mismatch",
    });
    await expect(
      persistence.loadContainerMetadataRecord(execSql, container.id),
    ).resolves.toEqual(dormantRecord);
    await expect(
      persistence.listPendingUpdates(execSql, container.id),
    ).resolves.toMatchObject([{ id: "pending-rename" }]);
    await expect(
      persistence.loadHeldContainerBinding(execSql, container.id),
    ).resolves.toEqual({
      metadataDocumentId: "held-metadata",
      organizationId: "organization-1",
    });
    await expect(relist("organization-1")).resolves.toMatchObject({
      committed: true,
    });
  } finally {
    await close();
  }
});
