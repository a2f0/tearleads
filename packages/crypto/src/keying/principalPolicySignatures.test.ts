import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "../encapsulation/generateKeyPair";
import {
  verifyPrincipalPolicyBundle,
  verifyPrincipalPolicySnapshot,
} from "./index";
import {
  clearPrincipalPolicySignatureCaches,
  createBundle,
  createPolicySigner,
  expectVerificationError,
  signPolicyState,
} from "./principalPolicyTestFixtures";
import type {
  PrincipalPolicyBundle,
  PrincipalPolicySignerPublicKey,
} from "./types";

const verifiers = [
  {
    name: "bundle",
    verify: (
      bundle: PrincipalPolicyBundle,
      signer: PrincipalPolicySignerPublicKey,
    ) => verifyPrincipalPolicyBundle({ bundle, signerPublicKeys: [signer] }),
  },
  {
    name: "snapshot",
    verify: (
      snapshot: PrincipalPolicyBundle,
      signer: PrincipalPolicySignerPublicKey,
    ) =>
      verifyPrincipalPolicySnapshot({ snapshot, signerPublicKeys: [signer] }),
  },
];

for (const { name, verify } of verifiers) {
  for (const forgedPosition of ["middle", "append"] as const) {
    test(`${name} rejects a forged ${forgedPosition} signature after warming a valid history`, async () => {
      clearPrincipalPolicySignatureCaches();
      const signer = await createPolicySigner();
      const shared = {
        principalId: `group-${name}-${forgedPosition}`,
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
      const full = createBundle({
        current: third,
        previous: [first.entry, second.entry],
      });
      const prefix = createBundle({ current: second, previous: [first.entry] });
      expect(
        (await verify(forgedPosition === "middle" ? full : prefix, signer)).ok,
      ).toBe(true);

      // State hashes exclude signatures: replacing only these bytes leaves all
      // links, commitments, signer authority and payload fields valid.
      const forged =
        forgedPosition === "middle"
          ? {
              ...full,
              previousStates: [
                first.entry,
                {
                  ...second.entry,
                  state: { ...second.state, signature: first.state.signature },
                },
              ],
            }
          : {
              ...full,
              currentState: {
                ...third.state,
                signature: first.state.signature,
              },
            };
      expectVerificationError<unknown>(
        await verify(forged, signer),
        "signature_mismatch",
      );
      expect((await verify(full, signer)).ok).toBe(true);
    });
  }
}
