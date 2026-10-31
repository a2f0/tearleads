import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { clientSqlTables } from "../../data/sqlite/schema";
import {
  principalHistoryEntries,
  principalHistoryNodes,
  principalHistoryPrefixes,
} from "../../data/sqlite/schema/principalHistoryEvidenceSchema";
import { principalHistoryRootOwners } from "../../data/sqlite/schema/principalHistoryNodeRetentionSchema";
import { principalKeyEnvelopeArchive } from "../../data/sqlite/schema/principalHistoryRetentionSchema";
import { principalHistoryStages } from "../../data/sqlite/schema/principalHistoryStageSchema";
import { getClientSQLitePersistenceRuntime } from "../../data/sqlite/sqlitePersistenceRuntime";
import { ensureSqlTables } from "../../data/sqlite/sqlTableSchema";
import { clearRemoteSyncState } from "./remoteReset";

test("organization reset discards only its principal history stages and evidence", async () => {
  const { execSql, close } = await createTestExecSql("reset-principal-history");
  try {
    await ensureSqlTables(execSql, clientSqlTables);
    const { db } = getClientSQLitePersistenceRuntime(execSql);
    await db
      .insert(principalHistoryStages)
      .values(
        ["org-1", "org-2"].map((organizationId) => ({
          id: `stage-${organizationId}`,
          organizationId,
          scopeId: `scope-${organizationId}`,
          currentJson: "{}",
          afterVersion: 32,
          complete: false,
          touchedAt: 1,
          progress: "opaque-authenticated-progress",
        })),
      )
      .run();
    for (const organizationId of ["org-1", "org-2"]) {
      const scope = { organizationId, scopeId: `scope-${organizationId}` };
      await db.insert(principalHistoryRootOwners).values({
        ...scope,
        id: `stage:${organizationId}`,
        rootHash: "node-hash",
      });
      await db
        .insert(principalKeyEnvelopeArchive)
        .values({
          organizationId,
          principalType: "group",
          principalId: `group-${organizationId}`,
          keyFingerprint: "historical-key",
          version: 1,
          envelopesJson: "{}",
        })
        .run();
      await db
        .insert(principalHistoryPrefixes)
        .values({
          ...scope,
          version: 66,
          headJson: "{}",
          currentJson: "{}",
          progress: "opaque-prefix",
        })
        .run();
      await db
        .insert(principalHistoryEntries)
        .values({ ...scope, leafHash: "leaf-hash", entryJson: "{}" })
        .run();
      await db
        .insert(principalHistoryNodes)
        .values({
          ...scope,
          hash: "node-hash",
          referenceCount: 1,
          managed: true,
          leftHash: "left",
          rightHash: "right",
        })
        .run();
    }
    await clearRemoteSyncState(execSql, { organizationId: "org-1" });
    expect(
      await db
        .select({ organizationId: principalHistoryStages.organizationId })
        .from(principalHistoryStages),
    ).toEqual([{ organizationId: "org-2" }]);
    for (const table of [
      principalHistoryRootOwners,
      principalHistoryPrefixes,
      principalHistoryEntries,
      principalHistoryNodes,
      principalKeyEnvelopeArchive,
    ])
      expect(
        await db.select({ organizationId: table.organizationId }).from(table),
      ).toEqual([{ organizationId: "org-2" }]);
  } finally {
    close();
  }
});
