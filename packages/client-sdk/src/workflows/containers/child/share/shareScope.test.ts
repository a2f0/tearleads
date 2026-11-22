import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  createAuthor,
  createParentProjection,
  createParentProjectionUserKeyResolver,
  createRecipientIdentityResolver,
} from "../../../../../test/helpers/data/containerFixtures";
import { createContainerMutationServiceFixture } from "../../../../../test/helpers/workflows/containerMutationServiceFixture";
import {
  createExpiringApiServer,
  SCOPE_RETIREMENTS,
} from "../../../../../test/helpers/workflows/expiringApiServer";

const HELD_REQUESTS = {
  POST: { method: "POST", path: /^\/containers\/[^/]+\/share$/ },
  "projection read": {
    method: "GET",
    path: /^\/containers\/[^/]+\/writer-projection$/,
  },
} as const;

for (const [held, request] of Object.entries(HELD_REQUESTS)) {
  test.each(SCOPE_RETIREMENTS)(
    `a share ${held} that expires after %s is not renewed or replayed`,
    async (change) => {
      const parent = await createParentProjection();
      const { author } = await createAuthor({
        organizationId: parent.projection.organizationId,
        userId: parent.userId,
      });
      const recipientKeyPair = generateKemSeedAndKeyPair();
      const database = await createTestExecSql(
        `container-share-scope-${change}`,
      );
      const server = createExpiringApiServer(request);
      let current = true;
      try {
        const shared = createContainerMutationServiceFixture({
          reportSecurityIncident: async () => {},
          api: {
            reciteContainer: async () => null,
            getContainerWriterProjection:
              request.method === "GET"
                ? server.api.getContainerWriterProjection
                : async () => parent.projection,
            shareContainer: server.api.shareContainer,
            shareContainerResult: server.api.shareContainerResult,
          },
          execSql: database.execSql,
          resolveTrustedUserIdentity: createRecipientIdentityResolver({
            encapsulationPublicKey: recipientKeyPair.publicKey,
            signingKeyFingerprint: author.signerKeyFingerprint,
            signingPublicKey: parent.signingPublicKey,
          }),
          encapsulationSecretKey: parent.secretKey,
        }).shareRemoteContainer({
          accessLevel: "write",
          author,
          containerId: parent.projection.containerId,
          recipientUserId: "user-2",
          resolveProjectionUserKey:
            createParentProjectionUserKeyResolver(parent),
          stillCurrent: () => current,
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
  );
}
