import { beforeAll, expect, test } from "bun:test";
import { signedAuthorityRecoveryHistory } from "../../../test/helpers/principalAuthorityRecovery";
import { createPublicProjectionHistoryFixture } from "../../../test/helpers/publicProjectionHistory";
import {
  generationGuardedPrincipalPolicyWarmer,
  isProjectionVerificationCancelledError,
} from "../../data/keyingProjectionVerification/types";
import { principalPolicyCheckpoints } from "../../data/sqlite/principalPolicySchema";
import { createRuntimePrincipalPolicyWarmer } from "./runtimePolicyWarmer";

let history: Awaited<ReturnType<typeof signedAuthorityRecoveryHistory>>;
beforeAll(async () => {
  history = await signedAuthorityRecoveryHistory();
}, 30_000);

async function fixture() {
  const f = await createPublicProjectionHistoryFixture(history);
  const state = { online: true, current: true, fullReads: 0 };
  const incidents: unknown[] = [];
  const warmer = createRuntimePrincipalPolicyWarmer({
    apiClient: {
      getProjectionPolicyHistoryPages:
        f.options.apiClient.getProjectionPolicyHistoryPages.bind(
          f.options.apiClient,
        ),
      getCurrentPrincipalPolicy: async () => {
        state.fullReads += 1;
        return null;
      },
    },
    infra: { execSql: f.options.execSql },
    state,
    util: {
      log: () => {},
      reportSecurityIncident: async (error) => {
        incidents.push(error);
      },
    },
    resolveTrustedUserIdentity: f.options.resolveTrustedUserIdentity,
    withPrincipalHistoryProtection: (operation) =>
      operation({
        protection: f.options.protection,
        stillCurrent: () => state.current,
      }),
  });
  const guarded = generationGuardedPrincipalPolicyWarmer(
    warmer,
    () => state.current,
  );
  const resolve = guarded?.resolveProjectionHistory;
  if (!resolve) throw new Error("Missing public projection resolver");
  return { ...f, state, incidents, resolve: () => resolve(f.options) };
}

test("runtime public projection recovery keeps historical policies out of current checkpoints", async () => {
  const f = await fixture();
  try {
    const result = await f.resolve();
    expect(result.policies).toHaveLength(3);
    expect(result.stillCurrent()).toBe(true);
    f.requests.length = 0;
    f.state.online = false;
    expect((await f.resolve()).policies).toHaveLength(3);
    expect(f.requests).toEqual([]);
    expect(f.incidents).toEqual([]);
    expect(f.state.fullReads).toBe(0);
    expect(await f.db.select().from(principalPolicyCheckpoints)).toEqual([]);
    f.state.current = false;
    expect(result.stillCurrent()).toBe(false);
    const error = await f.resolve().catch((error: unknown) => error);
    expect(isProjectionVerificationCancelledError(error)).toBe(true);
  } finally {
    f.close();
  }
});

test.each([403, 409, 503])(
  "runtime public recovery preserves the %s outage boundary",
  async (status) => {
    const f = await fixture();
    try {
      await f.resolve();
      f.requests.length = 0;
      f.controls.failAfter = 65;
      f.controls.failureStatus = status;
      if (status === 503) expect((await f.resolve()).policies).toHaveLength(3);
      else
        await expect(f.resolve()).rejects.toMatchObject({
          name: "ProjectionDependencyUnavailableError",
        });
      expect(f.requests).toEqual([65]);
      expect(f.incidents).toEqual([]);
      expect(f.state.fullReads).toBe(0);
    } finally {
      f.close();
    }
  },
);

test("runtime public recovery classifies a cold outage as unavailable and invalid evidence as a security incident", async () => {
  const f = await fixture();
  try {
    f.controls.failAfter = 0;
    await expect(f.resolve()).rejects.toMatchObject({
      name: "ProjectionDependencyUnavailableError",
    });
    expect(f.incidents).toEqual([]);
    f.controls.failAfter = null;
    const payload = f.options.evidence.organizationPayloads[0];
    if (!payload) throw new Error("Missing fixture directory");
    payload.payload = {
      ...payload.payload,
      ciphertext: `${payload.payload.ciphertext} `,
    };
    await expect(f.resolve()).rejects.toMatchObject({
      code: "object_mismatch",
    });
    expect(f.incidents).toHaveLength(1);
    expect(f.state.fullReads).toBe(0);
  } finally {
    f.close();
  }
});
