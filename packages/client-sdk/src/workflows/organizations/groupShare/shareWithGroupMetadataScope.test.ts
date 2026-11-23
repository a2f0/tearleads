import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  createParentProjection,
  createParentProjectionUserKeyResolver,
} from "../../../../test/helpers/data/containerFixtures";
import { buildInitialGroupPolicyRequest } from "../../../../test/helpers/data/groupMetadata";
import { createTestGroupMetadataProjection } from "../../../../test/helpers/data/groupMetadataProjection";
import {
  organizationPolicyBundleFromInitialRequest,
  policyBundleFromInitialRequest,
  principalPolicyHead,
} from "../../../../test/helpers/data/principalPolicyFixtures";
import { createTestTrustedUserIdentity } from "../../../../test/helpers/data/trustedUserIdentity";
import {
  createExpiringApiServer,
  SCOPE_RETIREMENTS,
} from "../../../../test/helpers/workflows/expiringApiServer";
import { isProjectionVerificationCancelledError } from "../../../data/keyingProjectionVerification";
import { buildInitialOrganizationPolicyRequest } from "../../../data/principals/organizationPolicyRequest";
import { shareRemoteContainerWithGroup } from "./shareWithGroup";

const ADMINS_ID = "metadata-scope-admins";
const MEMBERS_ID = "metadata-scope-members";
const GROUP_ID = "metadata-scope-design";

/** A custom-named group, whose name opens under the metadata container's key. */
async function customGroupScenario() {
  const parent = await createParentProjection();
  const author = parent.author;
  const signingKeyPair = {
    signingPrivateKey: author.signerPrivateKey,
    signingPublicKey: parent.signingPublicKey,
  };
  const metadata = await createTestGroupMetadataProjection(parent);
  const group = (groupId: string, name: string) =>
    buildInitialGroupPolicyRequest({
      identityTrustDomain: "https://api.example.test",
      creatorEncapsulationKeyPair: {
        publicKey: parent.encapsulationPublicKey,
        secretKey: parent.secretKey,
      },
      grants:
        groupId === GROUP_ID
          ? [
              {
                accessLevel: "read",
                containerId: parent.projection.containerId,
              },
            ]
          : [],
      groupId,
      metadataKey: metadata.key,
      name,
      signerUserId: author.signerUserId,
      signingFingerprint: author.signerKeyFingerprint,
      signingKeyPair,
    }).then(policyBundleFromInitialRequest);
  const admins = await group(ADMINS_ID, "Admins");
  const design = await group(GROUP_ID, "Design team");
  const organizationPolicy = await organizationPolicyBundleFromInitialRequest(
    parent.projection.organizationId,
    await buildInitialOrganizationPolicyRequest({
      identityTrustDomain: "https://api.example.test",
      adminGroupId: ADMINS_ID,
      encapsulationPublicKey: parent.encapsulationPublicKey,
      groupHeads: [
        principalPolicyHead(admins),
        principalPolicyHead(admins, MEMBERS_ID),
        principalPolicyHead(design),
      ],
      memberGroupId: MEMBERS_ID,
      organizationId: parent.projection.organizationId,
      signingKeyPair,
      userId: author.signerUserId,
    }),
  );
  const policies = new Map([
    [ADMINS_ID, admins],
    [GROUP_ID, design],
  ]);
  return { metadata, organizationPolicy, parent, policies, signingKeyPair };
}

test.each(SCOPE_RETIREMENTS)(
  "a custom group's metadata read that expires after %s is not renewed or replayed",
  async (change) => {
    const scenario = await customGroupScenario();
    const { metadata, parent } = scenario;
    const metadataContainerId = metadata.projection.containerId;
    const database = await createTestExecSql(`group-metadata-scope-${change}`);
    const server = createExpiringApiServer({
      method: "GET",
      path: new RegExp(
        `^/containers/${metadataContainerId}/writer-projection$`,
      ),
    });
    let current = true;
    try {
      const shared = shareRemoteContainerWithGroup({
        reportSecurityIncident: async () => {},
        accessLevel: "read",
        apiClient: {
          reciteContainer: async () => null,
          evictContainerWriterProjection: () => {},
          commitOrganizationGroupPolicy: async () => {
            throw new Error("A retired name read must not commit");
          },
          getContainerWriterProjectionResult: async () => ({
            ok: true,
            data: parent.projection,
          }),
          getContainerWriterProjection: async (containerId, options) =>
            containerId === metadataContainerId
              ? server.api.getContainerWriterProjection(containerId, options)
              : parent.projection,
          getCurrentPrincipalPolicy: async (principalType, principalId) =>
            principalType === "organization"
              ? scenario.organizationPolicy
              : (scenario.policies.get(principalId) ?? null),
          shareContainer: async () => {
            throw new Error("A retired name read must not reach the share");
          },
        },
        author: parent.author,
        containerId: parent.projection.containerId,
        execSql: database.execSql,
        expectedGroupName: "Design team",
        recipientGroupId: GROUP_ID,
        resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
        resolveTrustedUserIdentity: async (userId) =>
          createTestTrustedUserIdentity({
            encapsulationPublicKey: parent.encapsulationPublicKey,
            signingKeyFingerprint: parent.author.signerKeyFingerprint,
            signingPublicKey: parent.signingPublicKey,
            userId,
          }),
        signingKeyPair: scenario.signingKeyPair,
        stillCurrent: () => current,
        targetSecretKey: parent.secretKey,
      }).then(
        (result) => ({ result }),
        (error: unknown) => ({ error }),
      );
      await server.entered;
      current = false;
      server.retire(change);
      server.release();
      const outcome = await shared;
      if ("error" in outcome)
        expect(isProjectionVerificationCancelledError(outcome.error)).toBe(
          true,
        );
      else expect(outcome.result).toBeNull();
      expect(server.requests).toEqual([
        `GET /containers/${metadataContainerId}/writer-projection`,
      ]);
      expect(server.renewals.count).toBe(0);
    } finally {
      server.stop();
      database.close();
    }
  },
  15_000,
);
