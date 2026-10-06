import { beforeAll, expect, test } from "bun:test";
import {
  createRecoveryFixture,
  signedRecoveryHistory,
} from "../../../test/helpers/principalHistoryRecovery";
import { principalPolicyHead } from "../../../test/helpers/principalPolicyFixtures";
import { loadPrincipalPolicyCheckpoint } from "../../data/persistence/keyingCheckpointPersistence";
import { principalPolicyCheckpoints } from "../../data/sqlite/principalPolicySchema";
import { recoverPrincipalPolicyHistory } from "./recoverPrincipalPolicyHistory";

let history: Awaited<ReturnType<typeof signedRecoveryHistory>>;
beforeAll(async () => {
  history = await signedRecoveryHistory(67);
});

function earlierBundle(version: number) {
  const entry = history.bundle.previousStates[version - 1];
  if (!entry) throw new Error("Missing earlier signed head");
  return {
    ...history.bundle,
    currentState: entry.state,
    currentProjection: entry.projection,
    currentGrants: entry.grants,
    currentPayload: {
      ...history.bundle.currentPayload,
      stateHash: entry.state.stateHash,
    },
    currentMemberEnvelopes: {
      ...history.bundle.currentMemberEnvelopes,
      stateHash: entry.state.stateHash,
    },
    previousStates: history.bundle.previousStates.slice(0, version - 1),
  };
}

test("a new transport client extends a durably verified prior head", async () => {
  const previous = earlierBundle(66);
  const fixture = await createRecoveryFixture(history, [previous]);
  try {
    await recoverPrincipalPolicyHistory({
      ...fixture.options,
      expectedHead: principalPolicyHead(previous),
    });
    fixture.requests.length = 0;
    const recovered = await recoverPrincipalPolicyHistory({
      ...fixture.options,
      apiClient: fixture.client(),
    });
    expect(recovered.policy.checkpoint.stateHash).toBe(
      history.expectedHead.stateHash,
    );
    expect(fixture.requests).toEqual([66]);
  } finally {
    fixture.close();
  }
});

test("new citations and a later local checkpoint reuse a completed prefix", async () => {
  const fixture = await createRecoveryFixture(history);
  try {
    await recoverPrincipalPolicyHistory(fixture.options);
    const checkpoint = earlierBundle(32).currentState;
    await loadPrincipalPolicyCheckpoint(
      fixture.options.execSql,
      "group",
      checkpoint.principalId,
    );
    await fixture.db
      .insert(principalPolicyCheckpoints)
      .values({
        principalType: "group",
        principalId: checkpoint.principalId,
        version: 32,
        stateHash: checkpoint.stateHash,
        updatedAt: checkpoint.createdAt,
      })
      .run();
    fixture.requests.length = 0;
    const recovered = await recoverPrincipalPolicyHistory({
      ...fixture.options,
      apiClient: fixture.client(),
      retainedReferences: [principalPolicyHead(earlierBundle(16))],
    });
    expect(
      recovered.policy.retainedHistory.map(({ state }) => state.version),
    ).toEqual([16, 32, 67]);
    expect(fixture.requests).toEqual([66]);
  } finally {
    fixture.close();
  }
});
