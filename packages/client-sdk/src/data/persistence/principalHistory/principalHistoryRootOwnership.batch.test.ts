import { expect, test } from "bun:test";
import { retentionBatchFixture } from "../../../../test/helpers/principalRetentionBatch";
import { principalHistoryNodes } from "../../sqlite/schema/principalHistoryEvidenceSchema";
import { sqliteInsertBatchSize } from "../../sqlite/sqliteBindBudget";
import { releasePrincipalHistoryRoots } from "./principalHistoryRootOwnership";

test("root-release chunks count and scope binds, preserving every multiplicity", async () => {
  const f = await retentionBatchFixture("incomplete", 0);
  try {
    const rows = Array.from({ length: 1000 }, (_, index) => ({
      ...f.scope,
      hash: `root-${index}`,
      referenceCount: 3,
      managed: false,
    }));
    const batchSize = sqliteInsertBatchSize(principalHistoryNodes);
    for (let offset = 0; offset < rows.length; offset += batchSize)
      await f.db
        .insert(principalHistoryNodes)
        .values(rows.slice(offset, offset + batchSize));
    f.statements.length = 0;
    await f.runtime.guardedTransaction(
      (tx) =>
        releasePrincipalHistoryRoots(tx, f.scope, [
          ...rows.map((row) => row.hash),
          "root-0",
          null,
          "",
        ]),
      () => true,
    );
    const measured = [...f.statements];
    expect(Math.max(...measured.map((entry) => entry.binds))).toBe(999);
    expect(
      measured.filter((entry) =>
        entry.sql.startsWith('update "principal_history_nodes"'),
      ),
    ).toHaveLength(3);
    const after = await f.snapshot();
    for (const row of after.nodes)
      expect(row.referenceCount).toBe(
        row.hash === "shared-root" ? 9 : row.hash === "root-0" ? 1 : 2,
      );
  } finally {
    f.close();
  }
});
