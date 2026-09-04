import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import {
  createParentProjection,
  createParentProjectionUserKeyResolver,
  SIGNED_AT,
} from "../../../../test/helpers/containerFixtures";
import {
  organizationPolicyBundleFromInitialRequest,
  policyBundleFromInitialRequest,
  principalPolicyHead,
} from "../../../../test/helpers/principalPolicyFixtures";
import { createTestTrustedUserIdentity } from "../../../../test/helpers/trustedUserIdentity";
import { withTestExecSql } from "../../../../test/helpers/withTestExecSql";
import { buildInitialGroupPolicyRequest } from "../../organizations/principalPolicy";
import { buildInitialOrganizationPolicyRequest } from "../../registration/registerIdentity";
import { shareRemoteContainerWithGroup } from "./share";

// Only a re-wrap of an existing signed grant may run without the chosen group
// name. A share that would mint a grant is the operation the name binding
// protects, so reaching the mint with `expectedGroupName: null` must fail
// closed before any policy mutation is committed.
test("minting a group grant without the chosen name fails closed", async () => {
  const parent = await createParentProjection();
  const author = parent.author;
  const groupSigningKeyPair = {
    signingPrivateKey: author.signerPrivateKey,
    signingPublicKey: parent.signingPublicKey,
  };
  const groupId = "group-1";
  const groupPolicy = await policyBundleFromInitialRequest(
    await buildInitialGroupPolicyRequest({
      creatorEncapsulationKeyPair: generateKemSeedAndKeyPair(),
      groupId,
      name: "Admins",
      signerUserId: author.signerUserId,
      signingFingerprint: author.signerKeyFingerprint,
      signingKeyPair: groupSigningKeyPair,
    }),
  );
  const organizationPolicy = await organizationPolicyBundleFromInitialRequest(
    parent.projection.organizationId,
    await buildInitialOrganizationPolicyRequest({
      adminGroupId: groupId,
      encapsulationPublicKey: parent.encapsulationPublicKey,
      groupHeads: [
        principalPolicyHead(groupPolicy),
        principalPolicyHead(groupPolicy, "members-group"),
      ],
      memberGroupId: "members-group",
      organizationId: parent.projection.organizationId,
      signingKeyPair: groupSigningKeyPair,
      userId: author.signerUserId,
    }),
  );
  let policyCommits = 0;
  let shareCalls = 0;

  await expect(
    withTestExecSql("container-group-share-mint-unnamed", (execSql) =>
      shareRemoteContainerWithGroup({
        accessLevel: "read",
        apiClient: {
          reciteContainer: async () => null,
          commitOrganizationGroupPolicy: async () => {
            policyCommits += 1;
            return null;
          },
          getContainerWriterProjection: async () => parent.projection,
          getCurrentPrincipalPolicy: async (principalType) =>
            principalType === "organization" ? organizationPolicy : groupPolicy,
          shareContainer: async () => {
            shareCalls += 1;
            return null;
          },
        },
        author,
        containerId: parent.projection.containerId,
        execSql,
        expectedGroupName: null,
        recipientGroupId: groupId,
        resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
        resolveTrustedUserIdentity: async (userId) =>
          createTestTrustedUserIdentity({
            encapsulationPublicKey: parent.encapsulationPublicKey,
            signingKeyFingerprint: author.signerKeyFingerprint,
            signingPublicKey: groupSigningKeyPair.signingPublicKey,
            userId,
          }),
        signedAt: SIGNED_AT,
        signingKeyPair: groupSigningKeyPair,
        targetSecretKey: parent.secretKey,
      }),
    ),
  ).rejects.toThrow("Minting a group grant requires the chosen group name");
  expect(policyCommits).toBe(0);
  expect(shareCalls).toBe(0);
});
