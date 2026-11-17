import { expect, test } from "bun:test";
import { currentPolicyPublicationFixture } from "../../../../test/helpers/currentPolicyPublication";
import { principalPolicyHead } from "../../../../test/helpers/data/principalPolicyFixtures";
import { signedAuthorityRecoveryHistory } from "../../../../test/helpers/principalAuthorityRecovery";
import { KeyingCheckpointRepository } from "../../../data/persistence/keyingCheckpoints/keyingCheckpointRepository";
import { createExecSql } from "../../../data/sqlite/sqlSchema";
import { recoverScopedPrincipalPolicyHistory } from "../../principals/historyRecovery/recoverScopedPrincipalPolicyHistory";
import { retainAcknowledgedPrincipalCurrents } from "./retainAcknowledgedPrincipalCurrents";

test("a reader winning after reconciliation retries local retention without replaying HTTP", async () => {
  const history = await signedAuthorityRecoveryHistory();
  const f = await currentPolicyPublicationFixture(history);
  try {
    const [group, directory] = f.publication.entries;
    if (!group || !directory) throw new Error("Missing receipts");
    const latest = await history.extend(f.organizationBundle, 68);
    f.policies.set(history.organizationId, latest);
    f.policies.set(group.request.state.principalId, f.response);
    let begins = 0;
    let readerRequests = 0;
    const execSql = createExecSql({
      exec: async ({ sql, bind, rowMode }) => {
        if (sql === "BEGIN IMMEDIATE" && ++begins === 1) {
          const recovered = await recoverScopedPrincipalPolicyHistory({
            ...f.options,
            reference: principalPolicyHead(latest),
          });
          await new KeyingCheckpointRepository(
            f.options.execSql,
          ).advanceKeyingCheckpointsAtomically({
            organizationId: history.organizationId,
            access: [],
            policies: [...recovered.dependencies, recovered.policy],
          });
          readerRequests = f.requests.length;
        }
        return {
          rows: await f.options.execSql(
            sql,
            bind,
            rowMode ? { rowMode } : undefined,
          ),
        };
      },
    });
    const policies = await retainAcknowledgedPrincipalCurrents({
      ...f.publication,
      execSql,
    });
    expect(begins).toBe(2);
    expect(policies.map((policy) => policy.version)).toEqual([67, 67]);
    expect(f.requests.length).toBe(readerRequests);
    expect(
      await new KeyingCheckpointRepository(
        f.options.execSql,
      ).loadPrincipalPolicyCheckpoint("organization", history.organizationId),
    ).toMatchObject({ version: 68, stateHash: latest.currentState.stateHash });
  } finally {
    f.close();
  }
}, 30_000);
