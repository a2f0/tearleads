import { expect } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import {
  buildRootContainerCreatePlan,
  rootContainerWriterProjectionFromCreatePlan,
} from "../../src/workflows/containers/root/create";
import { buildInitialOrganizationPolicyRequest } from "../../src/workflows/registration/registerIdentity";
import { createAuthor, SIGNED_AT } from "./containerFixtures";
import { buildInitialGroupPolicyRequest } from "./groupMetadata";
import { createSuccessorGroupPolicyBundle } from "./groupPolicyFixtures";
import {
  organizationPolicyBundleFromInitialRequest,
  policyBundleFromInitialRequest,
  principalPolicyHead,
} from "./principalPolicyFixtures";
import {
  projectionDirectoryPayload,
  projectionPolicySource,
} from "./projectionPolicyHistory";
import { createTestTrustedUserIdentityResolver } from "./trustedUserIdentity";

export const ADMIN_GROUP_ID = "admins-group";
export const ORGANIZATION_ID = "organization-1";
export const ROOT_CONTAINER_ID = "root-container";
const USER_ID = "remaining-admin";
export async function setUpAdminGroupRoot() {
  const { author, signingPublicKey } = await createAuthor({
    organizationId: ORGANIZATION_ID,
    userId: USER_ID,
  });
  const memberKem = generateKemSeedAndKeyPair();
  const initialAdminGroup = await buildInitialGroupPolicyRequest({
    creatorEncapsulationKeyPair: memberKem,
    grants: [{ accessLevel: "admin", containerId: ROOT_CONTAINER_ID }],
    groupId: ADMIN_GROUP_ID,
    name: "Admins",
    signerUserId: USER_ID,
    signingFingerprint: author.signerKeyFingerprint,
    signingKeyPair: {
      signingPrivateKey: author.signerPrivateKey,
      signingPublicKey,
    },
  });
  const epochOnePolicy =
    await policyBundleFromInitialRequest(initialAdminGroup);
  const epochTwoPolicy = await createSuccessorGroupPolicyBundle({
    author,
    groupId: ADMIN_GROUP_ID,
    groupKem: generateKemSeedAndKeyPair(),
    memberPublicKey: memberKem.publicKey,
    previousBundle: epochOnePolicy,
    signedAt: new Date(
      Date.parse(epochOnePolicy.currentState.signedAt) + 1_000,
    ).toISOString(),
    userId: USER_ID,
  });
  const initialMembersGroup = await buildInitialGroupPolicyRequest({
    creatorEncapsulationKeyPair: memberKem,
    groupId: "members-group",
    name: "Members",
    signerUserId: USER_ID,
    signingFingerprint: author.signerKeyFingerprint,
    signingKeyPair: {
      signingPrivateKey: author.signerPrivateKey,
      signingPublicKey,
    },
  });
  const membersPolicy =
    await policyBundleFromInitialRequest(initialMembersGroup);
  const initialOrganizationPolicy = await buildInitialOrganizationPolicyRequest(
    {
      adminGroupId: ADMIN_GROUP_ID,
      encapsulationPublicKey: memberKem.publicKey,
      groupHeads: [
        principalPolicyHead(epochTwoPolicy),
        principalPolicyHead(membersPolicy),
      ],
      memberGroupId: "members-group",
      organizationId: ORGANIZATION_ID,
      signingKeyPair: {
        signingPrivateKey: author.signerPrivateKey,
        signingPublicKey,
      },
      userId: USER_ID,
    },
  );
  const organizationPolicy = await organizationPolicyBundleFromInitialRequest(
    ORGANIZATION_ID,
    initialOrganizationPolicy,
  );
  const containerKey = crypto.getRandomValues(new Uint8Array(32));
  const root = await buildRootContainerCreatePlan({
    adminGroup: initialAdminGroup,
    author,
    containerId: ROOT_CONTAINER_ID,
    containerKey,
    metadataDocumentId: "root-metadata-document",
    recipientEncapsulationPublicKey: memberKem.publicKey,
    signedAt: SIGNED_AT,
  });
  expect(
    Reflect.get(root.plan.request.principalPolicies[0] ?? {}, "grants"),
  ).toEqual(initialAdminGroup.initialGroupPolicy.grants);
  const initialProjection = rootContainerWriterProjectionFromCreatePlan(
    root.plan,
  );
  initialProjection.policyEvidence = {
    organization: projectionPolicySource(organizationPolicy),
    organizationPayloads: [projectionDirectoryPayload(organizationPolicy)],
    groups: [projectionPolicySource(epochTwoPolicy)],
  };
  const resolveUserIdentity = createTestTrustedUserIdentityResolver({
    encapsulationPublicKey: memberKem.publicKey,
    signingKeyFingerprint: author.signerKeyFingerprint,
    signingPublicKey,
    userId: USER_ID,
  });

  return {
    author,
    containerKey,
    epochOnePolicy,
    epochTwoPolicy,
    initialProjection,
    memberKem,
    organizationPolicy,
    resolveUserIdentity,
    projectionBundles: [organizationPolicy, epochTwoPolicy],
  };
}
