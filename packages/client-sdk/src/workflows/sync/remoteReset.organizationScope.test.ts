import { expect, test } from "bun:test";
import { createTestExecSql } from "@symcrypt/test-utils";
import { eq } from "drizzle-orm";
import {
  clientSqlTables,
  containerSyncWatermarks,
  containers,
  documentProjection,
  documents,
} from "../../data/sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../data/sqlite/sqlitePersistenceRuntime";
import { ensureSqlTables } from "../../data/sqlite/sqlTableSchema";
import { clearRemoteSyncState } from "./remoteReset";

const STALE = "2026-08-01T00:00:00.000Z";

test("remote reset rebinds only the purged organization to its replacement", async () => {
  const { close, execSql } = await createTestExecSql(
    "sync-remote-reset-organization-scope",
  );
  try {
    await ensureSqlTables(execSql, clientSqlTables);
    const { db } = getClientSQLitePersistenceRuntime(execSql);
    await db.insert(containers).values([
      {
        id: "old-root",
        organizationId: "org-old",
        parentId: null,
        metadataDocumentId: "old-metadata-id",
        systemSlot: "root",
        localCreatedAt: STALE,
        localUpdatedAt: STALE,
      },
      {
        id: "keep-root",
        organizationId: "org-keep",
        parentId: null,
        metadataDocumentId: "keep-metadata-id",
        systemSlot: "root",
        localCreatedAt: STALE,
        localUpdatedAt: STALE,
      },
    ]);
    await db.insert(documents).values([
      {
        appKind: "documents",
        localId: "old-local",
        documentId: "shared-old-document-id",
        updatedAt: STALE,
      },
      {
        appKind: "documents",
        localId: "keep-local",
        documentId: "keep-document-id",
        updatedAt: STALE,
      },
    ]);
    await db.insert(documentProjection).values([
      {
        localId: "old-local",
        documentId: "shared-old-document-id",
        containerId: "old-root",
        updatedAt: STALE,
      },
      {
        localId: "keep-local",
        documentId: "keep-document-id",
        containerId: "keep-root",
        updatedAt: STALE,
      },
    ]);
    await db.insert(containerSyncWatermarks).values([
      {
        laneKind: "container_parent",
        laneId: "org-old:root",
        watermarkUpdatedAt: STALE,
        watermarkId: "old-root",
        updatedAt: STALE,
      },
      {
        laneKind: "container_parent",
        laneId: "org-keep:root",
        watermarkUpdatedAt: STALE,
        watermarkId: "keep-root",
        updatedAt: STALE,
      },
    ]);

    await clearRemoteSyncState(execSql, {
      organizationId: "org-old",
      replacement: {
        organizationId: "org-new",
        rootContainerId: "new-root",
      },
    });

    const [resetDocument] = await db
      .select()
      .from(documents)
      .where(eq(documents.localId, "old-local"));
    expect(resetDocument).toEqual(
      expect.objectContaining({
        documentId: null,
        recoveryDocumentId: "shared-old-document-id",
      }),
    );
    const [keptDocument] = await db
      .select()
      .from(documents)
      .where(eq(documents.localId, "keep-local"));
    expect(keptDocument).toEqual(
      expect.objectContaining({
        documentId: "keep-document-id",
        recoveryDocumentId: null,
      }),
    );
    const [resetContainer] = await db
      .select()
      .from(containers)
      .where(eq(containers.id, "old-root"));
    expect(resetContainer).toEqual(
      expect.objectContaining({
        organizationId: "org-new",
        parentId: "new-root",
        systemSlot: null,
      }),
    );
    expect(
      (
        await db.select().from(containers).where(eq(containers.id, "keep-root"))
      )[0],
    ).toEqual(
      expect.objectContaining({
        metadataDocumentId: "keep-metadata-id",
        organizationId: "org-keep",
        systemSlot: "root",
      }),
    );
    expect(await db.select().from(containerSyncWatermarks)).toEqual([
      expect.objectContaining({ laneId: "org-keep:root" }),
    ]);
  } finally {
    close();
  }
});
