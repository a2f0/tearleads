import { beforeAll, expect, test } from "bun:test";
import {
  createRecoveryFixture,
  signedRecoveryHistory,
} from "../../../test/helpers/principalHistoryRecovery";
import { principalPolicyHead } from "../../../test/helpers/principalPolicyFixtures";
import { isProjectionVerificationCancelledError } from "../../data/keyingProjectionVerification/types";
import { principalHistoryStages } from "../../data/sqlite/principalHistoryStageSchema";
import { clearRemoteSyncState } from "../sync/remoteReset";
import { recoverPrincipalPolicyHistory } from "./recoverPrincipalPolicyHistory";

let history: Awaited<ReturnType<typeof signedRecoveryHistory>>;
beforeAll(async () => {
  history = await signedRecoveryHistory();
});

test("a rejected resumed pin is discarded before the next genesis replay", async () => {
  const fixture = await createRecoveryFixture(history);
  try {
    fixture.controls.failAfterVersion = 32;
    await expect(
      recoverPrincipalPolicyHistory(fixture.options),
    ).rejects.toThrow();
    fixture.controls.failAfterVersion = null;
    fixture.controls.mutate = (page) => {
      page.currentPayload.ciphertext += "changed";
    };
    await expect(
      recoverPrincipalPolicyHistory(fixture.options),
    ).rejects.toMatchObject({
      failure: { kind: "shape" },
    });
    expect(await fixture.db.select().from(principalHistoryStages)).toEqual([]);
    fixture.controls.mutate = null;
    const result = await recoverPrincipalPolicyHistory(fixture.options);
    expect(result.policy.stateHash).toBe(history.expectedHead.stateHash);
    expect(fixture.requests).toEqual([0, 32, 32, 0, 32, 64]);
  } finally {
    fixture.close();
  }
});

test("different retained selections share authenticated resumable progress", async () => {
  const fixture = await createRecoveryFixture(history);
  try {
    const first = history.bundle.previousStates[0]?.state;
    if (!first) throw new Error("Missing fixture reference");
    const selected = {
      ...fixture.options,
      retainedReferences: [
        principalPolicyHead({ ...history.bundle, currentState: first }),
      ],
    };
    fixture.controls.failAfterVersion = 32;
    await expect(
      recoverPrincipalPolicyHistory(fixture.options),
    ).rejects.toThrow();
    await expect(recoverPrincipalPolicyHistory(selected)).rejects.toMatchObject(
      { failure: { status: 503 } },
    );
    expect(await fixture.db.select().from(principalHistoryStages)).toHaveLength(
      1,
    );
    fixture.controls.failAfterVersion = null;
    const current = await recoverPrincipalPolicyHistory(fixture.options);
    const retained = await recoverPrincipalPolicyHistory(selected);
    expect(
      current.policy.retainedHistory.map(({ state }) => state.version),
    ).toEqual([66]);
    expect(
      retained.policy.retainedHistory.map(({ state }) => state.version),
    ).toEqual([1, 66]);
    expect(fixture.requests).toEqual([0, 32, 32, 32, 64, 65]);
  } finally {
    fixture.close();
  }
});

test("an expired lifetime is recognized by SDK cancellation handling", async () => {
  const fixture = await createRecoveryFixture(history);
  try {
    await expect(
      recoverPrincipalPolicyHistory({
        ...fixture.options,
        stillCurrent: () => false,
      }).catch(isProjectionVerificationCancelledError),
    ).resolves.toBe(true);
    expect(fixture.requests).toEqual([]);
  } finally {
    fixture.close();
  }
});

test("shared progress authenticates each new citation without multiplying stages", async () => {
  const fixture = await createRecoveryFixture(history);
  try {
    await recoverPrincipalPolicyHistory(fixture.options);
    const state = history.bundle.previousStates[15]?.state;
    if (!state) throw new Error("Missing historical citation");
    const reference = principalPolicyHead({
      ...history.bundle,
      currentState: state,
    });
    fixture.requests.length = 0;
    await expect(
      recoverPrincipalPolicyHistory({
        ...fixture.options,
        retainedReferences: [{ ...reference, stateHash: "f".repeat(64) }],
        offline: true,
      }),
    ).rejects.toMatchObject({ code: "object_mismatch" });
    const recovered = await recoverPrincipalPolicyHistory({
      ...fixture.options,
      retainedReferences: [reference],
      offline: true,
    });
    expect(
      recovered.policy.retainedHistory.map(({ state }) => state.version),
    ).toEqual([16, 66]);
    expect(fixture.requests).toEqual([]);
    expect(await fixture.db.select().from(principalHistoryStages)).toHaveLength(
      1,
    );
  } finally {
    fixture.close();
  }
});

test("reset invalidates an in-flight recovery through its lifetime guard", async () => {
  const fixture = await createRecoveryFixture(history);
  try {
    let current = true;
    await expect(
      recoverPrincipalPolicyHistory({
        ...fixture.options,
        stillCurrent: () => current,
        resolveTrustedUserIdentity: async (userId) => {
          if (current) {
            current = false;
            await clearRemoteSyncState(fixture.options.execSql, {
              organizationId: "org-1",
            });
          }
          return history.resolveTrustedUserIdentity(userId);
        },
      }).catch(isProjectionVerificationCancelledError),
    ).resolves.toBe(true);
    expect(await fixture.db.select().from(principalHistoryStages)).toEqual([]);
  } finally {
    fixture.close();
  }
});
