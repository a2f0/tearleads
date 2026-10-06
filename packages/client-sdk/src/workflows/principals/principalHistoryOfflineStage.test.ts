import { beforeAll, expect, test } from "bun:test";
import {
  createRecoveryFixture,
  signedRecoveryHistory,
} from "../../../test/helpers/principalHistoryRecovery";
import { isProjectionVerificationCancelledError } from "../../data/keyingProjectionVerification/types";
import { principalHistoryPrefixes } from "../../data/sqlite/principalHistoryEvidenceSchema";
import { createExecSql } from "../../data/sqlite/sqlSchema";
import { recoverPrincipalPolicyHistory } from "./recoverPrincipalPolicyHistory";

let history: Awaited<ReturnType<typeof signedRecoveryHistory>>;
beforeAll(async () => {
  history = await signedRecoveryHistory();
});

test("offline recovery can use an authenticated completed exact stage", async () => {
  const fixture = await createRecoveryFixture(history);
  try {
    await recoverPrincipalPolicyHistory(fixture.options);
    await fixture.db.delete(principalHistoryPrefixes).run();
    fixture.requests.length = 0;
    const recovered = await recoverPrincipalPolicyHistory({
      ...fixture.options,
      offline: true,
    });
    expect(recovered.policy.stateHash).toBe(history.expectedHead.stateHash);
    expect(fixture.requests).toEqual([]);
  } finally {
    fixture.close();
  }
});

test("an interrupted stage cannot masquerade as completed offline evidence", async () => {
  const fixture = await createRecoveryFixture(history);
  try {
    const client = fixture.client();
    await expect(
      recoverPrincipalPolicyHistory({
        ...fixture.options,
        apiClient: {
          async *getPrincipalPolicyPages(...args) {
            for await (const page of client.getPrincipalPolicyPages(...args)) {
              yield page;
              return;
            }
          },
        },
      }),
    ).rejects.toMatchObject({ code: "missing_dependency" });
    expect(fixture.requests).toEqual([0]);
    fixture.requests.length = 0;
    await expect(
      recoverPrincipalPolicyHistory({ ...fixture.options, offline: true }),
    ).rejects.toMatchObject({ code: "missing_dependency" });
    expect(fixture.requests).toEqual([]);
  } finally {
    fixture.close();
  }
});

test("cancellation during an offline storage read prevents returning a policy", async () => {
  const fixture = await createRecoveryFixture(history);
  try {
    await recoverPrincipalPolicyHistory(fixture.options);
    fixture.requests.length = 0;
    const controller = new AbortController();
    const execSql = createExecSql({
      async exec({ sql, bind, rowMode }) {
        const rows =
          rowMode === "array"
            ? await fixture.options.execSql(sql, bind, { rowMode: "array" })
            : await fixture.options.execSql(sql, bind);
        if (
          sql.toLowerCase().startsWith("select ") &&
          sql.includes('from "principal_history_stages"')
        )
          controller.abort();
        return { rows };
      },
    });
    const error = await recoverPrincipalPolicyHistory({
      ...fixture.options,
      execSql,
      signal: controller.signal,
      offline: true,
    }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(isProjectionVerificationCancelledError(error)).toBe(true);
    expect(fixture.requests).toEqual([]);
  } finally {
    fixture.close();
  }
});
