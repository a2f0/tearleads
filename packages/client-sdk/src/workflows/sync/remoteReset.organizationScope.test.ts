import { expect, test } from "bun:test";
import { createTestExecSql } from "@symcrypt/test-utils";
import { eq } from "drizzle-orm";
import {
  clientSqlTables,
  containerSyncWatermarks,
  containers,
  documentProjection,
  documents,
  principalPolicies,
  principalPolicyBundleHistory,
  principalPolicyBundleReferences,
  principalPolicyCheckpoints,
  principalPolicyOrganizations,
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

test("remote reset clears owned policy caches without read-model rows", async () => {
  const { close, execSql } = await createTestExecSql(
    "sync-remote-reset-owned-policy-scope",
  );
  try {
    await ensureSqlTables(execSql, clientSqlTables);
    const { db } = getClientSQLitePersistenceRuntime(execSql);
    const policyRow = (principalId: string, stateHash: string) => ({
      principalType: "group" as const,
      principalId,
      stateHash,
      currentStateJson: "{}",
      currentPayloadJson: "{}",
      currentProjectionJson: "[]",
      currentGrantsJson: "[]",
      currentMemberEnvelopesJson: "[]",
      previousStatesJson: "[]",
      updatedAt: STALE,
    });
    await db.insert(principalPolicyOrganizations).values([
      {
        principalType: "group",
        principalId: "group-old",
        organizationId: "org-old",
      },
      {
        principalType: "group",
        principalId: "group-keep",
        organizationId: "org-keep",
      },
    ]);
    await db
      .insert(principalPolicies)
      .values([
        policyRow("group-old", "old-head"),
        policyRow("group-keep", "keep-head"),
      ]);
    await db
      .insert(principalPolicyBundleHistory)
      .values([
        policyRow("group-old", "old-history"),
        policyRow("group-keep", "keep-history"),
      ]);
    await db.insert(principalPolicyBundleReferences).values([
      {
        principalType: "group",
        principalId: "group-old",
        version: 1,
        stateHash: "old-history",
        keyEpoch: 1,
        keyFingerprint: "old-key",
        bundleVersion: 2,
        bundleStateHash: "old-head",
      },
      {
        principalType: "group",
        principalId: "group-keep",
        version: 1,
        stateHash: "keep-history",
        keyEpoch: 1,
        keyFingerprint: "keep-key",
        bundleVersion: 2,
        bundleStateHash: "keep-head",
      },
    ]);
    await db.insert(principalPolicyCheckpoints).values([
      {
        principalType: "group",
        principalId: "group-old",
        version: 2,
        stateHash: "old-head",
        updatedAt: STALE,
      },
      {
        principalType: "group",
        principalId: "group-keep",
        version: 2,
        stateHash: "keep-head",
        updatedAt: STALE,
      },
    ]);

    const result = await clearRemoteSyncState(execSql, {
      organizationId: "org-old",
    });

    expect(result.clearedPrincipalPolicyCount).toBe(1);
    for (const table of [
      principalPolicies,
      principalPolicyBundleHistory,
      principalPolicyBundleReferences,
      principalPolicyCheckpoints,
      principalPolicyOrganizations,
    ] as const) {
      expect(await db.select().from(table)).toEqual([
        expect.objectContaining({ principalId: "group-keep" }),
      ]);
    }
  } finally {
    close();
  }
});
