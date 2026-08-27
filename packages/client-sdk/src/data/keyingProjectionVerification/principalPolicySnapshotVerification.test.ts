import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@symcrypt/crypto";
import type {
  PrincipalPolicyBundleResponse,
  PrincipalPolicySnapshotResponse,
} from "@symcrypt/validators/response";
import {
  policyBundleFromInitialRequest,
  principalPolicyHead,
} from "../../../test/helpers/principalPolicyFixtures";
import { buildInitialGroupPolicyRequest } from "../../workflows/organizations/principalPolicy";
import { createTestTrustedUserIdentity } from "../trustedUserIdentity/testFixtures";
import { verifyPrincipalPolicySnapshots } from "./principalPolicySnapshotVerification";

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

async function createExternallyAuthorizedSnapshots() {
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

test("verifies a redacted policy through its signed external authority", async () => {
  const fixture = await createExternallyAuthorizedSnapshots();
  const verified = await verifyPrincipalPolicySnapshots({
    resolveUserKey: fixture.resolveUserKey,
    snapshots: [fixture.subject, fixture.admin],
  });
  expect(verified).toHaveLength(2);

  await expect(
    verifyPrincipalPolicySnapshots({
      resolveUserKey: fixture.resolveUserKey,
      snapshots: [fixture.subject],
    }),
  ).rejects.toThrow("Principal policy snapshot authority is missing");
});

test("rejects a tampered redacted policy projection", async () => {
  const fixture = await createExternallyAuthorizedSnapshots();
  await expect(
    verifyPrincipalPolicySnapshots({
      resolveUserKey: fixture.resolveUserKey,
      snapshots: [{ ...fixture.admin, currentProjection: [] }],
    }),
  ).rejects.toThrow("projection root does not match");
});
