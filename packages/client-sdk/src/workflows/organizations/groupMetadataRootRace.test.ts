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

// The metadata root and the signed directory are separate reads. A reserved-
// group commit between them leaves the root citing that group's previous head.

async function createReservedGroupAdvance(advancing: "Admins" | "Members") {
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
  const verifier = (
    execSql: Awaited<ReturnType<typeof createTestExecSql>>["execSql"],
  ) =>
    createGroupMetadataContainerVerifier({
      apiClient: {
        getCurrentPrincipalPolicy: async (type, id) =>
          type === "organization"
            ? advancedDirectory
            : id === previous.currentState.principalId
              ? advanced
              : id === admin.currentState.principalId
                ? admin
                : members,
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

test.each(["Admins", "Members"] as const)(
  "a root read before an %s commit is a stale read, not tampering",
  async (advancing) => {
    const { close, execSql } = await createTestExecSql(
      `metadata-root-behind-${advancing}`,
    );
    try {
      const { state, verifier } = await createReservedGroupAdvance(advancing);
      const behind = verifier(execSql)(state);

      await expect(behind).rejects.toBeInstanceOf(
        MetadataRootBehindDirectoryError,
      );
      await expect(behind).rejects.not.toBeInstanceOf(KeyingVerificationError);
    } finally {
      close();
    }
  },
);

test("a root citing a head outside the directory's chain is still tampering", async () => {
  const { close, execSql } = await createTestExecSql("metadata-root-forged");
  try {
    const { members, state, verifier } =
      await createReservedGroupAdvance("Members");
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
