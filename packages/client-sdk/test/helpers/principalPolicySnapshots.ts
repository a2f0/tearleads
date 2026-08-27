import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@symcrypt/crypto";
import type {
  PrincipalPolicyBundleResponse,
  PrincipalPolicySnapshotResponse,
} from "@symcrypt/validators/response";
import { buildInitialGroupPolicyRequest } from "../../src/workflows/organizations/principalPolicy";
import {
  policyBundleFromInitialRequest,
  principalPolicyHead,
} from "./principalPolicyFixtures";
import { createTestTrustedUserIdentity } from "./trustedUserIdentity";

function snapshotFromBundle(
  bundle: PrincipalPolicyBundleResponse,
): PrincipalPolicySnapshotResponse {
  return {
    currentGrants: bundle.currentGrants,
    currentProjection: bundle.currentProjection,
    currentState: bundle.currentState,
    previousStates: bundle.previousStates,
  };
}

export async function createExternallyAuthorizedPrincipalPolicySnapshots() {
  const signerUserId = crypto.randomUUID();
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const signingFingerprint = await toFingerprint(
    signingKeyPair.signingPublicKey,
  );
  const adminRequest = await buildInitialGroupPolicyRequest({
    creatorEncapsulationKeyPair: encapsulationKeyPair,
    groupId: crypto.randomUUID(),
    name: "Admins",
    signerUserId,
    signingFingerprint,
    signingKeyPair,
  });
  const adminBundle = await policyBundleFromInitialRequest(adminRequest);
  const adminHead = principalPolicyHead(adminBundle);
  if (adminHead.principalType !== "group") {
    throw new Error("Expected group authority fixture");
  }
  const subjectRequest = await buildInitialGroupPolicyRequest({
    creatorEncapsulationKeyPair: encapsulationKeyPair,
    externalAuthority: { ...adminHead, principalType: "group" },
    groupId: crypto.randomUUID(),
    includeSignerAsAdmin: false,
    name: "Operators",
    signerUserId,
    signingFingerprint,
    signingKeyPair,
  });
  const subjectBundle = await policyBundleFromInitialRequest(subjectRequest);
  const identity = createTestTrustedUserIdentity({
    encapsulationKeyFingerprint: await toFingerprint(
      encapsulationKeyPair.publicKey,
    ),
    encapsulationPublicKey: encapsulationKeyPair.publicKey,
    signingKeyFingerprint: signingFingerprint,
    signingPublicKey: signingKeyPair.signingPublicKey,
    userId: signerUserId,
  });
  return {
    admin: snapshotFromBundle(adminBundle),
    resolveUserKey: async (userId: string) =>
      userId === signerUserId ? identity : null,
    subject: snapshotFromBundle(subjectBundle),
  };
}
