import { beforeAll, expect, test } from "bun:test";
import { readTestGroupName } from "../../../../test/helpers/groupMetadata";
import { createLocalAuthorityRecoveryFixture } from "../../../../test/helpers/principalAuthorityLocal";
import { signedAuthorityRecoveryHistory } from "../../../../test/helpers/principalAuthorityRecovery";
import { principalPolicyHead } from "../../../../test/helpers/principalPolicyFixtures";
import { loadPrincipalPolicyCheckpoint } from "../../../data/persistence/keyingCheckpointPersistence";
import type { PrincipalHistoryProtectionLease } from "../../../data/principals/principalHistoryProtection";
import {
  principalPolicies,
  principalPolicyCheckpoints,
} from "../../../data/sqlite/principalPolicySchema";
import { createRuntimeCurrentSharePrincipalPolicy } from "./currentSharePrincipalPolicy";

let history: Awaited<ReturnType<typeof signedAuthorityRecoveryHistory>>;
beforeAll(async () => {
  history = await signedAuthorityRecoveryHistory();
}, 30_000);

async function fixture() {
  const f = await createLocalAuthorityRecoveryFixture(history);
  const state = { current: true, online: true, fullReads: 0, recoveries: 0 };
  const ownedKeys: Uint8Array[] = [];
  f.options.apiClient.getCurrentPrincipalPolicy = async () => {
    state.fullReads += 1;
    throw new Error("Full policy reads are forbidden");
  };
  const withPrincipalHistoryProtection: PrincipalHistoryProtectionLease =
    async (work) => {
      const localKey = f.options.protection.localKey.slice();
      ownedKeys.push(localKey);
      try {
        return await work({
          protection: { ...f.options.protection, localKey },
          stillCurrent: () => state.current,
        });
      } finally {
        localKey.fill(0);
      }
    };
  const runtime = {
    apiClient: Object.assign(f.options.apiClient, {
      recoverPendingPrincipalMutation: async () => {
        state.recoveries += 1;
        expect(f.requests).toHaveLength(0);
      },
    }),
    crypto: { encapsulationKeyPair: null },
    infra: { execSql: f.options.execSql },
    resolveTrustedUserIdentity: history.resolveTrustedUserIdentity,
    state,
    util: { log: () => {}, reportSecurityIncident: async () => {} },
    withPrincipalHistoryProtection,
  };
  const readCurrent = createRuntimeCurrentSharePrincipalPolicy(runtime);
  if (!readCurrent) throw new Error("Missing current share reader");
  return {
    ...f,
    runtime,
    state,
    ownedKeys,
    readCurrent,
    input: {
      groupId: history.group.currentState.principalId,
      organizationId: history.organizationId,
      expectedGroupHead: principalPolicyHead(history.group),
      expectedGroupName: "Private support name",
      readEncryptedName: readTestGroupName,
      stillCurrent: () => state.current,
    },
  };
}

test("current share reads bind names and heads, retain only bounded evidence, and expire custody", async () => {
  const f = await fixture();
  let escapedCurrent = () => true;
  try {
    const epoch = await f.readCurrent(f.input, async (verified) => {
      expect(f.state.recoveries).toBe(1);
      expect(verified.current).not.toHaveProperty("previousStates");
      expect(verified.policy).not.toHaveProperty("history");
      expect(verified.policy.retainedHistory.length).toBeLessThanOrEqual(2);
      expect(verified.policy.version).toBe(66);
      expect(verified.stillCurrent()).toBe(true);
      const pins = await f.db.select().from(principalPolicyCheckpoints);
      for (const bundle of [history.directory, history.admin, history.group])
        expect(
          pins.find(
            (pin) => pin.principalId === bundle.currentState.principalId,
          ),
        ).toMatchObject({
          version: 66,
          stateHash: bundle.currentState.stateHash,
        });
      escapedCurrent = verified.stillCurrent;
      return verified.policy.keyEpoch;
    });
    expect(epoch).toBe(history.group.currentState.keyEpoch);
    expect(escapedCurrent()).toBe(false);
    expect(f.state.fullReads).toBe(0);
    expect(f.requests.length).toBeGreaterThan(0);
    expect(f.requests.every((request) => request.count <= 32)).toBe(true);
    expect(await f.db.select().from(principalPolicies)).toEqual([]);
    expect(f.ownedKeys.length).toBeGreaterThan(0);
    expect(f.ownedKeys.every((key) => key.every((byte) => byte === 0))).toBe(
      true,
    );
  } finally {
    f.close();
  }
}, 15_000);

for (const mismatch of ["name", "head"] as const) {
  test(`current share rejects the wrong ${mismatch} before checkpoint admission or use`, async () => {
    const f = await fixture();
    let used = false;
    try {
      await expect(
        f.readCurrent(
          {
            ...f.input,
            ...(mismatch === "name"
              ? { expectedGroupName: "Different chosen group" }
              : {
                  expectedGroupHead: {
                    ...f.input.expectedGroupHead,
                    stateHash: "a".repeat(64),
                  },
                }),
          },
          async () => {
            used = true;
          },
        ),
      ).rejects.toMatchObject({ code: "object_mismatch" });
      expect(used).toBe(false);
      expect(await f.db.select().from(principalPolicyCheckpoints)).toEqual([]);
      expect(f.state.fullReads).toBe(0);
    } finally {
      f.close();
    }
  }, 15_000);
}

test("pending mutation failure prevents current share discovery and use", async () => {
  const f = await fixture();
  let used = false;
  f.runtime.apiClient.recoverPendingPrincipalMutation = async () => {
    throw new Error("outcome unknown");
  };
  try {
    await expect(
      f.readCurrent(f.input, async () => {
        used = true;
      }),
    ).rejects.toThrow("outcome unknown");
    expect(used).toBe(false);
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

test("session expiry during the signed name read prevents checkpoint admission and use", async () => {
  const f = await fixture();
  let used = false;
  try {
    await expect(
      f.readCurrent(
        {
          ...f.input,
          readEncryptedName: async (policy) => {
            const name = await readTestGroupName(policy);
            f.state.current = false;
            return name;
          },
        },
        async () => {
          used = true;
        },
      ),
    ).rejects.toThrow("generation expired");
    expect(used).toBe(false);
    expect(await f.db.select().from(principalPolicyCheckpoints)).toEqual([]);
  } finally {
    f.close();
  }
}, 15_000);

test("current share rejects success after its callback loses the session", async () => {
  const f = await fixture();
  try {
    await expect(
      f.readCurrent(f.input, async () => {
        f.state.current = false;
        return "stale success";
      }),
    ).rejects.toThrow("generation expired");
  } finally {
    f.close();
  }
}, 15_000);
