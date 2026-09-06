import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { getLatestTimestamp } from "../latestTimestamp";
import { sqlContainerContentsPersistence as persistence } from "./containerContentsPersistence";

const earlier = "2026-01-01T00:00:00.123Z";
const later = "2026-01-01T00:00:00.123001Z";
const container = {
  id: "child",
  icon: null,
  name: "Child",
  organizationId: "org",
  parentId: "root",
  metadataDocumentId: "metadata",
  serverUpdatedAt: earlier,
};
const record = {
  id: container.id,
  documentId: "metadata",
  accessEpoch: 1,
  accessStateHash: "hash",
  contentKeyBundle: null,
  documentKekTargets: null,
  documentManifestBundle: null,
  lastCommitLsn: null,
  metadataUpdates: "",
  snapshotEndVersion: "",
};

test("microsecond removal deletes an older row and persists a non-regressing hydration fence", async () => {
  const { close, execSql } = await createTestExecSql(
    "microsecond-hydration-fence",
  );
  try {
    await persistence.ensureSchema(execSql);
    await persistence.saveContainer(execSql, container, record);
    expect(getLatestTimestamp(earlier, later)).toBe(later);
    expect(getLatestTimestamp(later, earlier)).toBe(later);
    const deleted = await persistence.deleteContainers(execSql, [
      { containerId: container.id, reason: "access_revoked", updatedAt: later },
    ]);
    expect(deleted.includes(container.id)).toBe(true);
    expect(await persistence.containerExists(execSql, container.id)).toBe(
      false,
    );
    await persistence.deleteContainers(execSql, [
      { containerId: container.id, reason: "deleted", updatedAt: earlier },
    ]);
    expect(await persistence.loadContainerHydrationTombstones(execSql)).toEqual(
      [
        {
          containerId: container.id,
          generation: 2,
          reason: "deleted",
          updatedAt: later,
        },
      ],
    );
    const stale = await persistence.commitHydratedContainer(execSql, {
      container,
      record,
      remoteUpdatedAt: earlier,
      expectedDormantRecord: null,
      purgeDormantMetadata: false,
      saveOptions: {},
    });
    expect(stale.committed).toBe(false);
    const fresh = await persistence.commitHydratedContainer(execSql, {
      container: { ...container, serverUpdatedAt: "2026-01-01T00:00:00.124Z" },
      record,
      remoteUpdatedAt: "2026-01-01T00:00:00.124Z",
      expectedDormantRecord: null,
      purgeDormantMetadata: false,
      saveOptions: {},
    });
    expect(fresh.committed).toBe(true);
  } finally {
    await close();
  }
});
