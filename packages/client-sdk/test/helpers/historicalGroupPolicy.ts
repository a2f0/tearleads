import {
  generateKemSeedAndKeyPair,
  makeVerifiedPrincipalPolicy,
  toFingerprint,
  verifyPrincipalPolicySnapshot,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { buildInitialOrganizationPolicyRequest } from "../../src/workflows/registration/registerIdentity";
import type { Signer } from "./ancestorCitationScenario";
import { policySnapshot } from "./organizationPolicyHistory";
import {
  organizationPolicyBundleFromInitialRequest,
  principalPolicyHead,
  signedPrincipalPolicyBundle,
} from "./principalPolicyFixtures";

/** Real signed group history, including a former administrator. */
export async function historicalGroupPolicy(input: {
  readonly former: Signer;
  readonly remaining: Signer;
  readonly organizationId: string;
}) {
  const fingerprint = await toFingerprint(
    input.remaining.keyPair.signingPublicKey,
  );
  const key = generateKemSeedAndKeyPair();
  const first = await signedPrincipalPolicyBundle({
    memberEnvelopes: [],
    payloadCiphertext: "public-test-policy",
    projection: [
      { userId: input.remaining.userId, role: "admin" },
      { userId: input.former.userId, role: "admin" },
    ],
    signing: {
      principalType: "group",
      principalId: "historical-admins",
      version: 1,
      prevStateHash: null,
      keyEpoch: 1,
      externalAuthority: null,
      encapsulationPublicKey: bytesToBase64(key.publicKey),
      keyFingerprint: await toFingerprint(key.publicKey),
      signedAt: "2026-04-27T00:00:00.000Z",
      signerUserId: input.remaining.userId,
      signerUserKeyFingerprint: fingerprint,
    },
    signingPrivateKey: input.remaining.keyPair.signingPrivateKey,
  });
  const nextKey = generateKemSeedAndKeyPair();
  const current = await signedPrincipalPolicyBundle({
    memberEnvelopes: [],
    payloadCiphertext: first.currentPayload.ciphertext,
    projection: [{ userId: input.remaining.userId, role: "admin" }],
    previousStates: [
      {
        state: first.currentState,
        projection: first.currentProjection,
        grants: [],
      },
    ],
    signing: {
      ...first.currentState,
      version: 2,
      keyEpoch: 2,
      prevStateHash: first.currentState.stateHash,
      encapsulationPublicKey: bytesToBase64(nextKey.publicKey),
      keyFingerprint: await toFingerprint(nextKey.publicKey),
      signedAt: "2026-04-28T00:00:00.000Z",
    },
    signingPrivateKey: input.remaining.keyPair.signingPrivateKey,
  });
  const firstHead = {
    ...principalPolicyHead(first),
    principalType: "group" as const,
  };
  const currentHead = {
    ...principalPolicyHead(current),
    principalType: "group" as const,
  };
  const verified = await verifyPrincipalPolicySnapshot({
    snapshot: policySnapshot(current),
    expectedReference: currentHead,
    signerPublicKeys: [
      {
        userId: input.remaining.userId,
        signingKeyFingerprint: fingerprint,
        signingPublicKey: input.remaining.keyPair.signingPublicKey,
      },
    ],
  });
  if (!verified.ok) throw verified.error;
  // The fixture only consumes this as public authorization policy; key unwraps
  // are not part of the historical-signer scenario.
  const policy = makeVerifiedPrincipalPolicy(verified.value);
  const organization = await organizationPolicyBundleFromInitialRequest(
    input.organizationId,
    await buildInitialOrganizationPolicyRequest({
      adminGroupId: currentHead.principalId,
      memberGroupId: "historical-members",
      groupHeads: [
        currentHead,
        { ...firstHead, principalId: "historical-members" },
      ],
      organizationId: input.organizationId,
      signingKeyPair: input.remaining.keyPair,
      userId: input.remaining.userId,
      encapsulationPublicKey: key.publicKey,
    }),
  );
  return {
    currentHead,
    firstHead,
    policy,
    policyEvidence: {
      organization: policySnapshot(organization),
      organizationPayloads: [organization.currentPayload],
      groups: [policySnapshot(current)],
    },
  };
}
