import { expect, test } from "bun:test";
import { createNativeTestExecSql } from "@tearleads/test-utils";
import {
  organizationReadModelDirectoryUsers,
  organizationReadModelState,
} from "../../data/sqlite/organizationReadModelSchema";
import {
  clientSqlTables,
  containers,
  documentProjection,
  documents,
} from "../../data/sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../data/sqlite/sqlitePersistenceRuntime";
import { ensureSqlTables } from "../../data/sqlite/sqlTableSchema";
import { clearRemoteSyncState } from "./remoteReset";

const NOW = "2026-09-27T00:00:00.000Z";

for (const pointer of ["organization", "roster"] as const) {
  test(`remote reset ignores a foreign document in the unsigned ${pointer} profile pointer`, async () => {
    const { close, execSql } = createNativeTestExecSql();
    try {
      await ensureSqlTables(execSql, clientSqlTables);
      const { db } = getClientSQLitePersistenceRuntime(execSql);
      await db.insert(containers).values([
        {
          id: "old-root",
          organizationId: "old-org",
          parentId: null,
          localCreatedAt: NOW,
          localUpdatedAt: NOW,
        },
        {
          id: "other-root",
          organizationId: "other-org",
          parentId: null,
          localCreatedAt: NOW,
          localUpdatedAt: NOW,
        },
      ]);
      await db.insert(documents).values(
        ["owned", "other"].map((prefix) => ({
          appKind: "documents",
          localId: `${prefix}-local`,
          documentId: `${prefix}-document`,
          updatedAt: NOW,
        })),
      );
      await db.insert(documentProjection).values([
        {
          localId: "owned-local",
          documentId: "owned-document",
          containerId: null,
          organizationId: "old-org",
          updatedAt: NOW,
        },
        {
          localId: "other-local",
          documentId: "other-document",
          containerId: "other-root",
          organizationId: "other-org",
          updatedAt: NOW,
        },
      ]);
      if (pointer === "organization") {
        await db.insert(organizationReadModelState).values({
          organizationId: "old-org",
          cursor: "untrusted",
          profileDocumentId: "other-document",
          memberGroupId: "members",
          updatedAt: NOW,
        });
      } else {
        await db.insert(organizationReadModelDirectoryUsers).values({
          organizationId: "old-org",
          userId: "self",
          isPersonalOrganizationOwner: true,
          sortOrder: 0,
          signingKeyFingerprint: "fingerprint",
          signingPublicKey: "key",
          encapsulationPublicKey: "key",
          encapsulationKeyFingerprint: "fingerprint",
          createdAt: NOW,
          status: "active",
          profileDocumentId: "other-document",
          joinedAt: NOW,
          updatedAt: NOW,
          disabledAt: null,
          disabledByUserId: null,
        });
      }
      const beforeDocuments = await db.select().from(documents);
      const beforeProjections = await db.select().from(documentProjection);
      const result = await clearRemoteSyncState(execSql, {
        organizationId: "old-org",
        replacement: {
          organizationId: "replacement-org",
          rootContainerId: "replacement-root",
        },
      });
      const afterDocuments = await db.select().from(documents);
      const afterProjections = await db.select().from(documentProjection);
      expect(
        afterDocuments.find((row) => row.localId === "other-local"),
      ).toEqual(beforeDocuments.find((row) => row.localId === "other-local"));
      expect(
        afterProjections.find((row) => row.localId === "other-local"),
      ).toEqual(beforeProjections.find((row) => row.localId === "other-local"));
      // A locally scoped profile still resets even without a container projection.
      expect(
        afterDocuments.find((row) => row.localId === "owned-local"),
      ).toMatchObject({
        documentId: null,
        recoveryDocumentId: "owned-document",
      });
      expect(
        afterProjections.find((row) => row.localId === "owned-local"),
      ).toMatchObject({
        organizationId: "replacement-org",
      });
      expect(result.resetDocumentCount).toBe(1);
    } finally {
      close();
    }
  });
}
