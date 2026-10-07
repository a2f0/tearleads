import { beforeAll, expect, test } from "bun:test";
import {
  createAuthorityRecoveryFixture,
  signedAuthorityRecoveryHistory,
} from "../../../test/helpers/principalAuthorityRecovery";
import { principalPolicyHead } from "../../../test/helpers/principalPolicyFixtures";
import { assertCurrentMatchesVerifiedPolicy } from "../../data/persistence/verifiedPrincipalPolicyCurrent";
import type { PrincipalHistoryProtectionLease } from "../../data/principals/principalHistoryProtection";
import { principalPolicyCheckpoints } from "../../data/sqlite/principalPolicySchema";
import { createRuntimePrincipalPolicyCurrentResolver } from "./runtimePolicyRecovery";

let history: Awaited<ReturnType<typeof signedAuthorityRecoveryHistory>>;
beforeAll(async () => {
  history = await signedAuthorityRecoveryHistory();
});

async function fixture() {
  const source = await createAuthorityRecoveryFixture(history);
  const state = { current: true, online: true };
  const keys: Uint8Array[] = [];
  const incidents: unknown[] = [];
  const lease: PrincipalHistoryProtectionLease = async (operation) => {
    const localKey = new Uint8Array(source.options.protection.localKey);
    keys.push(localKey);
    try {
      return await operation({
        protection: { ...source.options.protection, localKey },
        stillCurrent: () => state.current,
      });
    } finally {
      localKey.fill(0);
    }
  };
  const resolve = createRuntimePrincipalPolicyCurrentResolver({
    apiClient: {
      getPrincipalPolicyPages:
        source.options.apiClient.getPrincipalPolicyPages.bind(
          source.options.apiClient,
        ),
    },
    infra: { execSql: source.options.execSql },
    state,
    resolveTrustedUserIdentity: source.options.resolveTrustedUserIdentity,
    withPrincipalHistoryProtection: lease,
    util: {
      reportSecurityIncident: async (error) => {
        incidents.push(error);
      },
    },
  });
  if (!resolve) throw new Error("Expected current policy recovery");
  const read = () =>
    resolve({
      organizationId: history.organizationId,
      reference: principalPolicyHead(history.created),
      stillCurrent: () => state.current,
    });
  return { ...source, state, keys, incidents, read };
}

test("current recovery retains exact artifacts, dependencies and expiry without admitting pins", async () => {
  const f = await fixture();
  try {
    const result = await f.read();
    const { previousStates: _previous, ...expected } = history.group;
    expect(result.current).toEqual(expected);
    expect(result.current).not.toHaveProperty("previousStates");
    expect(result.policy).not.toHaveProperty("history");
    expect(result.dependencies.map((p) => p.stateHash)).toEqual([
      history.directory.currentState.stateHash,
      history.admin.currentState.stateHash,
    ]);
    await assertCurrentMatchesVerifiedPolicy(result);
    expect(await f.db.select().from(principalPolicyCheckpoints)).toEqual([]);
    expect(f.keys.every((key) => key.every((byte) => byte === 0))).toBe(true);
    expect(result.stillCurrent()).toBe(true);
    f.state.online = false;
    const count = f.requests.length;
    const offline = await f.read();
    expect(offline.current).toEqual(expected);
    expect(f.requests).toHaveLength(count);
    f.state.current = false;
    expect(result.stillCurrent()).toBe(false);
    expect(offline.stillCurrent()).toBe(false);
    expect(f.incidents).toEqual([]);
  } finally {
    f.close();
  }
});

test("substituted current artifacts never leave runtime recovery", async () => {
  const f = await fixture();
  try {
    f.controls.mutate = (page) => {
      if (
        page.currentState.principalId === history.group.currentState.principalId
      )
        page.currentPayload.ciphertext += "replaced";
    };
    await expect(f.read()).rejects.toMatchObject({ code: "hash_mismatch" });
    expect(await f.db.select().from(principalPolicyCheckpoints)).toEqual([]);
    expect(f.keys.every((key) => key.every((byte) => byte === 0))).toBe(true);
    expect(f.incidents).toHaveLength(1);
  } finally {
    f.close();
  }
});

test("expiry during a current-artifact response refuses the operation", async () => {
  const f = await fixture();
  try {
    f.controls.mutate = (page) => {
      if (
        page.currentState.principalId === history.group.currentState.principalId
      )
        f.state.current = false;
    };
    await expect(f.read()).rejects.toThrow("generation expired");
    expect(await f.db.select().from(principalPolicyCheckpoints)).toEqual([]);
    expect(f.keys.every((key) => key.every((byte) => byte === 0))).toBe(true);
    expect(f.incidents).toEqual([]);
  } finally {
    f.close();
  }
});
