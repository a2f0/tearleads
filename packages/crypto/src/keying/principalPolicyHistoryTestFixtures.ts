import { generateKemSeedAndKeyPair } from "../encapsulation/generateKeyPair";
import { createPrincipalPolicyHistoryVerifier } from "./principalPolicyHistory";
import {
  createPolicySigner,
  signPolicyState,
} from "./principalPolicyTestFixtures";
import type {
  PrincipalPolicySignedState,
  ReferencedPrincipalHead,
} from "./types";

export function historyHead(
  state: PrincipalPolicySignedState,
): ReferencedPrincipalHead {
  return {
    principalId: state.principalId,
    principalType: state.principalType,
    version: state.version,
    stateHash: state.stateHash,
    keyEpoch: state.keyEpoch,
    keyFingerprint: state.keyFingerprint,
  };
}

export async function historyFixture() {
  const signer = await createPolicySigner();
  const shared = {
    principalId: "paged-group",
    principalKeyPair: generateKemSeedAndKeyPair(),
    members: [{ userId: signer.userId }],
    signer,
  };
  const first = await signPolicyState({
    ...shared,
    version: 1,
    prevStateHash: null,
  });
  const second = await signPolicyState({
    ...shared,
    version: 2,
    prevStateHash: first.state.stateHash,
  });
  const third = await signPolicyState({
    ...shared,
    version: 3,
    prevStateHash: second.state.stateHash,
  });
  const create = () =>
    createPrincipalPolicyHistoryVerifier({
      principalId: shared.principalId,
      principalType: "group",
    });
  return { shared, signer, first, second, third, create };
}
