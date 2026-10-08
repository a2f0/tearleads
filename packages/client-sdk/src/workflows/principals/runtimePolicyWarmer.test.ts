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
  await loadPrincipalPolicyCheckpoint(
    source.options.execSql,
    "group",
    history.group.currentState.principalId,
  );
  let fullReads = 0;
  const state = { current: true };
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
  const warm = () =>
    warmer({
      organizationId: history.organizationId,
      references: [principalPolicyHead(history.created)],
      stillCurrent: () => state.current,
    });
  return { ...source, state, warm, fullReads: () => fullReads };
}

test("runtime warming refuses to collect full histories without private recovery", async () => {
  const f = await fixture(false);
  try {
    await expect(f.warm()).rejects.toMatchObject({
      name: "ProjectionDependencyUnavailableError",
    });
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
    const error = await f.warm().catch((error: unknown) => error);
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
