import { expect, test } from "bun:test";
import {
  createRecoveryFixture,
  signedRecoveryHistory,
} from "../../../test/helpers/principalHistoryRecovery";
import {
  principalPolicyHead,
  signedPrincipalPolicyBundle,
} from "../../../test/helpers/principalPolicyFixtures";
import { recoverPrincipalPolicyHistory } from "../../workflows/principals/recoverPrincipalPolicyHistory";
import { principalHistoryStageScopes } from "../sqlite/principalHistoryRetentionSchema";
import { principalHistoryStages } from "../sqlite/principalHistoryStageSchema";

async function interruptedTargets() {
  const history = await signedRecoveryHistory(66);
  const targets = [history.bundle];
  let previous = history.bundle;
  for (let index = 0; index < 8; index++) {
    previous = await signedPrincipalPolicyBundle({
      memberEnvelopes: previous.currentMemberEnvelopes.envelopes,
      projection: previous.currentProjection,
      payloadCiphertext: previous.currentPayload.ciphertext,
      previousStates: [
        ...previous.previousStates,
        {
          state: previous.currentState,
          projection: previous.currentProjection,
          grants: previous.currentGrants,
        },
      ],
      signing: {
        ...previous.currentState,
        grants: previous.currentGrants,
        version: previous.currentState.version + 1,
        prevStateHash: previous.currentState.stateHash,
      },
      signingPrivateKey: history.signingPrivateKey,
    });
    targets.push(previous);
  }
  return { history, targets };
}

test("interrupted exact heads have bounded progress and evicted work can recover again", async () => {
  const { history, targets } = await interruptedTargets();
  const f = await createRecoveryFixture(history, targets.slice(1));
  try {
    f.controls.failAfterVersion = 32;
    for (const target of targets)
      await expect(
        recoverPrincipalPolicyHistory({
          ...f.options,
          expectedHead: principalPolicyHead(target),
        }),
      ).rejects.toThrow("503 Service Unavailable");
    expect(await f.db.select().from(principalHistoryStages)).toHaveLength(8);
    expect(await f.db.select().from(principalHistoryStageScopes)).toHaveLength(
      8,
    );
    const versions = (await f.db.select().from(principalHistoryStages)).map(
      (stage) => JSON.parse(stage.currentJson).currentState.version,
    );
    expect(versions).toContain(74);
    const evicted = targets.filter(
      (target) => !versions.includes(target.currentState.version),
    );
    expect(evicted).toHaveLength(1);
    const target = evicted[0];
    if (!target) throw new Error("Missing evicted recovery target");
    f.controls.failAfterVersion = null;
    f.requests.length = 0;
    const recovered = await recoverPrincipalPolicyHistory({
      ...f.options,
      expectedHead: principalPolicyHead(target),
    });
    expect(recovered.policy.version).toBe(target.currentState.version);
    expect(f.requests).toEqual([0, 32, 64]);
  } finally {
    f.close();
  }
}, 15_000);
