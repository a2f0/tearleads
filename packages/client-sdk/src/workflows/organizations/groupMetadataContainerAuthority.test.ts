import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  organizationPolicyBundleFromInitialRequest,
  policyBundleFromInitialRequest,
} from "../../../test/helpers/principalPolicyFixtures";
import { createTestTrustedUserIdentity } from "../../../test/helpers/trustedUserIdentity";
import { buildOrganizationProvisioningArtifacts } from "../registration/registerIdentity";
import { createGroupMetadataContainerVerifier } from "./groupMetadataContainerAuthority";

test("the metadata root must be committed by both reserved group grant indexes", async () => {
  const { close, execSql } = await createTestExecSql("metadata-root-authority");
  try {
    const signing = generateSigningSeedAndKeyPair();
    const identity = generateKemSeedAndKeyPair();
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
    const state =
      artifacts.organizationMetadataBootstrap.containerPlan.plan.state;
    const verify = createGroupMetadataContainerVerifier({
      apiClient: {
        getCurrentPrincipalPolicy: async (type, id) =>
          type === "organization"
            ? organization
            : id === admin.currentState.principalId
              ? admin
              : members,
      },
      execSql,
      organizationId: artifacts.organizationId,
      stillCurrent: () => true,
      resolveTrustedUserIdentity: async (userId) =>
        userId === "founder"
          ? createTestTrustedUserIdentity({
              userId,
              encapsulationPublicKey: identity.publicKey,
              signingPublicKey: signing.signingPublicKey,
              signingKeyFingerprint: await toFingerprint(
                signing.signingPublicKey,
              ),
            })
          : null,
    });
    await expect(verify(state)).resolves.toBeUndefined();
    expect(state.parentContainerId).toBeNull();
    await expect(
      verify({ ...state, containerId: "attacker-signed-root" }),
    ).rejects.toThrow("reserved group grants");
    await expect(
      verify({
        ...state,
        directGrants: [
          ...state.directGrants,
          { subjectType: "user", subjectId: "outsider", accessLevel: "read" },
        ],
      }),
    ).rejects.toThrow("reserved group grants");
    await expect(
      verify({
        ...state,
        referencedPrincipalHeads: state.referencedPrincipalHeads.map((head) =>
          head.principalId === members.currentState.principalId
            ? { ...head, stateHash: "stale-members" }
            : head,
        ),
      }),
    ).rejects.toThrow("reserved group grants");
  } finally {
    close();
  }
});
