import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "../encapsulation/generateKeyPair";
import { computeUserIdentityBundleFingerprint } from "../userIdentityBundle";
import { verifyPrincipalPolicyBundle } from "./principalPolicy";
import {
  createBundle,
  createPolicySigner,
  signPolicyState,
} from "./principalPolicyTestFixtures";

for (const substitutedKey of [
  "signingPublicKey",
  "encapsulationPublicKey",
] as const) {
  test(`principal history rejects a continuing member's changed ${substitutedKey}`, async () => {
    const signer = await createPolicySigner();
    const identity = {
      identityTrustDomain: "https://api.example.test",
      userId: signer.userId,
      signingPublicKey: signer.signingPublicKey,
      encapsulationPublicKey: generateKemSeedAndKeyPair().publicKey,
    };
    const member = {
      userId: signer.userId,
      role: "admin" as const,
      identityBundleFingerprint:
        await computeUserIdentityBundleFingerprint(identity),
    };
    const projection = [member];
    const principalKeyPair = generateKemSeedAndKeyPair();
    const common = {
      principalId: "identity-continuity",
      principalKeyPair,
      members: [{ userId: signer.userId }],
      projection,
      signer,
    };
    const first = await signPolicyState({
      ...common,
      version: 1,
      prevStateHash: null,
    });
    const changedKey = new Uint8Array(identity[substitutedKey]);
    changedKey[0] = (changedKey[0] ?? 0) ^ 1;
    const replacement = {
      ...identity,
      [substitutedKey]: changedKey,
    };
    const second = await signPolicyState({
      ...common,
      version: 2,
      prevStateHash: first.state.stateHash,
      projection: [
        {
          ...member,
          identityBundleFingerprint:
            await computeUserIdentityBundleFingerprint(replacement),
        },
      ],
    });
    // Both roots and signatures are valid. Only identity continuity rejects
    // the replacement, rather than an earlier signature or fixture failure.
    const result = await verifyPrincipalPolicyBundle({
      bundle: createBundle({ current: second, previous: [first.entry] }),
      signerPublicKeys: [signer],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("hash_mismatch");
      expect(result.error.message).toContain("continuing member");
    }
  });
}
