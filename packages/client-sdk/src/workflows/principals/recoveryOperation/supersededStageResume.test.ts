import { beforeAll, expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  createAuthorityRecoveryFixture,
  signedAuthorityRecoveryHistory,
} from "../../../../test/helpers/principalAuthorityRecovery";
import { principalPolicyHead } from "../../../../test/helpers/principalPolicyFixtures";
import { savePrincipalHistoryStage } from "../../../data/persistence/principalHistory/principalHistoryStagePersistence";
import type { TrustedUserIdentityResolver } from "../../../data/trustedUserIdentity";
import { createRuntimePrincipalPolicyCurrentResolver } from "../runtimePolicyRecovery";
import { createPrincipalCurrentRecoveryBatch } from "./principalCurrentRecoveryBatch";
import { resumeAfterSupersededStage } from "./supersededStageResume";

let history: Awaited<ReturnType<typeof signedAuthorityRecoveryHistory>>;
beforeAll(async () => {
  history = await signedAuthorityRecoveryHistory();
}, 30_000);

/**
 * A queued recovery held after it loads its stages, while the same head is
 * recovered and saved outside the queue, the way an acknowledged publication
 * commits it.
 */
async function supersededRecovery() {
  const source = await createAuthorityRecoveryFixture(history);
  const state = { current: true, online: true };
  const incidents: unknown[] = [];
  let identityReads = 0;
  let reachedGate = () => {};
  const atGate = new Promise<void>((resolve) => {
    reachedGate = resolve;
  });
  let release = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const gatedIdentity: TrustedUserIdentityResolver = async (userId) => {
    identityReads += 1;
    if (identityReads === 1) {
      reachedGate();
      await released;
    }
    return source.options.resolveTrustedUserIdentity(userId);
  };
  const resolve = createRuntimePrincipalPolicyCurrentResolver({
    apiClient: {
      getPrincipalPolicyPages: source.apiClient.getPrincipalPolicyPages.bind(
        source.apiClient,
      ),
    },
    infra: { execSql: source.options.execSql },
    state,
    resolveTrustedUserIdentity: gatedIdentity,
    withPrincipalHistoryProtection: (operation) =>
      operation({
        protection: source.options.protection,
        stillCurrent: () => state.current,
      }),
    util: {
      reportSecurityIncident: async (error) => {
        incidents.push(error);
      },
    },
  });
  if (!resolve) throw new Error("Expected current policy recovery");
  const pending = resolve({
    organizationId: history.organizationId,
    reference: principalPolicyHead(history.group),
    stillCurrent: () => state.current,
  });
  await atGate;
  await createPrincipalCurrentRecoveryBatch().recover({
    ...source.options,
    offline: false,
  });
  return { incidents, pending, release, source, state };
}

test("a queued recovery superseded by a publication of its head resumes and verifies", async () => {
  const f = await supersededRecovery();
  try {
    f.release();
    const recovered = await f.pending;
    expect(recovered.policy.stateHash).toBe(
      history.group.currentState.stateHash,
    );
    expect(recovered.policy.principalId).toBe(
      history.group.currentState.principalId,
    );
    expect(f.incidents).toEqual([]);
  } finally {
    f.source.close();
  }
});

test("a lifetime that ends while superseded does not resume", async () => {
  const f = await supersededRecovery();
  try {
    const requests = f.source.requests.length;
    f.state.current = false;
    f.release();
    await expect(f.pending).rejects.toThrow();
    expect(f.source.requests.length).toBe(requests);
  } finally {
    f.source.close();
  }
});

/** A real progress-CAS loss: another writer saved this stage first. */
async function supersededSave(
  execSql: Parameters<typeof savePrincipalHistoryStage>[0]["execSql"],
) {
  const save = (progress: string) =>
    savePrincipalHistoryStage({
      execSql,
      stage: {
        id: "stage-1",
        organizationId: "org-1",
        currentJson: "{}",
        afterVersion: 1,
        complete: false,
        progress,
      },
      evidence: {
        indexRootHash: "index-root",
        scopeId: "scope-1",
        organizationId: "org-1",
        entries: [],
        nodes: [],
      },
      previousProgress: null,
      stillCurrent: () => true,
    });
  await save("published-progress");
  return save("superseded-progress");
}

test("a second superseded stage and every other failure propagate", async () => {
  const f = await createTestExecSql("superseded-stage-bounded");
  try {
    let attempts = 0;
    await expect(
      resumeAfterSupersededStage(
        async () => {
          attempts += 1;
          await supersededSave(f.execSql);
        },
        () => true,
      ),
    ).rejects.toMatchObject({ code: "principal_history_stage_changed" });
    expect(attempts).toBe(2);
    attempts = 0;
    await expect(
      resumeAfterSupersededStage(
        async () => {
          attempts += 1;
          throw new Error("history unavailable");
        },
        () => true,
      ),
    ).rejects.toThrow("history unavailable");
    expect(attempts).toBe(1);
  } finally {
    f.close();
  }
});

test("a lifetime that ended during the lost save does not resume", async () => {
  const f = await createTestExecSql("superseded-stage-expired");
  try {
    let current = true;
    let attempts = 0;
    await expect(
      resumeAfterSupersededStage(
        async () => {
          attempts += 1;
          current = false;
          await supersededSave(f.execSql);
        },
        () => current,
      ),
    ).rejects.toThrow();
    expect(attempts).toBe(1);
  } finally {
    f.close();
  }
});
