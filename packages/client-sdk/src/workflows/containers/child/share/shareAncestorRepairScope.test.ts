import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
} from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import { createContainerServer } from "../../../../../test/helpers/data/containerMutationServer";
import { createTestTrustedUserIdentity } from "../../../../../test/helpers/data/trustedUserIdentity";
import { createRotatedAncestorFixture } from "../../../../../test/helpers/workflows/ancestorRotationRecovery";
import { createContainerMutationServiceFixture } from "../../../../../test/helpers/workflows/containerMutationServiceFixture";
import {
  createExpiringApiServer,
  SCOPE_RETIREMENTS,
} from "../../../../../test/helpers/workflows/expiringApiServer";

/**
 * Sharing the grandchild below a lazily stale chain first re-keys the child,
 * reading its projection, then refetches the grandchild's. Each read is held
 * in turn: the `nth` read of `containerId` goes to the expiring server.
 */
const HELD_READS = {
  "repair read": { containerId: "child", nth: 1 },
  "repaired refetch": { containerId: "grandchild", nth: 2 },
} as const;

for (const [held, read] of Object.entries(HELD_READS)) {
  test.each(SCOPE_RETIREMENTS)(
    `a share's ${held} that expires after %s is not renewed or replayed`,
    async (change) => {
      const fixture = await createRotatedAncestorFixture();
      const database = await createTestExecSql(`share-repair-scope-${change}`);
      const server = createExpiringApiServer({
        method: "GET",
        path: /^\/containers\/[^/]+\/writer-projection$/,
      });
      let current = true;
      try {
        const owner = { ...fixture.input, execSql: database.execSql };
        const containers = createContainerServer([
          fixture.root.projection,
          fixture.child.projection,
          fixture.grandchild.projection,
        ]);
        const service = (api: typeof containers.apiClient) =>
          createContainerMutationServiceFixture({
            api,
            encapsulationSecretKey: owner.targetSecretKey,
            execSql: owner.execSql,
            reportSecurityIncident: async () => {},
            resolveTrustedUserIdentity: async (userId) =>
              createTestTrustedUserIdentity({
                userId,
                encapsulationPublicKey: generateKemSeedAndKeyPair().publicKey,
                signingPublicKey:
                  generateSigningSeedAndKeyPair().signingPublicKey,
                signingKeyFingerprint: "leaf-writer-signing-key",
              }),
          });
        // Rotating the root leaves the chain below it lazily stale.
        expect(
          await service(containers.apiClient).rekeyRemoteContainer({
            author: owner.author,
            containerId: fixture.root.projection.containerId,
            resolveProjectionUserKey: owner.resolveProjectionUserKey,
          }),
        ).not.toBeNull();
        let reads = 0;
        const shared = service({
          ...containers.apiClient,
          getContainerWriterProjection: (
            containerId: string,
            options?: { readonly stillCurrent?: () => boolean },
          ) =>
            containerId === read.containerId && ++reads === read.nth
              ? server.api.getContainerWriterProjection(containerId, options)
              : containers.apiClient.getContainerWriterProjection(containerId),
        }).shareRemoteContainer({
          accessLevel: "write",
          author: owner.author,
          containerId: "grandchild",
          recipientUserId: "leaf-writer",
          resolveProjectionUserKey: owner.resolveProjectionUserKey,
          stillCurrent: () => current,
        });
        await server.entered;
        current = false;
        server.retire(change);
        server.release();
        expect(await shared).toBeNull();
        expect(server.requests).toEqual([
          `GET /containers/${read.containerId}/writer-projection`,
        ]);
        expect(server.renewals.count).toBe(0);
        expect(containers.submissions.flat()).not.toContain("share:grandchild");
      } finally {
        server.stop();
        database.close();
      }
    },
    120_000,
  );
}
