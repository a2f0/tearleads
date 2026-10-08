import { expect, test } from "bun:test";
import { verifyPrincipalPolicyCurrent } from "./principalPolicyCurrent";
import { selectPrincipalPolicyCurrentPredecessorReferences } from "./principalPolicyCurrentPredecessorReferences";
import { verifyPrincipalPolicyCurrentSuccessor } from "./principalPolicyCurrentSuccessor";
import { verifyPrincipalPolicyHistoryReferences } from "./principalPolicyHistoryReferences";
import {
  historyFixture,
  historyHead,
} from "./principalPolicyHistoryTestFixtures";
import {
  createPolicySigner,
  signPolicyState,
} from "./principalPolicyTestFixtures";
import type { KeyingVerificationResult } from "./types";

function accepted<T>(result: KeyingVerificationResult<T>): T {
  if (!result.ok) throw result.error;
  return result.value;
}
function artifacts(signed: Awaited<ReturnType<typeof signPolicyState>>) {
  return {
    currentState: signed.state,
    currentProjection: signed.entry.projection,
    currentGrants: signed.entry.grants,
    currentPayload: signed.payload,
    currentMemberEnvelopes: {
      principalId: signed.state.principalId,
      principalType: signed.state.principalType,
      stateHash: signed.state.stateHash,
      epoch: signed.state.keyEpoch,
      envelopes: signed.memberEnvelopes,
    },
  };
}

test("current successors preserve authority monotonicity after an uncited and unretained entry", async () => {
  const f = await historyFixture();
  const external = await createPolicySigner("external");
  const adminFirst = await signPolicyState({
    principalId: "admins",
    signer: external,
    members: [{ userId: external.userId }],
    version: 1,
    prevStateHash: null,
  });
  const adminSecond = await signPolicyState({
    principalId: "admins",
    signer: external,
    members: [{ userId: external.userId }],
    version: 2,
    prevStateHash: adminFirst.state.stateHash,
    keyEpoch: 2,
  });
  const oldHead = {
    ...historyHead(adminFirst.state),
    principalType: "group" as const,
  };
  const newHead = {
    ...historyHead(adminSecond.state),
    principalType: "group" as const,
  };
  const authority = {
    currentHead: newHead,
    states: [
      { head: oldHead, projection: adminFirst.entry.projection },
      { head: newHead, projection: adminSecond.entry.projection },
    ],
  };
  const second = await signPolicyState({
    ...f.shared,
    version: 2,
    prevStateHash: f.first.state.stateHash,
    externalAuthority: newHead,
    projection: f.first.entry.projection,
    signer: external,
  });
  const third = await signPolicyState({
    ...f.shared,
    version: 3,
    prevStateHash: second.state.stateHash,
  });
  const verifier = f.create();
  accepted(
    await verifier.append({
      entries: [f.first.entry, second.entry, third.entry],
      signerPublicKeys: [f.signer, external],
      externalAuthority: authority,
    }),
  );
  const selected = accepted(
    await verifyPrincipalPolicyHistoryReferences({
      history: accepted(verifier.finish(historyHead(third.state))),
      references: [],
    }),
  );
  expect(selected.retainedEntries.map(({ state }) => state.version)).toEqual([
    3,
  ]);
  const predecessor = accepted(
    await verifyPrincipalPolicyCurrent({
      current: artifacts(third),
      history: selected,
    }),
  );
  expect(predecessor.state.externalAuthority).toBeNull();
  const uncited = await signPolicyState({
    ...f.shared,
    version: 4,
    prevStateHash: third.state.stateHash,
  });
  const current = accepted(
    await verifyPrincipalPolicyCurrentSuccessor({
      previous: predecessor,
      current: artifacts(uncited),
      signerPublicKeys: [f.signer],
    }),
  );
  const selectedCurrent = accepted(
    selectPrincipalPolicyCurrentPredecessorReferences({
      current,
      predecessor,
      references: [],
    }),
  );
  for (const previous of [predecessor, selectedCurrent]) {
    for (const [reference, allowed] of [
      [oldHead, false],
      [newHead, true],
    ] as const) {
      const fourth = await signPolicyState({
        ...f.shared,
        version: previous.version + 1,
        prevStateHash: previous.stateHash,
        externalAuthority: reference,
        projection: f.first.entry.projection,
        signer: external,
      });
      const result = await verifyPrincipalPolicyCurrentSuccessor({
        previous,
        current: artifacts(fourth),
        signerPublicKeys: [external],
        externalAuthority: authority,
      });
      expect(result.ok).toBe(allowed);
      if (!result.ok) expect(result.error.code).toBe("rollback");
    }
  }
});
