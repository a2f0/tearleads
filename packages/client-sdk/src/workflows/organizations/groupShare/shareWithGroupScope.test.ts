import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  createParentProjection,
  createParentProjectionUserKeyResolver,
} from "../../../../test/helpers/data/containerFixtures";
import { buildInitialGroupPolicyRequest } from "../../../../test/helpers/data/groupMetadata";
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
import { buildInitialOrganizationPolicyRequest } from "../../../data/principals/organizationPolicyRequest";
import { shareRemoteContainerWithGroup } from "./shareWithGroup";

const HELD_REQUESTS = {
  POST: { method: "POST", path: /^\/containers\/[^/]+\/share$/ },
  "projection read": {
    method: "GET",
    path: /^\/containers\/[^/]+\/writer-projection$/,
  },
} as const;

/** A group whose signed policy already grants the container, so a share re-wraps. */
async function grantedGroupScenario() {
  const parent = await createParentProjection();
  const author = parent.author;
  const signingKeyPair = {
    signingPrivateKey: author.signerPrivateKey,
    signingPublicKey: parent.signingPublicKey,
  };
  const groupId = "scoped-share-group";
  const groupPolicy = await policyBundleFromInitialRequest(
    await buildInitialGroupPolicyRequest({
      identityTrustDomain: "https://api.example.test",
      creatorEncapsulationKeyPair: {
        publicKey: parent.encapsulationPublicKey,
        secretKey: parent.secretKey,
      },
      grants: [
        { accessLevel: "read", containerId: parent.projection.containerId },
      ],
      groupId,
      name: "Admins",
      signerUserId: author.signerUserId,
      signingFingerprint: author.signerKeyFingerprint,
      signingKeyPair,
    }),
  );
  const organizationPolicy = await organizationPolicyBundleFromInitialRequest(
    parent.projection.organizationId,
    await buildInitialOrganizationPolicyRequest({
      identityTrustDomain: "https://api.example.test",
      adminGroupId: groupId,
      encapsulationPublicKey: parent.encapsulationPublicKey,
      groupHeads: [
        principalPolicyHead(groupPolicy),
        principalPolicyHead(groupPolicy, "scoped-share-members"),
      ],
      memberGroupId: "scoped-share-members",
      organizationId: parent.projection.organizationId,
      signingKeyPair,
      userId: author.signerUserId,
    }),
  );
  return { groupId, groupPolicy, organizationPolicy, parent, signingKeyPair };
}

for (const [held, request] of Object.entries(HELD_REQUESTS)) {
  test.each(SCOPE_RETIREMENTS)(
    `a group share ${held} that expires after %s is not renewed or replayed`,
    async (change) => {
      const scenario = await grantedGroupScenario();
      const { groupId, parent } = scenario;
      const database = await createTestExecSql(`group-share-scope-${change}`);
      const server = createExpiringApiServer(request);
      let current = true;
      try {
        const shared = shareRemoteContainerWithGroup({
          reportSecurityIncident: async () => {},
          accessLevel: "read",
          apiClient: {
            reciteContainer: async () => null,
            evictContainerWriterProjection: () => {},
            commitOrganizationGroupPolicy: async () => {
              throw new Error("A granted group share commits no policy");
            },
            getContainerWriterProjectionResult: async () => ({
              ok: true,
              data: parent.projection,
            }),
            getContainerWriterProjection:
              request.method === "GET"
                ? server.api.getContainerWriterProjection
                : async () => parent.projection,
            getCurrentPrincipalPolicy: async (principalType) =>
              principalType === "organization"
                ? scenario.organizationPolicy
                : scenario.groupPolicy,
            shareContainer:
              request.method === "POST"
                ? server.api.shareContainer
                : async () => {
                    throw new Error("A retired read must not reach the share");
                  },
          },
          author: parent.author,
          containerId: parent.projection.containerId,
          execSql: database.execSql,
          expectedGroupName: "Admins",
          recipientGroupId: groupId,
          resolveProjectionUserKey:
            createParentProjectionUserKeyResolver(parent),
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
        });
        await server.entered;
        current = false;
        server.retire(change);
        server.release();
        expect(await shared).toBeNull();
        expect(server.requests).toEqual([
          request.method === "POST"
            ? `POST /containers/${parent.projection.containerId}/share`
            : `GET /containers/${parent.projection.containerId}/writer-projection`,
        ]);
        expect(server.renewals.count).toBe(0);
      } finally {
        server.stop();
        database.close();
      }
    },
    15_000,
  );
}
