import { beforeAll, expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { eq } from "drizzle-orm";
import {
  serveRecoveryHistory,
  signedRecoveryHistory,
} from "../../../test/helpers/principalHistoryRecovery";
import { principalPolicyHead } from "../../../test/helpers/principalPolicyFixtures";
import { loadPrincipalPolicyCheckpoint } from "../../data/persistence/keyingCheckpointPersistence";
import { principalHistoryStages } from "../../data/sqlite/principalHistoryStageSchema";
import { principalPolicyCheckpoints } from "../../data/sqlite/principalPolicySchema";
import { getClientSQLitePersistenceRuntime } from "../../data/sqlite/sqlitePersistenceRuntime";
import type { RecoverPrincipalPolicyHistoryOptions } from "./principalHistoryRecoveryTypes";
import { recoverPrincipalPolicyHistory } from "./recoverPrincipalPolicyHistory";

let history: Awaited<ReturnType<typeof signedRecoveryHistory>>;
beforeAll(async () => {
  history = await signedRecoveryHistory();
});

async function recoveryFixture(
  retained: Parameters<typeof serveRecoveryHistory>[1] = [],
) {
  const sqlite = await createTestExecSql("principal-history-recovery");
  const http = serveRecoveryHistory(history.bundle, retained);
  const options: RecoverPrincipalPolicyHistoryOptions = {
    apiClient: http.client(),
    execSql: sqlite.execSql,
    organizationId: "org-1",
    expectedHead: history.expectedHead,
    protection: {
      localKey: new Uint8Array(32).fill(7),
      context: "device-and-trust-domain-1",
    },
    resolveTrustedUserIdentity: history.resolveTrustedUserIdentity,
    stillCurrent: () => true,
  };
  const db = getClientSQLitePersistenceRuntime(sqlite.execSql).db;
  return {
    ...http,
    options,
    db,
    close() {
      http.close();
      sqlite.close();
    },
  };
}

test("a fresh SDK operation resumes checked pages after an HTTP interruption", async () => {
  const fixture = await recoveryFixture();
  try {
    fixture.controls.failAfterVersion = 32;
    await expect(
      recoverPrincipalPolicyHistory(fixture.options),
    ).rejects.toMatchObject({ failure: { status: 503 } });
    expect(fixture.requests).toEqual([0, 32]);
    const [stage] = await fixture.db.select().from(principalHistoryStages);
    expect(stage).toMatchObject({ afterVersion: 32, complete: false });
    fixture.controls.failAfterVersion = null;
    const result = await recoverPrincipalPolicyHistory({
      ...fixture.options,
      apiClient: fixture.client(),
    });
    expect(fixture.requests).toEqual([0, 32, 32, 64]);
    expect(result.policy.stateHash).toBe(history.expectedHead.stateHash);
    expect(
      result.policy.retainedHistory.map((entry) => entry.state.version),
    ).toEqual([66]);
    expect(
      await loadPrincipalPolicyCheckpoint(
        fixture.options.execSql,
        "group",
        history.expectedHead.principalId,
      ),
    ).toBeNull();
  } finally {
    fixture.close();
  }
});

test("finished progress still rechecks live HTTP access before reuse", async () => {
  const fixture = await recoveryFixture();
  try {
    await recoverPrincipalPolicyHistory(fixture.options);
    fixture.controls.failAfterVersion = 65;
    await expect(
      recoverPrincipalPolicyHistory({
        ...fixture.options,
        apiClient: fixture.client(),
      }),
    ).rejects.toMatchObject({ failure: { status: 503 } });
    expect(fixture.requests).toEqual([0, 32, 64, 65]);
  } finally {
    fixture.close();
  }
});

for (const tampering of ["cursor", "artifacts", "ciphertext", "key"] as const) {
  test(`saved ${tampering} cannot substitute for authenticated progress`, async () => {
    const fixture = await recoveryFixture();
    try {
      fixture.controls.failAfterVersion = 32;
      await expect(
        recoverPrincipalPolicyHistory(fixture.options),
      ).rejects.toThrow();
      const [stage] = await fixture.db.select().from(principalHistoryStages);
      if (!stage) throw new Error("Missing saved progress");
      if (tampering !== "key") {
        const changes =
          tampering === "cursor"
            ? { afterVersion: 64 }
            : tampering === "artifacts"
              ? {
                  currentJson: stage.currentJson.replace(
                    "signed-recovery-fixture",
                    "substituted",
                  ),
                }
              : { progress: `${stage.progress.slice(0, -4)}AAAA` };
        await fixture.db
          .update(principalHistoryStages)
          .set(changes)
          .where(eq(principalHistoryStages.id, stage.id))
          .run();
      }
      fixture.controls.failAfterVersion = null;
      await recoverPrincipalPolicyHistory({
        ...fixture.options,
        protection:
          tampering === "key"
            ? {
                ...fixture.options.protection,
                localKey: new Uint8Array(32).fill(9),
              }
            : fixture.options.protection,
        apiClient: fixture.client(),
      });
      expect(fixture.requests).toEqual([0, 32, 0, 32, 64]);
    } finally {
      fixture.close();
    }
  });
}

test("retains requested older evidence without retaining the entire chain", async () => {
  const fixture = await recoveryFixture();
  try {
    const first = history.bundle.previousStates[0];
    if (!first) throw new Error("Missing first state");
    const reference = principalPolicyHead({
      ...history.bundle,
      currentState: first.state,
    });
    const result = await recoverPrincipalPolicyHistory({
      ...fixture.options,
      retainedReferences: [reference],
    });
    expect(
      result.policy.retainedHistory.map((entry) => entry.state.version),
    ).toEqual([1, 66]);
  } finally {
    fixture.close();
  }
});

test("rejects a forged later page without publishing its progress", async () => {
  const fixture = await recoveryFixture();
  try {
    fixture.controls.mutate = (page) => {
      if (page.historyPage.afterVersion !== 32) return;
      const state = page.previousStates[0]?.state;
      if (state) state.signature = history.bundle.currentState.signature;
    };
    await expect(
      recoverPrincipalPolicyHistory(fixture.options),
    ).rejects.toMatchObject({ code: "signature_mismatch" });
    const [stage] = await fixture.db.select().from(principalHistoryStages);
    expect(stage).toMatchObject({ afterVersion: 32, complete: false });
  } finally {
    fixture.close();
  }
});

test("cancellation during signer resolution rolls back staged progress", async () => {
  const fixture = await recoveryFixture();
  try {
    let current = true;
    await expect(
      recoverPrincipalPolicyHistory({
        ...fixture.options,
        stillCurrent: () => current,
        resolveTrustedUserIdentity: async (userId) => {
          current = false;
          return history.resolveTrustedUserIdentity(userId);
        },
      }),
    ).rejects.toMatchObject({ name: "ProjectionVerificationCancelledError" });
    expect(await fixture.db.select().from(principalHistoryStages)).toEqual([]);
  } finally {
    fixture.close();
  }
});

test("concurrent recoveries cannot replace another operation's accepted progress", async () => {
  const fixture = await recoveryFixture();
  try {
    let arrived = 0;
    let release = () => {};
    const bothReading = new Promise<void>((resolve) => {
      release = resolve;
    });
    const resolver: RecoverPrincipalPolicyHistoryOptions["resolveTrustedUserIdentity"] =
      async (userId) => {
        arrived += 1;
        if (arrived === 2) release();
        if (arrived <= 2) await bothReading;
        return history.resolveTrustedUserIdentity(userId);
      };
    const results = await Promise.allSettled(
      [1, 2].map(() =>
        recoverPrincipalPolicyHistory({
          ...fixture.options,
          apiClient: fixture.client(),
          resolveTrustedUserIdentity: resolver,
        }),
      ),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const failure = results.find((result) => result.status === "rejected");
    expect(failure?.status === "rejected" && failure.reason).toMatchObject({
      code: "principal_history_stage_changed",
    });
    expect(
      await fixture.db
        .select({ complete: principalHistoryStages.complete })
        .from(principalHistoryStages),
    ).toEqual([{ complete: true }]);
  } finally {
    fixture.close();
  }
});

test("resumes checked progress that has not yet reached the local checkpoint", async () => {
  const fixture = await recoveryFixture();
  try {
    await loadPrincipalPolicyCheckpoint(
      fixture.options.execSql,
      "group",
      history.expectedHead.principalId,
    );
    const checkpoint = history.bundle.previousStates[39]?.state;
    if (!checkpoint) throw new Error("Missing checkpoint fixture");
    await fixture.db
      .insert(principalPolicyCheckpoints)
      .values({
        principalType: "group",
        principalId: checkpoint.principalId,
        version: checkpoint.version,
        stateHash: checkpoint.stateHash,
        updatedAt: checkpoint.createdAt,
      })
      .run();
    fixture.controls.failAfterVersion = 32;
    await expect(
      recoverPrincipalPolicyHistory(fixture.options),
    ).rejects.toThrow();
    fixture.controls.failAfterVersion = null;
    const recovered = await recoverPrincipalPolicyHistory({
      ...fixture.options,
      apiClient: fixture.client(),
    });
    expect(recovered.policy.version).toBe(66);
    expect(fixture.requests).toEqual([0, 32, 32, 64]);
  } finally {
    fixture.close();
  }
});

test("a checkpoint change while consuming the final page prevents publication", async () => {
  const fixture = await recoveryFixture();
  try {
    const client = fixture.client();
    await expect(
      recoverPrincipalPolicyHistory({
        ...fixture.options,
        apiClient: {
          async *getPrincipalPolicyPages(...args) {
            yield* client.getPrincipalPolicyPages(...args);
            await fixture.db
              .insert(principalPolicyCheckpoints)
              .values({
                principalType: "group",
                principalId: history.expectedHead.principalId,
                version: history.expectedHead.version,
                stateHash: history.expectedHead.stateHash,
                updatedAt: history.bundle.currentState.createdAt,
              })
              .run();
          },
        },
      }),
    ).rejects.toMatchObject({ code: "stale_predecessor" });
  } finally {
    fixture.close();
  }
});

test("a stale operation cannot delete another lifetime's saved progress", async () => {
  const fixture = await recoveryFixture();
  try {
    fixture.controls.failAfterVersion = 32;
    await expect(
      recoverPrincipalPolicyHistory(fixture.options),
    ).rejects.toThrow();
    const before = await fixture.db.select().from(principalHistoryStages);
    let checks = 0;
    await expect(
      recoverPrincipalPolicyHistory({
        ...fixture.options,
        protection: {
          ...fixture.options.protection,
          localKey: new Uint8Array(32).fill(9),
        },
        stillCurrent: () => {
          checks += 1;
          return checks === 1;
        },
      }),
    ).rejects.toMatchObject({ name: "ProjectionVerificationCancelledError" });
    expect(await fixture.db.select().from(principalHistoryStages)).toEqual(
      before,
    );
  } finally {
    fixture.close();
  }
});

test("does not return a partial selection for a reference beyond the requested head", async () => {
  const fixture = await recoveryFixture();
  try {
    await expect(
      recoverPrincipalPolicyHistory({
        ...fixture.options,
        retainedReferences: [
          {
            ...history.expectedHead,
            version: history.expectedHead.version + 1,
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "missing_dependency" });
    expect(fixture.requests).toEqual([]);
  } finally {
    fixture.close();
  }
});

test("recoveries of different pinned heads do not replace each other's saved work", async () => {
  const state = history.bundle.previousStates[32]?.state;
  if (!state) throw new Error("Missing historical head");
  const older = {
    ...history.bundle,
    currentState: state,
    currentPayload: {
      ...history.bundle.currentPayload,
      stateHash: state.stateHash,
    },
    currentMemberEnvelopes: {
      ...history.bundle.currentMemberEnvelopes,
      stateHash: state.stateHash,
    },
    previousStates: history.bundle.previousStates.slice(0, 32),
  };
  const fixture = await recoveryFixture([older]);
  try {
    let arrived = 0;
    let release = () => {};
    const bothReading = new Promise<void>((resolve) => {
      release = resolve;
    });
    const resolver: RecoverPrincipalPolicyHistoryOptions["resolveTrustedUserIdentity"] =
      async (userId) => {
        arrived += 1;
        if (arrived === 2) release();
        if (arrived <= 2) await bothReading;
        return history.resolveTrustedUserIdentity(userId);
      };
    const results = await Promise.allSettled(
      [history.expectedHead, principalPolicyHead(older)].map((expectedHead) =>
        recoverPrincipalPolicyHistory({
          ...fixture.options,
          expectedHead,
          apiClient: fixture.client(),
          resolveTrustedUserIdentity: resolver,
        }),
      ),
    );
    expect(results.map((result) => result.status)).toEqual([
      "fulfilled",
      "fulfilled",
    ]);
    expect(
      await fixture.db
        .select({ complete: principalHistoryStages.complete })
        .from(principalHistoryStages),
    ).toEqual([{ complete: true }, { complete: true }]);
  } finally {
    fixture.close();
  }
});

test("an AbortSignal during signer resolution does not save accepted progress", async () => {
  const fixture = await recoveryFixture();
  try {
    const abort = new AbortController();
    await expect(
      recoverPrincipalPolicyHistory({
        ...fixture.options,
        signal: abort.signal,
        resolveTrustedUserIdentity: async (userId) => {
          abort.abort();
          return history.resolveTrustedUserIdentity(userId);
        },
      }),
    ).rejects.toMatchObject({ name: "ProjectionVerificationCancelledError" });
    expect(await fixture.db.select().from(principalHistoryStages)).toEqual([]);
  } finally {
    fixture.close();
  }
});
