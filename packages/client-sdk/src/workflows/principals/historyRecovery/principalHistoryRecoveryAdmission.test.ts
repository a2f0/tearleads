import { beforeAll, expect, test } from "bun:test";
import {
  createRecoveryFixture,
  signedRecoveryHistory,
} from "../../../../test/helpers/principalHistoryRecovery";
import { pinPrincipalPolicyCheckpoint } from "../../../../test/helpers/principalPolicyCheckpointPins";
import { principalPolicyHead } from "../../../../test/helpers/principalPolicyFixtures";
import { verifiedPrincipalPolicyMeetsCheckpoint } from "../../../data/keyingProjectionVerification/principalPolicy/principalPolicyCheckpointSelection";
import { advanceKeyingCheckpointsAtomically } from "../../../data/persistence/keyingCheckpoints/keyingCheckpointAdvancePersistence";
import { loadPrincipalPolicyCheckpoint } from "../../../data/persistence/keyingCheckpoints/keyingCheckpointPersistence";
import { recoverPrincipalPolicyHistory } from "./recoverPrincipalPolicyHistory";

let history: Awaited<ReturnType<typeof signedRecoveryHistory>>;
beforeAll(async () => {
  history = await signedRecoveryHistory();
});

async function storeCheckpoint(
  fixture: Awaited<ReturnType<typeof createRecoveryFixture>>,
  version: number,
) {
  // Initialize the persistence tables before inserting the test checkpoint.
  await loadPrincipalPolicyCheckpoint(
    fixture.options.execSql,
    "group",
    history.expectedHead.principalId,
  );
  const state = history.bundle.previousStates[version - 1]?.state;
  if (!state) throw new Error("Missing checkpoint fixture");
  const checkpoint = {
    principalType: "group" as const,
    principalId: state.principalId,
    version: state.version,
    stateHash: state.stateHash,
  };
  await pinPrincipalPolicyCheckpoint(fixture.db, {
    ...checkpoint,
    updatedAt: state.createdAt,
    organizationId: fixture.options.organizationId,
  });
  return checkpoint;
}

test("a recovered sparse policy advances its retained checkpoint atomically", async () => {
  const fixture = await createRecoveryFixture(history);
  try {
    const previous = await storeCheckpoint(fixture, 16);
    const recovered = await recoverPrincipalPolicyHistory(fixture.options);
    expect(
      recovered.policy.retainedHistory.map(({ state }) => state.version),
    ).toEqual([16, 66]);
    expect(
      verifiedPrincipalPolicyMeetsCheckpoint(recovered.policy, previous),
    ).toBe(true);
    await advanceKeyingCheckpointsAtomically({
      access: [],
      execSql: fixture.options.execSql,
      organizationId: fixture.options.organizationId,
      policies: [recovered.policy],
      stillCurrent: () => true,
    });
    expect(
      await loadPrincipalPolicyCheckpoint(
        fixture.options.execSql,
        "group",
        history.expectedHead.principalId,
      ),
    ).toEqual(recovered.policy.checkpoint);
  } finally {
    fixture.close();
  }
});

test("a different durable checkpoint after recovery requires fresh evidence", async () => {
  const fixture = await createRecoveryFixture(history);
  try {
    await storeCheckpoint(fixture, 16);
    const recovered = await recoverPrincipalPolicyHistory(fixture.options);
    const newer = await storeCheckpoint(fixture, 32);
    expect(() =>
      verifiedPrincipalPolicyMeetsCheckpoint(recovered.policy, newer),
    ).toThrow();
    await expect(
      advanceKeyingCheckpointsAtomically({
        access: [],
        execSql: fixture.options.execSql,
        organizationId: fixture.options.organizationId,
        policies: [recovered.policy],
      }),
    ).rejects.toMatchObject({ code: "stale_predecessor" });
    expect(
      await loadPrincipalPolicyCheckpoint(
        fixture.options.execSql,
        "group",
        history.expectedHead.principalId,
      ),
    ).toEqual(newer);
  } finally {
    fixture.close();
  }
});

test.each([true, false])(
  "a sparse batch requires its observed predecessor to be retained: %s",
  async (retainObserved) => {
    const entry = history.bundle.previousStates[31];
    if (!entry) throw new Error("Missing observed fixture state");
    const observedBundle = {
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
      previousStates: history.bundle.previousStates.slice(0, 31),
    };
    const fixture = await createRecoveryFixture(history, [observedBundle]);
    try {
      const previous = await storeCheckpoint(fixture, 16);
      const observedHead = principalPolicyHead(observedBundle);
      const observed = await recoverPrincipalPolicyHistory({
        ...fixture.options,
        expectedHead: observedHead,
      });
      const recovered = await recoverPrincipalPolicyHistory({
        ...fixture.options,
        retainedReferences: retainObserved ? [observedHead] : [],
      });
      const advance = advanceKeyingCheckpointsAtomically({
        access: [],
        execSql: fixture.options.execSql,
        organizationId: fixture.options.organizationId,
        policies: [observed.policy, recovered.policy],
      });
      if (retainObserved) await advance;
      else
        await expect(advance).rejects.toMatchObject({
          code: "stale_predecessor",
        });
      expect(
        await loadPrincipalPolicyCheckpoint(
          fixture.options.execSql,
          "group",
          history.expectedHead.principalId,
        ),
      ).toEqual(retainObserved ? recovered.policy.checkpoint : previous);
    } finally {
      fixture.close();
    }
  },
);

test("cancelled sparse admission cannot advance its checkpoint", async () => {
  const fixture = await createRecoveryFixture(history);
  try {
    const previous = await storeCheckpoint(fixture, 16);
    const recovered = await recoverPrincipalPolicyHistory(fixture.options);
    await advanceKeyingCheckpointsAtomically({
      access: [],
      execSql: fixture.options.execSql,
      organizationId: fixture.options.organizationId,
      policies: [recovered.policy],
      stillCurrent: () => false,
    });
    expect(
      await loadPrincipalPolicyCheckpoint(
        fixture.options.execSql,
        "group",
        history.expectedHead.principalId,
      ),
    ).toEqual(previous);
  } finally {
    fixture.close();
  }
});
