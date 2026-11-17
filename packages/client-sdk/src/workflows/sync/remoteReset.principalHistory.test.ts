import { beforeAll, expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  createRecoveryFixture,
  signedRecoveryHistory,
} from "../../../test/helpers/data/principalHistoryRecovery";
import { isProjectionVerificationCancelledError } from "../../data/keyingProjectionVerification/types";
import { clientSqlTables } from "../../data/sqlite/schema";
import {
  principalHistoryEntries,
  principalHistoryNodes,
  principalHistoryPrefixes,
} from "../../data/sqlite/schema/principalHistoryEvidenceSchema";
import { principalKeyEnvelopeArchive } from "../../data/sqlite/schema/principalHistoryRetentionSchema";
import { principalHistoryStages } from "../../data/sqlite/schema/principalHistoryStageSchema";
import { getClientSQLitePersistenceRuntime } from "../../data/sqlite/sqlitePersistenceRuntime";
import { ensureSqlTables } from "../../data/sqlite/sqlTableSchema";
import { recoverPrincipalPolicyHistory } from "../principals/historyRecovery/recoverPrincipalPolicyHistory";
import { clearRemoteSyncState } from "./remoteReset";

let history: Awaited<ReturnType<typeof signedRecoveryHistory>>;
beforeAll(async () => {
  history = await signedRecoveryHistory();
});

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
          rootHash: "node-hash",
        })),
      )
      .run();
    for (const organizationId of ["org-1", "org-2"]) {
      const scope = { organizationId, scopeId: `scope-${organizationId}` };
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
          rootHash: "node-hash",
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

test("reset invalidates an in-flight recovery through its lifetime guard", async () => {
  const fixture = await createRecoveryFixture(history);
  try {
    let current = true;
    await expect(
      recoverPrincipalPolicyHistory({
        ...fixture.options,
        stillCurrent: () => current,
        resolveTrustedUserIdentity: async (userId) => {
          if (current) {
            current = false;
            await clearRemoteSyncState(fixture.options.execSql, {
              organizationId: "org-1",
            });
          }
          return history.resolveTrustedUserIdentity(userId);
        },
      }).catch(isProjectionVerificationCancelledError),
    ).resolves.toBe(true);
    expect(await fixture.db.select().from(principalHistoryStages)).toEqual([]);
  } finally {
    fixture.close();
  }
});
