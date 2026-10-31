import { beforeAll, expect, test } from "bun:test";
import {
  createRecoveryFixture,
  signedRecoveryHistory,
} from "../../../../test/helpers/principalHistoryRecovery";
import { pinPrincipalPolicyCheckpoint } from "../../../../test/helpers/principalPolicyCheckpointPins";
import { principalPolicyHead } from "../../../../test/helpers/principalPolicyFixtures";
import { loadPrincipalPolicyCheckpoint } from "../../../data/persistence/keyingCheckpoints/keyingCheckpointPersistence";
import { principalHistoryStages } from "../../../data/sqlite/schema/principalHistoryStageSchema";
import { createExecSql } from "../../../data/sqlite/sqlSchema";
import { recoverPrincipalPolicyHistory } from "./recoverPrincipalPolicyHistory";

let history: Awaited<ReturnType<typeof signedRecoveryHistory>>;
let fork: typeof history;
beforeAll(async () => {
  history = await signedRecoveryHistory();
  // A second genuinely signed chain for the same principal has a different
  // state hash at version 32; its previously admitted pin must survive.
  fork = await signedRecoveryHistory();
});

test.each(["reference", "checkpoint"] as const)(
  "an above-head %s rejects cached recovery before any request or cache mutation",
  async (kind) => {
    const fixture = await createRecoveryFixture(history);
    try {
      await recoverPrincipalPolicyHistory(fixture.options);
      const stages = await fixture.db.select().from(principalHistoryStages);
      fixture.requests.length = 0;
      if (kind === "checkpoint") {
        await pinPrincipalPolicyCheckpoint(fixture.db, {
          principalType: "group",
          principalId: history.expectedHead.principalId,
          version: 67,
          stateHash: history.expectedHead.stateHash,
          updatedAt: history.bundle.currentState.createdAt,
          organizationId: fixture.options.organizationId,
        });
      }
      await expect(
        recoverPrincipalPolicyHistory({
          ...fixture.options,
          ...(kind === "reference"
            ? { retainedReferences: [{ ...history.expectedHead, version: 67 }] }
            : {}),
        }),
      ).rejects.toMatchObject({
        code: kind === "reference" ? "missing_dependency" : "rollback",
      });
      expect(fixture.requests).toEqual([]);
      expect(await fixture.db.select().from(principalHistoryStages)).toEqual(
        stages,
      );
    } finally {
      fixture.close();
    }
  },
);

test.each([16, 66])(
  "checkpoint %s may overlap the citation and the current leaf",
  async (version) => {
    const fixture = await createRecoveryFixture(history);
    try {
      await recoverPrincipalPolicyHistory(fixture.options);
      fixture.requests.length = 0;
      const state =
        version === 66
          ? history.bundle.currentState
          : history.bundle.previousStates[version - 1]?.state;
      if (!state) throw new Error("Missing checkpoint entry");
      await pinPrincipalPolicyCheckpoint(fixture.db, {
        principalType: "group",
        principalId: state.principalId,
        version,
        stateHash: state.stateHash,
        updatedAt: state.createdAt,
        organizationId: fixture.options.organizationId,
      });
      const result = await recoverPrincipalPolicyHistory({
        ...fixture.options,
        retainedReferences: [
          principalPolicyHead({ ...history.bundle, currentState: state }),
        ],
      });
      expect(
        result.policy.retainedHistory.map((entry) => entry.state.version),
      ).toEqual(version === 66 ? [66] : [16, 66]);
      expect(fixture.requests).toEqual([]);
    } finally {
      fixture.close();
    }
  },
);

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
      await pinPrincipalPolicyCheckpoint(fixture.db, {
        ...checkpoint,
        updatedAt: state.createdAt,
        organizationId: fixture.options.organizationId,
      });
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
    let checkpointReads = 0;
    let advanced = false;
    // A concurrent admission advances the pin after recovery loaded it.
    const execSql = createExecSql({
      async exec({ sql, bind, rowMode }) {
        const result =
          rowMode === "array"
            ? await fixture.options.execSql(sql, bind, { rowMode: "array" })
            : await fixture.options.execSql(sql, bind);
        if (sql.includes('from "principal_policy_checkpoints"'))
          checkpointReads += 1;
        if (checkpointReads === 1 && !advanced) {
          advanced = true;
          await pinPrincipalPolicyCheckpoint(fixture.db, {
            principalType: "group",
            principalId: history.expectedHead.principalId,
            version: history.expectedHead.version,
            stateHash: history.expectedHead.stateHash,
            updatedAt: history.bundle.currentState.createdAt,
            organizationId: fixture.options.organizationId,
          });
        }
        return { rows: result };
      },
    });
    await expect(
      recoverPrincipalPolicyHistory({ ...fixture.options, execSql }),
    ).rejects.toMatchObject({ code: "stale_predecessor" });
    expect(fixture.requests).toEqual([]);
    expect(await fixture.db.select().from(principalHistoryStages)).toEqual(
      stages,
    );
  } finally {
    fixture.close();
  }
});
