import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import type {
  PrincipalPolicyBundleResponse,
  PrincipalPolicySnapshotResponse,
} from "@tearleads/validators/response";
import { parseOrganizationAuthorityDescriptor } from "../../src/data/principals/organizationAuthorityDescriptor";
import {
  buildOrganizationGroupDirectoryPolicyRequest,
  replaceOrganizationGroupHead,
} from "../../src/workflows/organizations/organizationGroupDirectory";
import { buildInitialOrganizationPolicyRequest } from "../../src/workflows/registration/registerIdentity";
import { buildInitialGroupPolicyRequest } from "./groupMetadata";
import {
  organizationPolicyBundleFromInitialRequest,
  policyBundleAfterMutation,
  policyBundleFromInitialRequest,
  principalPolicyHead,
  signedPrincipalPolicyBundle,
} from "./principalPolicyFixtures";
import { createTestTrustedUserIdentity } from "./trustedUserIdentity";

export function policySnapshot(
  bundle: PrincipalPolicyBundleResponse,
): PrincipalPolicySnapshotResponse {
  return {
    currentState: bundle.currentState,
    currentProjection: bundle.currentProjection,
    currentGrants: bundle.currentGrants,
    previousStates: bundle.previousStates,
  };
}

export async function createOrganizationHistoryFixture() {
  const organizationId = crypto.randomUUID();
  const signerUserId = crypto.randomUUID();
  const targetUserId = crypto.randomUUID();
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const creatorEncapsulationKeyPair = generateKemSeedAndKeyPair();
  const signingFingerprint = await toFingerprint(
    signingKeyPair.signingPublicKey,
  );
  const signer = { signerUserId, signingFingerprint, signingKeyPair };
  const signerIdentity = createTestTrustedUserIdentity({
    userId: signerUserId,
    signingPublicKey: signingKeyPair.signingPublicKey,
    signingKeyFingerprint: signingFingerprint,
    encapsulationPublicKey: creatorEncapsulationKeyPair.publicKey,
  });
  const group = async (
    name: string,
    includeSignerAsAdmin = true,
  ): Promise<PrincipalPolicyBundleResponse> =>
    policyBundleFromInitialRequest(
      await buildInitialGroupPolicyRequest({
        ...signer,
        creatorEncapsulationKeyPair,
        groupId: crypto.randomUUID(),
        name,
        includeSignerAsAdmin,
        ...(includeSignerAsAdmin
          ? {}
          : {
              externalAuthority: principalPolicyHead(admin) as {
                principalType: "group";
              } & ReturnType<typeof principalPolicyHead>,
            }),
      }),
    );
  const admin = await group("Admins");
  const members = await group("Members");
  const created = await group("Private support name", false);
  const initial = await organizationPolicyBundleFromInitialRequest(
    organizationId,
    await buildInitialOrganizationPolicyRequest({
      adminGroupId: admin.currentState.principalId,
      memberGroupId: members.currentState.principalId,
      groupHeads: [principalPolicyHead(admin), principalPolicyHead(members)],
      organizationId,
      signingKeyPair,
      userId: signerUserId,
      encapsulationPublicKey: creatorEncapsulationKeyPair.publicKey,
    }),
  );
  const advanceDirectory = async (
    previous: PrincipalPolicyBundleResponse,
    next: PrincipalPolicyBundleResponse | null,
  ) => {
    const descriptor = parseOrganizationAuthorityDescriptor(
      previous.currentPayload.ciphertext,
    );
    return policyBundleAfterMutation({
      previous,
      mutation: await buildOrganizationGroupDirectoryPolicyRequest({
        ...signer,
        adminProjection: admin.currentProjection,
        adminUsers: [signerIdentity],
        currentPolicy: previous,
        descriptor,
        groupHeads: next
          ? replaceOrganizationGroupHead({
              descriptor,
              nextHead: principalPolicyHead(next),
            })
          : descriptor.groupHeads.filter(
              (head) => head.principalId !== created.currentState.principalId,
            ),
      }),
    });
  };
  const afterCreation = await advanceDirectory(initial, created);
  const added = await signedPrincipalPolicyBundle({
    memberEnvelopes: [],
    payloadCiphertext: created.currentPayload.ciphertext,
    projection: [{ userId: targetUserId, role: "member" }],
    previousStates: [
      {
        state: created.currentState,
        projection: created.currentProjection,
        grants: created.currentGrants,
      },
    ],
    signing: {
      ...created.currentState,
      version: 2,
      prevStateHash: created.currentState.stateHash,
      signedAt: new Date().toISOString(),
    },
    signingPrivateKey: signingKeyPair.signingPrivateKey,
  });
  const afterAddition = await advanceDirectory(afterCreation, added);
  const afterDeletion = await advanceDirectory(afterAddition, null);
  const resolveTrustedUserIdentity = async (userId: string) =>
    userId === signerUserId ? signerIdentity : null;
  const evidence = (deleted = false) => ({
    organizationId,
    stateHash: (deleted ? afterDeletion : afterAddition).currentState.stateHash,
    organizationPayloads: [
      initial,
      afterCreation,
      afterAddition,
      ...(deleted ? [afterDeletion] : []),
    ].map((bundle) => bundle.currentPayload),
    groups: [admin, members, added].map(policySnapshot),
  });
  return {
    organizationId,
    signerUserId,
    targetUserId,
    created,
    added,
    initial,
    afterCreation,
    afterAddition,
    afterDeletion,
    evidence,
    resolveTrustedUserIdentity,
  };
}
