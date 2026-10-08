import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import { buildInitialOrganizationPolicyRequest } from "../../src/workflows/registration/registerIdentity";
import { buildInitialGroupPolicyRequest } from "./groupMetadata";
import {
  organizationPolicyBundleFromInitialRequest,
  policyBundleFromInitialRequest,
  principalPolicyHead,
} from "./principalPolicyFixtures";

export async function principalMutationJournalFixture() {
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const kem = generateKemSeedAndKeyPair();
  const scope = {
    identityTrustDomain: "https://journal.example.test",
    organizationId: crypto.randomUUID(),
    userId: crypto.randomUUID(),
    signingFingerprint: await toFingerprint(signingKeyPair.signingPublicKey),
  };
  const group = await buildInitialGroupPolicyRequest({
    creatorEncapsulationKeyPair: kem,
    groupId: crypto.randomUUID(),
    name: "Journal fixture",
    signerUserId: scope.userId,
    signingFingerprint: scope.signingFingerprint,
    signingKeyPair,
  });
  const head = principalPolicyHead(await policyBundleFromInitialRequest(group));
  const memberGroupId = crypto.randomUUID();
  const organizationPolicy = await buildInitialOrganizationPolicyRequest({
    adminGroupId: group.groupId,
    memberGroupId,
    organizationId: scope.organizationId,
    groupHeads: [head, { ...head, principalId: memberGroupId }],
    encapsulationPublicKey: kem.publicKey,
    signingKeyPair,
    userId: scope.userId,
  });
  const mutation = {
    kind: "compound" as const,
    groupId: group.groupId,
    request: { groupPolicy: group.initialGroupPolicy, organizationPolicy },
  };
  const groupBundle = await policyBundleFromInitialRequest(group);
  const organizationBundle = await organizationPolicyBundleFromInitialRequest(
    scope.organizationId,
    organizationPolicy,
  );
  const response = {
    groupPolicy: { ...groupBundle, containerMutations: [] },
    organizationPolicy: { ...organizationBundle, containerMutations: [] },
  };
  return { scope, mutation, signingKeyPair, response };
}
