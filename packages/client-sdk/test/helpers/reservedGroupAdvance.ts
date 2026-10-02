import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import type { createTestExecSql } from "@tearleads/test-utils";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { parseOrganizationAuthorityDescriptor } from "../../src/data/principals/organizationAuthorityDescriptor";
import { createGroupMetadataContainerVerifier } from "../../src/workflows/organizations/groupMetadataContainerAuthority";
import {
  buildOrganizationGroupDirectoryPolicyRequest,
  replaceOrganizationGroupHead,
} from "../../src/workflows/organizations/organizationGroupDirectory";
import { buildOrganizationProvisioningArtifacts } from "../../src/workflows/registration/registerIdentity";
import {
  organizationPolicyBundleFromInitialRequest,
  policyBundleAfterMutation,
  policyBundleFromInitialRequest,
  principalPolicyHead,
  signedPrincipalPolicyBundle,
} from "./principalPolicyFixtures";
import { createTestTrustedUserIdentity } from "./trustedUserIdentity";

/**
 * A provisioned organization whose signed directory has advanced one reserved
 * group past the head its metadata root cites: the metadata root and the
 * directory are separate reads, and a reserved-group commit between them
 * leaves the root citing that group's previous head.
 */
export async function createReservedGroupAdvance(
  advancing: "Admins" | "Members",
) {
  const signing = generateSigningSeedAndKeyPair();
  const identity = generateKemSeedAndKeyPair();
  const signingFingerprint = await toFingerprint(signing.signingPublicKey);
  const founder = createTestTrustedUserIdentity({
    userId: "founder",
    encapsulationPublicKey: identity.publicKey,
    signingPublicKey: signing.signingPublicKey,
    signingKeyFingerprint: signingFingerprint,
  });
  const artifacts = await buildOrganizationProvisioningArtifacts({
    encapsulationKeyPair: identity,
    signingKeyPair: signing,
    userId: "founder",
    rootContainerId: "personal-root",
  });
  const admin = await policyBundleFromInitialRequest(
    artifacts.initialAdminGroup,
  );
  const members = await policyBundleFromInitialRequest(
    artifacts.initialMemberGroup,
  );
  const organization = await organizationPolicyBundleFromInitialRequest(
    artifacts.organizationId,
    artifacts.initialOrganizationPolicy,
  );
  const previous = advancing === "Admins" ? admin : members;
  const advanced = await signedPrincipalPolicyBundle({
    memberEnvelopes: previous.currentMemberEnvelopes.envelopes,
    payloadCiphertext: previous.currentPayload.ciphertext,
    projection: previous.currentProjection,
    previousStates: [
      {
        state: previous.currentState,
        projection: previous.currentProjection,
        grants: previous.currentGrants,
      },
    ],
    signing: {
      ...previous.currentState,
      grants: previous.currentGrants,
      prevStateHash: previous.currentState.stateHash,
      signedAt: new Date().toISOString(),
      version: previous.currentState.version + 1,
    },
    signingPrivateKey: signing.signingPrivateKey,
  });
  const descriptor = parseOrganizationAuthorityDescriptor(
    organization.currentPayload.ciphertext,
  );
  const advancedDirectory = await policyBundleAfterMutation({
    previous: organization,
    mutation: await buildOrganizationGroupDirectoryPolicyRequest({
      adminProjection: admin.currentProjection,
      adminUsers: [founder],
      currentPolicy: organization,
      descriptor,
      groupHeads: replaceOrganizationGroupHead({
        descriptor,
        nextHead: principalPolicyHead(advanced),
      }),
      signerUserId: "founder",
      signingFingerprint,
      signingKeyPair: signing,
    }),
  });
  /** The directory and reserved groups as the server now serves them. */
  const currentPolicy = async (
    type: "group" | "organization",
    id: string,
  ): Promise<PrincipalPolicyBundleResponse> =>
    type === "organization"
      ? advancedDirectory
      : id === previous.currentState.principalId
        ? advanced
        : id === admin.currentState.principalId
          ? admin
          : members;
  const resolveTrustedUserIdentity = async (userId: string) =>
    userId === "founder" ? founder : null;
  const verifier = (
    execSql: Awaited<ReturnType<typeof createTestExecSql>>["execSql"],
  ) =>
    createGroupMetadataContainerVerifier({
      apiClient: { getCurrentPrincipalPolicy: currentPolicy },
      execSql,
      organizationId: artifacts.organizationId,
      stillCurrent: () => true,
      resolveTrustedUserIdentity,
    });
  return {
    admin,
    advanced,
    advancedDirectory,
    artifacts,
    currentPolicy,
    members,
    resolveTrustedUserIdentity,
    state: artifacts.organizationMetadataBootstrap.containerPlan.plan.state,
    verifier,
  };
}
