import { beforeAll, expect, test } from "bun:test";
import {
  createAuthorityRecoveryFixture,
  signedAuthorityRecoveryHistory,
} from "../../../test/helpers/principalAuthorityRecovery";
import { loadPrincipalPolicyCheckpoint } from "../../data/persistence/keyingCheckpointPersistence";
import { principalPolicyCheckpoints } from "../../data/sqlite/principalPolicySchema";
import { createExecSql } from "../../data/sqlite/sqlSchema";
import { createRuntimePrincipalPolicyCurrentResolver } from "../principals/runtimePolicyRecovery";
import { loadCurrentGroupPolicyMutationContext } from "./currentGroupPolicyMutationContext";

let history: Awaited<ReturnType<typeof signedAuthorityRecoveryHistory>>;
beforeAll(async () => {
  history = await signedAuthorityRecoveryHistory();
}, 30_000);

async function fixture() {
  const f = await createAuthorityRecoveryFixture(history);
  const state = { current: true, online: true };
  const resolveCurrentPolicy = createRuntimePrincipalPolicyCurrentResolver({
    apiClient: f.options.apiClient,
    infra: { execSql: f.options.execSql },
    resolveTrustedUserIdentity: f.options.resolveTrustedUserIdentity,
    state,
    util: { reportSecurityIncident: async () => {} },
    withPrincipalHistoryProtection: async (work) =>
      work({
        protection: f.options.protection,
        stillCurrent: () => state.current,
      }),
  });
  if (!resolveCurrentPolicy) throw new Error("Missing current policy resolver");
  let recovered = false;
  const input = {
    execSql: f.options.execSql,
    groupId: history.group.currentState.principalId,
    organizationId: history.organizationId,
    signerUserId: history.signerUserId,
    resolveCurrentPolicy: (
      request: Parameters<typeof resolveCurrentPolicy>[0],
    ) => {
      expect(recovered).toBe(true);
      return resolveCurrentPolicy(request);
    },
    recoverPendingPrincipalMutation: async (organizationId: string) => {
      expect(organizationId).toBe(history.organizationId);
      expect(f.requests).toHaveLength(0);
      recovered = true;
    },
    stillCurrent: () => state.current,
  };
  return { ...f, state, input };
}

test("bounded mutation context resolves prior work before current reads and admits all authority pins", async () => {
  const f = await fixture();
  try {
    const context = await loadCurrentGroupPolicyMutationContext(f.input);
    expect(context.currentPolicy).not.toHaveProperty("previousStates");
    expect(context.verifiedCurrentPolicy.version).toBe(66);
    expect(
      context.verifiedCurrentPolicy.retainedHistory.length,
    ).toBeLessThanOrEqual(2);
    expect(context.organizationCurrent.policy.version).toBe(66);
    expect(context.currentOrgAdminUserIds).toContain(history.signerUserId);
    expect(context.isOrganizationAdminsGroup).toBe(false);
    expect(f.requests.every((request) => request.count <= 32)).toBe(true);
    // Discovery supplies the first of three pages for this 66-state directory.
    // Resolving Admins/group in the same batch must reuse that verified view.
    expect(
      f.requests
        .filter((request) => request.principalId === history.organizationId)
        .map((request) => request.afterVersion),
    ).toEqual([0, 32, 64]);
    const pins = await f.db.select().from(principalPolicyCheckpoints);
    for (const policy of [
      context.verifiedCurrentPolicy,
      context.organizationCurrent.policy,
      context.adminCurrent.policy,
    ]) {
      expect(
        pins.find((pin) => pin.principalId === policy.principalId),
      ).toMatchObject(policy.checkpoint);
    }
    f.state.current = false;
    expect(context.stillCurrent()).toBe(false);
  } finally {
    f.close();
  }
});

test("an unconfirmed pending write prevents mutation context discovery", async () => {
  const f = await fixture();
  try {
    await expect(
      loadCurrentGroupPolicyMutationContext({
        ...f.input,
        recoverPendingPrincipalMutation: async () => {
          throw new Error("outcome unknown");
        },
      }),
    ).rejects.toThrow("outcome unknown");
    expect(f.requests).toHaveLength(0);
    expect(
      await loadPrincipalPolicyCheckpoint(
        f.options.execSql,
        "group",
        f.input.groupId,
      ),
    ).toBeNull();
  } finally {
    f.close();
  }
});

test("a signer outside the current organization Admins cannot obtain a mutation context", async () => {
  const f = await fixture();
  try {
    await expect(
      loadCurrentGroupPolicyMutationContext({
        ...f.input,
        signerUserId: "not-an-organization-admin",
      }),
    ).rejects.toThrow("Organization admin authority is required");
    expect(await f.db.select().from(principalPolicyCheckpoints)).toEqual([]);
  } finally {
    f.close();
  }
});

test("expiry during authority admission rolls back every mutation-context pin", async () => {
  const f = await fixture();
  try {
    let wrote = false;
    const execSql = createExecSql({
      exec: async ({ sql, bind, rowMode }) => {
        const rows = await f.options.execSql(
          sql,
          bind,
          rowMode ? { rowMode } : undefined,
        );
        if (sql.startsWith('insert into "principal_policy_checkpoints"')) {
          wrote = true;
          f.state.current = false;
        }
        return { rows };
      },
    });
    await expect(
      loadCurrentGroupPolicyMutationContext({ ...f.input, execSql }),
    ).rejects.toThrow("generation expired");
    expect(wrote).toBe(true);
    expect(await f.db.select().from(principalPolicyCheckpoints)).toEqual([]);
  } finally {
    f.close();
  }
});
