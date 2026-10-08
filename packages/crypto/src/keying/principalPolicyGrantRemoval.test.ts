import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "../encapsulation/generateKeyPair";
import type { PrincipalContainerGrant } from "../principalState";
import {
  getPrincipalPolicyTransitionMismatch,
  verifyPrincipalPolicyBundle,
} from "./index";
import {
  createBundle,
  createPolicySigner,
  expectVerificationError,
  signPolicyState,
} from "./principalPolicyTestFixtures";

const read = { accessLevel: "read", containerId: "container-a" } as const;
const write = { accessLevel: "write", containerId: "container-a" } as const;
const other = { accessLevel: "read", containerId: "container-b" } as const;

// Container KEK wraps sealed to the group key outlive a revoked grant, so a
// same-epoch policy that drops a container would let a later joiner open the
// history the group lost (#2365 finding 20). Clients refuse it as the API does.
async function grantTransition(input: {
  readonly nextGrants: readonly PrincipalContainerGrant[];
  readonly nextKeyEpoch: number;
  readonly previousGrants: readonly PrincipalContainerGrant[];
}) {
  const signer = await createPolicySigner();
  const principalId = "group-grant-removal";
  const principalKeyPair = generateKemSeedAndKeyPair();
  const members = [{ userId: signer.userId }];
  const first = await signPolicyState({
    grants: input.previousGrants,
    keyEpoch: 1,
    members,
    prevStateHash: null,
    principalId,
    principalKeyPair,
    signer,
    version: 1,
  });
  const second = await signPolicyState({
    grants: input.nextGrants,
    keyEpoch: input.nextKeyEpoch,
    members,
    prevStateHash: first.state.stateHash,
    principalId,
    principalKeyPair:
      input.nextKeyEpoch > 1 ? generateKemSeedAndKeyPair() : principalKeyPair,
    signer,
    version: 2,
  });
  return {
    mismatch: getPrincipalPolicyTransitionMismatch({
      current: second.entry,
      previous: first.entry,
    }),
    result: await verifyPrincipalPolicyBundle({
      bundle: createBundle({ current: second, previous: [first.entry] }),
      signerPublicKeys: [signer],
    }),
  };
}

test("a same-epoch policy may change a grant's level or add a container", async () => {
  for (const nextGrants of [[write], [read, other]]) {
    const { mismatch, result } = await grantTransition({
      nextGrants,
      nextKeyEpoch: 1,
      previousGrants: [read],
    });
    expect(mismatch).toBeNull();
    expect(result.ok).toBe(true);
  }
});

test("a rotated key may drop any grant", async () => {
  const { mismatch, result } = await grantTransition({
    nextGrants: [],
    nextKeyEpoch: 2,
    previousGrants: [read, other],
  });
  expect(mismatch).toBeNull();
  expect(result.ok).toBe(true);
});

test("a same-epoch policy that drops a container is refused", async () => {
  const { mismatch, result } = await grantTransition({
    nextGrants: [other],
    nextKeyEpoch: 1,
    previousGrants: [read, other],
  });
  expect(mismatch).toEqual({
    code: "grant_removal_without_key_rotation",
    message: "Principal policy grant removal requires a new key epoch",
  });
  expectVerificationError(result, "key_epoch_reuse");
});
