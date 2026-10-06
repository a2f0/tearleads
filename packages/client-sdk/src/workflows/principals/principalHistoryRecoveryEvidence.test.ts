import { beforeAll, expect, test } from "bun:test";
import {
  createRecoveryFixture,
  signedRecoveryHistory,
} from "../../../test/helpers/principalHistoryRecovery";
import { principalPolicyHead } from "../../../test/helpers/principalPolicyFixtures";
import { principalHistoryNodes } from "../../data/sqlite/principalHistoryEvidenceSchema";
import { createExecSql } from "../../data/sqlite/sqlSchema";
import { recoverPrincipalPolicyHistory } from "./recoverPrincipalPolicyHistory";

let history: Awaited<ReturnType<typeof signedRecoveryHistory>>;
beforeAll(async () => {
  history = await signedRecoveryHistory();
});

async function cachedFixture() {
  const fixture = await createRecoveryFixture(history);
  const state = history.bundle.previousStates[15]?.state;
  if (!state) {
    fixture.close();
    throw new Error("Missing selected history entry");
  }
  const options = {
    ...fixture.options,
    retainedReferences: [
      principalPolicyHead({ ...history.bundle, currentState: state }),
    ],
  };
  try {
    await recoverPrincipalPolicyHistory(options);
  } catch (error) {
    fixture.close();
    throw error;
  }
  fixture.requests.length = 0;
  return { ...fixture, options };
}

for (const corruption of ["missing", "substituted"] as const) {
  test(`recovery rebuilds ${corruption} proof material from signed pages`, async () => {
    const fixture = await cachedFixture();
    try {
      if (corruption === "missing")
        await fixture.db.delete(principalHistoryNodes).run();
      else
        await fixture.db
          .update(principalHistoryNodes)
          .set({ leftHash: "f".repeat(64) })
          .run();
      const recovered = await recoverPrincipalPolicyHistory(fixture.options);
      expect(
        recovered.policy.retainedHistory.map(({ state }) => state.version),
      ).toEqual([16, 66]);
      expect(fixture.requests).toEqual([65, 0, 32, 64]);
    } finally {
      fixture.close();
    }
  });
}

test("persistent proof loss permits only one rebuild attempt per recovery call", async () => {
  const fixture = await cachedFixture();
  try {
    const execSql = createExecSql({
      async exec({ sql, bind, rowMode }) {
        if (
          sql.toLowerCase().startsWith("select ") &&
          sql.includes('from "principal_history_nodes"')
        )
          return { rows: [] };
        const rows =
          rowMode === "array"
            ? await fixture.options.execSql(sql, bind, { rowMode: "array" })
            : await fixture.options.execSql(sql, bind);
        return { rows };
      },
    });
    await expect(
      recoverPrincipalPolicyHistory({ ...fixture.options, execSql }),
    ).rejects.toMatchObject({ code: "missing_dependency" });
    expect(fixture.requests).toEqual([65, 0, 32, 64]);
  } finally {
    fixture.close();
  }
});
