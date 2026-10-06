import { beforeAll, expect, test } from "bun:test";
import {
  createRecoveryFixture,
  signedRecoveryHistory,
} from "../../../test/helpers/principalHistoryRecovery";
import { loadPrincipalPolicyCheckpoint } from "../../data/persistence/keyingCheckpointPersistence";
import { principalHistoryStages } from "../../data/sqlite/principalHistoryStageSchema";
import { principalPolicyCheckpoints } from "../../data/sqlite/principalPolicySchema";
import { recoverPrincipalPolicyHistory } from "./recoverPrincipalPolicyHistory";

let history: Awaited<ReturnType<typeof signedRecoveryHistory>>;
let fork: typeof history;
beforeAll(async () => {
  history = await signedRecoveryHistory();
  // A second genuinely signed chain for the same principal has a different
  // state hash at version 32; its previously admitted pin must survive.
  fork = await signedRecoveryHistory();
});

test.each([false, true])(
  "a conflicting durable checkpoint rejects recovery (cached=%s)",
  async (cached) => {
    const fixture = await createRecoveryFixture(history);
    try {
      if (cached) await recoverPrincipalPolicyHistory(fixture.options);
      await loadPrincipalPolicyCheckpoint(
        fixture.options.execSql,
        "group",
        history.expectedHead.principalId,
      );
      const state = fork.bundle.previousStates[31]?.state;
      if (!state) throw new Error("Missing signed fork fixture");
      expect(state.stateHash).not.toBe(
        history.bundle.previousStates[31]?.state.stateHash,
      );
      const checkpoint = {
        principalType: "group" as const,
        principalId: state.principalId,
        version: 32,
        stateHash: state.stateHash,
      };
      await fixture.db
        .insert(principalPolicyCheckpoints)
        .values({ ...checkpoint, updatedAt: state.createdAt })
        .run();
      await expect(
        recoverPrincipalPolicyHistory(fixture.options),
      ).rejects.toMatchObject({ code: "stale_predecessor" });
      expect(
        await loadPrincipalPolicyCheckpoint(
          fixture.options.execSql,
          "group",
          state.principalId,
        ),
      ).toEqual(checkpoint);
    } finally {
      fixture.close();
    }
  },
);

test("a checkpoint changing after a cached read propagates without replay or discarding progress", async () => {
  const fixture = await createRecoveryFixture(history);
  try {
    await recoverPrincipalPolicyHistory(fixture.options);
    const stages = await fixture.db.select().from(principalHistoryStages);
    fixture.requests.length = 0;
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
              .onConflictDoNothing()
              .run();
          },
        },
      }),
    ).rejects.toMatchObject({ code: "stale_predecessor" });
    expect(fixture.requests).toEqual([65]);
    expect(await fixture.db.select().from(principalHistoryStages)).toEqual(
      stages,
    );
  } finally {
    fixture.close();
  }
});
