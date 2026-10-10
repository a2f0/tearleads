import { expect, test } from "bun:test";
import { currentPolicyPublicationFixture } from "../../../test/helpers/currentPolicyPublication";
import { signedAuthorityRecoveryHistory } from "../../../test/helpers/principalAuthorityRecovery";
import { principalPolicyHead } from "../../../test/helpers/principalPolicyFixtures";
import { advanceKeyingCheckpointsAtomically } from "../../data/persistence/keyingCheckpointAdvancePersistence";
import { loadPrincipalPolicyCheckpoint } from "../../data/persistence/keyingCheckpointPersistence";
import { createExecSql } from "../../data/sqlite/sqlSchema";
import { recoverScopedPrincipalPolicyHistory } from "../principals/recoverScopedPrincipalPolicyHistory";
import { retainAcknowledgedPrincipalCurrents } from "./retainAcknowledgedPrincipalCurrents";

test("a reader winning after reconciliation retries local retention without replaying HTTP", async () => {
  const history = await signedAuthorityRecoveryHistory();
  const f = await currentPolicyPublicationFixture(history);
  try {
    const [group, directory] = f.publication.entries;
    if (!group || !directory) throw new Error("Missing receipts");
    const latest = await history.extend(directory.response, 68);
    f.policies.set(history.organizationId, latest);
    f.policies.set(group.request.state.principalId, group.response);
    let begins = 0;
    let readerRequests = 0;
    const execSql = createExecSql({
      exec: async ({ sql, bind, rowMode }) => {
        if (sql === "BEGIN IMMEDIATE" && ++begins === 1) {
          const recovered = await recoverScopedPrincipalPolicyHistory({
            ...f.options,
            reference: principalPolicyHead(latest),
          });
          await advanceKeyingCheckpointsAtomically({
            execSql: f.options.execSql,
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
      await loadPrincipalPolicyCheckpoint(
        f.options.execSql,
        "organization",
        history.organizationId,
      ),
    ).toMatchObject({ version: 68, stateHash: latest.currentState.stateHash });
  } finally {
    f.close();
  }
}, 30_000);
