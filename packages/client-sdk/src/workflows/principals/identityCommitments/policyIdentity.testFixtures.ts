import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import { principalPolicyBundleFromInitialPolicy } from "../../../../test/helpers/policyCacheFixtures";
import { createTestTrustedUserIdentity } from "../../../../test/helpers/trustedUserIdentity";
import { buildInitialGroupPolicyRequest } from "../../organizations/principalPolicy/principalPolicyRequest";

export async function identityPolicyFixture() {
  const signing = generateSigningSeedAndKeyPair();
  const kem = generateKemSeedAndKeyPair();
  const identity = createTestTrustedUserIdentity({
    userId: crypto.randomUUID(),
    signingPublicKey: signing.signingPublicKey,
    signingKeyFingerprint: await toFingerprint(signing.signingPublicKey),
    encapsulationPublicKey: kem.publicKey,
    encapsulationKeyFingerprint: await toFingerprint(kem.publicKey),
  });
  const request = await buildInitialGroupPolicyRequest({
    identityTrustDomain: identity.identityTrustDomain,
    creatorEncapsulationKeyPair: kem,
    signerUserId: identity.userId,
    signingKeyPair: signing,
    signingFingerprint: identity.signingKeyFingerprint,
    groupId: crypto.randomUUID(),
    name: "Members",
    builtinRole: "members",
  });
  const bundle = await principalPolicyBundleFromInitialPolicy({
    principalId: request.groupId,
    policy: request.initialGroupPolicy,
  });
  return { bundle, identity };
}
