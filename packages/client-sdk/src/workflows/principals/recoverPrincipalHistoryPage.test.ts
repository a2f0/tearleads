import { beforeAll, expect, test } from "bun:test";
import {
  createRecoveryFixture,
  signedRecoveryHistory,
} from "../../../test/helpers/principalHistoryRecovery";
import { principalHistoryEntries } from "../../data/sqlite/principalHistoryEvidenceSchema";
import { principalPolicyCheckpoints } from "../../data/sqlite/principalPolicySchema";
import { createExecSql } from "../../data/sqlite/sqlSchema";
import { recoverPrincipalHistoryPage } from "./recoverPrincipalHistoryPage";
import { recoverPrincipalPolicyHistory } from "./recoverPrincipalPolicyHistory";

let history: Awaited<ReturnType<typeof signedRecoveryHistory>>;
beforeAll(async () => {
  history = await signedRecoveryHistory();
}, 30_000);

test("persistent display proof loss stops after one signed-history replay and preserves pins", async () => {
  const f = await createRecoveryFixture(history);
  try {
    await recoverPrincipalPolicyHistory(f.options);
    await f.db
      .insert(principalPolicyCheckpoints)
      .values({
        principalType: "group",
        principalId: history.expectedHead.principalId,
        version: history.expectedHead.version,
        stateHash: history.expectedHead.stateHash,
        updatedAt: history.bundle.currentState.createdAt,
      })
      .run();
    const pins = await f.db.select().from(principalPolicyCheckpoints);
    const rows = await f.db.select().from(principalHistoryEntries);
    const lost = rows.find(
      (row) => JSON.parse(row.entryJson).state.version === 40,
    );
    if (!lost) throw new Error("Missing historical fixture entry");
    const execSql = createExecSql({
      async exec({ sql, bind, rowMode }) {
        if (
          sql.includes('from "principal_history_entries"') &&
          Array.isArray(bind) &&
          bind.includes(lost.leafHash)
        )
          return { rows: [] };
        const result =
          rowMode === "array"
            ? await f.options.execSql(sql, bind, { rowMode: "array" })
            : await f.options.execSql(sql, bind);
        return { rows: result };
      },
    });
    f.requests.length = 0;
    await expect(
      recoverPrincipalHistoryPage({ ...f.options, execSql }, 67),
    ).rejects.toMatchObject({ code: "missing_dependency" });
    expect(f.requests).toEqual([65, 0, 32, 64]);
    expect(await f.db.select().from(principalPolicyCheckpoints)).toEqual(pins);
  } finally {
    f.close();
  }
});
