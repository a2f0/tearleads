import { expect, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import {
  createAuthor,
  createParentProjection,
  createParentProjectionUserKeyResolver,
} from "../../../../../test/helpers/data/containerFixtures";
import { createContainerMutationServiceFixture } from "../../../../../test/helpers/workflows/containerMutationServiceFixture";
import {
  createExpiringApiServer,
  SCOPE_RETIREMENTS,
} from "../../../../../test/helpers/workflows/expiringApiServer";

test.each(SCOPE_RETIREMENTS)(
  "a container create POST that expires after %s is not renewed or replayed",
  async (change) => {
    const parent = await createParentProjection();
    const { author } = await createAuthor({
      organizationId: parent.projection.organizationId,
      userId: parent.userId,
    });
    const database = await createTestExecSql(`container-post-scope-${change}`);
    const server = createExpiringApiServer({
      method: "POST",
      path: /^\/containers$/,
    });
    let current = true;
    try {
      const created = createContainerMutationServiceFixture({
        api: createMockApiClient({
          createContainerResult: server.api.createContainerResult,
          getContainerWriterProjection: async () => parent.projection,
          getCurrentPrincipalPolicy: async () => null,
        }),
        execSql: database.execSql,
        encapsulationSecretKey: parent.secretKey,
        reportSecurityIncident: async () => undefined,
        resolveTrustedUserIdentity:
          createParentProjectionUserKeyResolver(parent),
      }).createRemoteContainer({
        author,
        containerId: `scoped-container-${change.replaceAll(" ", "-")}`,
        parentContainerId: parent.projection.containerId,
        resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
        stillCurrent: () => current,
      });
      await server.entered;
      current = false;
      server.retire(change);
      server.release();
      expect(await created).toBeNull();
      expect(server.requests).toEqual(["POST /containers"]);
      expect(server.renewals.count).toBe(0);
    } finally {
      server.stop();
      database.close();
    }
  },
);
