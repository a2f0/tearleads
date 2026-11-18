import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import { buildAddGroupUserPolicyRequest } from "../../../src/workflows/organizations/groupPolicy/groupPolicyRequests";
import {
  buildInitialGroupPolicyRequest,
  testGroupMetadataKey,
} from "../data/groupMetadata";
import { policyBundleFromInitialRequest } from "../data/principalPolicyFixtures";
import { createFixtureUserIdentity } from "../data/trustedUserIdentity";

/** A group and its successor adding one member in the same key epoch. */
export async function sameEpochAdd() {
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const creatorKem = generateKemSeedAndKeyPair();
  const signerUserId = crypto.randomUUID();
  const organizationId = crypto.randomUUID();
  const groupId = crypto.randomUUID();
  const signingFingerprint = await toFingerprint(
    signingKeyPair.signingPublicKey,
  );
  const predecessor = await policyBundleFromInitialRequest(
    await buildInitialGroupPolicyRequest({
      identityTrustDomain: "https://api.example.test",
      metadataKey: testGroupMetadataKey(organizationId),
      creatorEncapsulationKeyPair: creatorKem,
      groupId,
      name: "Operators",
      signerUserId,
      signingFingerprint,
      signingKeyPair,
    }),
  );
  const { identity: added } = await createFixtureUserIdentity({
    userId: crypto.randomUUID(),
  });
  const successor = await buildAddGroupUserPolicyRequest({
    currentPolicy: predecessor,
    currentPolicySignerPublicKeys: [
      {
        userId: signerUserId,
        signingKeyFingerprint: signingFingerprint,
        signingPublicKey: signingKeyPair.signingPublicKey,
      },
    ],
    currentUsers: [],
    currentUserSecretKey: creatorKem.secretKey,
    localPolicyCheckpoint: null,
    signerUserId,
    signingFingerprint,
    signingKeyPair,
    targetUser: added,
  });
  return { added, organizationId, predecessor, successor };
}
