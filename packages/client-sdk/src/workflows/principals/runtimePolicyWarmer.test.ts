import { beforeAll, expect, test } from "bun:test";
import { createMockApiClient } from "@tearleads/test-utils";
import {
  createAuthorityRecoveryFixture,
  signedAuthorityRecoveryHistory,
} from "../../../test/helpers/principalAuthorityRecovery";
import { principalPolicyHead } from "../../../test/helpers/principalPolicyFixtures";
import { repairProtectionLease } from "../../../test/helpers/principalPolicyRepair";
import { isProjectionVerificationCancelledError } from "../../data/keyingProjectionVerification/types";
import { loadPrincipalPolicyCheckpoint } from "../../data/persistence/keyingCheckpointPersistence";
import { principalPolicyCheckpoints } from "../../data/sqlite/principalPolicySchema";
import { createRuntimePrincipalPolicyWarmer } from "./runtimePolicyWarmer";

let history: Awaited<ReturnType<typeof signedAuthorityRecoveryHistory>>;
beforeAll(async () => {
  history = await signedAuthorityRecoveryHistory();
}, 30_000);

async function fixture(protectedRecovery = true) {
  const source = await createAuthorityRecoveryFixture(history);
  // Initialize checkpoint tables even when recovery refuses before any local read.
  await loadPrincipalPolicyCheckpoint(
    source.options.execSql,
    "group",
    history.group.currentState.principalId,
  );
  let fullReads = 0;
  const state = { current: true, online: true };
  const warmer = createRuntimePrincipalPolicyWarmer({
    apiClient: createMockApiClient({
      getPrincipalPolicyPages:
        source.options.apiClient.getPrincipalPolicyPages.bind(
          source.options.apiClient,
        ),
      getCurrentPrincipalPolicy: async () => {
        fullReads += 1;
        return history.group;
      },
    }),
    infra: { execSql: source.options.execSql },
    state,
    resolveTrustedUserIdentity: source.options.resolveTrustedUserIdentity,
    ...(protectedRecovery
      ? {
          withPrincipalHistoryProtection: repairProtectionLease(
            () => state.current,
          ),
        }
      : {}),
    util: { reportSecurityIncident: async () => undefined },
  });
  const warm = (references = [principalPolicyHead(history.created)]) =>
    warmer({
      organizationId: history.organizationId,
      references,
      stillCurrent: () => state.current,
    });
  return { ...source, state, warm, warmer, fullReads: () => fullReads };
}

test("runtime warming refuses to collect full histories without private recovery", async () => {
  const f = await fixture(false);
  try {
    await expect(f.warm()).resolves.toBeUndefined();
    const resolve = f.warmer.resolveReference;
    if (!resolve) throw new Error("Missing runtime resolver");
    await expect(
      resolve({
        organizationId: history.organizationId,
        reference: principalPolicyHead(history.created),
      }),
    ).rejects.toMatchObject({ name: "ProjectionDependencyUnavailableError" });
    expect(f.fullReads()).toBe(0);
    expect(f.requests).toEqual([]);
    expect(await f.db.select().from(principalPolicyCheckpoints)).toEqual([]);
  } finally {
    f.close();
  }
});

test("runtime warming stops when the caller's generation expires", async () => {
  const f = await fixture();
  try {
    f.state.current = false;
    await expect(f.warm()).resolves.toBeUndefined();
    const resolve = f.warmer.resolveReference;
    if (!resolve) throw new Error("Missing runtime resolver");
    const error = await resolve({
      organizationId: history.organizationId,
      reference: principalPolicyHead(history.created),
    }).catch((error: unknown) => error);
    expect(isProjectionVerificationCancelledError(error)).toBe(true);
    expect(f.fullReads()).toBe(0);
    expect(f.requests).toEqual([]);
    expect(await f.db.select().from(principalPolicyCheckpoints)).toEqual([]);
  } finally {
    f.close();
  }
});

test("runtime warming streams exact references without admitting standalone checkpoints", async () => {
  const f = await fixture();
  try {
    await f.warm();
    expect(f.requests.length).toBeGreaterThan(0);
    expect(f.fullReads()).toBe(0);
    expect(await f.db.select().from(principalPolicyCheckpoints)).toEqual([]);
  } finally {
    f.close();
  }
});

test("unavailable prefetch evidence does not block another cited group", async () => {
  const f = await fixture();
  try {
    const reference = principalPolicyHead(history.created);
    await expect(
      f.warm([{ ...reference, principalId: "missing-group" }, reference]),
    ).resolves.toBeUndefined();
    const requests = f.requests.length;
    f.state.online = false;
    const resolve = f.warmer.resolveReference;
    if (!resolve) throw new Error("Missing runtime recovery");
    const recovered = await resolve({
      organizationId: history.organizationId,
      reference,
    });
    expect(recovered.policy.version).toBe(66);
    expect(f.requests).toHaveLength(requests);
    expect(f.fullReads()).toBe(0);
    expect(await f.db.select().from(principalPolicyCheckpoints)).toEqual([]);
  } finally {
    f.close();
  }
});

test("policy prefetch still rejects invalid signed evidence", async () => {
  const f = await fixture();
  try {
    f.controls.mutate = (page) => {
      const first = page.previousStates[0];
      const second = page.previousStates[1];
      if (first && second) first.state.signature = second.state.signature;
    };
    await expect(f.warm()).rejects.toMatchObject({
      name: "KeyingVerificationError",
    });
    expect(f.fullReads()).toBe(0);
    expect(await f.db.select().from(principalPolicyCheckpoints)).toEqual([]);
  } finally {
    f.close();
  }
});
