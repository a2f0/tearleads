import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "../encapsulation/generateKeyPair";
import { computeUserIdentityBundleFingerprint } from "../userIdentityBundle";
import { normalizePrincipalPolicyStateChainEntry } from "./principalPolicyChainEntry";
import {
  capturePrincipalHistoryProgressEntry,
  normalizeAuthenticatedPrincipalHistoryEntry,
} from "./principalPolicyHistoryProgressEntry";
import {
  createPolicySigner,
  signPolicyState,
} from "./principalPolicyTestFixtures";

test("saved history preserves complete identity commitments on round-trip", async () => {
  const signer = await createPolicySigner();
  const member = {
    userId: signer.userId,
    role: "admin" as const,
    identityBundleFingerprint: await computeUserIdentityBundleFingerprint({
      identityTrustDomain: "https://api.example.test",
      userId: signer.userId,
      signingPublicKey: signer.signingPublicKey,
      encapsulationPublicKey: generateKemSeedAndKeyPair().publicKey,
    }),
  };
  const signed = await signPolicyState({
    principalId: "progress-identity",
    version: 1,
    prevStateHash: null,
    members: [{ userId: signer.userId }],
    projection: [member],
    signer,
  });
  const normalized = await normalizePrincipalPolicyStateChainEntry(
    signed.entry,
  );
  const saved = capturePrincipalHistoryProgressEntry(normalized);
  expect(saved.projection).toEqual([member]);
  const restored = await normalizeAuthenticatedPrincipalHistoryEntry(saved);
  expect(restored.projection).toEqual([member]);
});
