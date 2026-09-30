import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  KeyingVerificationError,
  toFingerprint,
} from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  organizationPolicyBundleFromInitialRequest,
  policyBundleAfterMutation,
  policyBundleFromInitialRequest,
  principalPolicyHead,
  signedPrincipalPolicyBundle,
} from "../../../test/helpers/principalPolicyFixtures";
import { createTestTrustedUserIdentity } from "../../../test/helpers/trustedUserIdentity";
import { parseOrganizationAuthorityDescriptor } from "../../data/principals/organizationAuthorityDescriptor";
import { buildOrganizationProvisioningArtifacts } from "../registration/registerIdentity";
import { createGroupMetadataContainerVerifier } from "./groupMetadataContainerAuthority";
import { MetadataRootBehindDirectoryError } from "./groupMetadataErrors";
import {
  buildOrganizationGroupDirectoryPolicyRequest,
  replaceOrganizationGroupHead,
} from "./organizationGroupDirectory";

// The metadata root and the signed directory are separate reads. A Members
// commit between them leaves the root citing the previous Members head.

async function createMembersAdvance() {
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
  const advancedMembers = await signedPrincipalPolicyBundle({
    memberEnvelopes: members.currentMemberEnvelopes.envelopes,
    payloadCiphertext: members.currentPayload.ciphertext,
    projection: members.currentProjection,
    previousStates: [
      {
        state: members.currentState,
        projection: members.currentProjection,
        grants: members.currentGrants,
      },
    ],
    signing: {
      ...members.currentState,
      grants: members.currentGrants,
      prevStateHash: members.currentState.stateHash,
      signedAt: new Date().toISOString(),
      version: members.currentState.version + 1,
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
        nextHead: principalPolicyHead(advancedMembers),
      }),
      signerUserId: "founder",
      signingFingerprint,
      signingKeyPair: signing,
    }),
  });
  const verifier = (
    execSql: Awaited<ReturnType<typeof createTestExecSql>>["execSql"],
  ) =>
    createGroupMetadataContainerVerifier({
      apiClient: {
        getCurrentPrincipalPolicy: async (type, id) =>
          type === "organization"
            ? advancedDirectory
            : id === admin.currentState.principalId
              ? admin
              : advancedMembers,
      },
      execSql,
      organizationId: artifacts.organizationId,
      stillCurrent: () => true,
      resolveTrustedUserIdentity: async (userId) =>
        userId === "founder" ? founder : null,
    });
  return {
    members,
    state: artifacts.organizationMetadataBootstrap.containerPlan.plan.state,
    verifier,
  };
}

test("a root read before a Members commit is a stale read, not tampering", async () => {
  const { close, execSql } = await createTestExecSql("metadata-root-behind");
  try {
    const { state, verifier } = await createMembersAdvance();
    const behind = verifier(execSql)(state);

    await expect(behind).rejects.toBeInstanceOf(
      MetadataRootBehindDirectoryError,
    );
    await expect(behind).rejects.not.toBeInstanceOf(KeyingVerificationError);
  } finally {
    close();
  }
});

test("a root citing a head outside the directory's chain is still tampering", async () => {
  const { close, execSql } = await createTestExecSql("metadata-root-forged");
  try {
    const { members, state, verifier } = await createMembersAdvance();
    const forged = verifier(execSql)({
      ...state,
      referencedPrincipalHeads: state.referencedPrincipalHeads.map((head) =>
        head.principalId === members.currentState.principalId
          ? { ...head, stateHash: "never-committed" }
          : head,
      ),
    });

    await expect(forged).rejects.toBeInstanceOf(KeyingVerificationError);
    await expect(forged).rejects.toThrow("reserved group grants");
  } finally {
    close();
  }
});
