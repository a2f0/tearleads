import { expect, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import { CONTAINER_MUTATION_ERROR_CODES } from "@tearleads/validators/response";
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

/**
 * The request each case holds: the signed POST, the parent read before it, or
 * the parent refetch after the POST is refused for a stale path.
 */
const HELD_REQUESTS = ["POST", "parent read", "stale-path refetch"] as const;

const STALE_PARENT_FAILURE = {
  kind: "http" as const,
  method: "POST" as const,
  path: "/containers",
  statusText: "Conflict",
  code: CONTAINER_MUTATION_ERROR_CODES.stateStale,
  message:
    "POST /containers: 409 Conflict: parentContainerPathRefs[0] manifest head is stale",
  ok: false as const,
  report: () => {},
  status: 409,
};

for (const held of HELD_REQUESTS) {
  test.each(SCOPE_RETIREMENTS)(
    `a container create ${held} that expires after %s is not renewed or replayed`,
    async (change) => {
      const parent = await createParentProjection();
      const { author } = await createAuthor({
        organizationId: parent.projection.organizationId,
        userId: parent.userId,
      });
      const database = await createTestExecSql(
        `container-post-scope-${held}-${change}`,
      );
      const server = createExpiringApiServer(
        held === "POST"
          ? { method: "POST", path: /^\/containers$/ }
          : { method: "GET", path: /^\/containers\/[^/]+\/writer-projection$/ },
      );
      const heldRead = held === "parent read" ? 1 : 2;
      let reads = 0;
      let submissions = 0;
      let current = true;
      try {
        const created = createContainerMutationServiceFixture({
          api: createMockApiClient({
            createContainerResult:
              held === "POST"
                ? server.api.createContainerResult
                : async () => {
                    submissions += 1;
                    return STALE_PARENT_FAILURE;
                  },
            getContainerWriterProjection: async (containerId, options) =>
              held !== "POST" && ++reads === heldRead
                ? server.api.getContainerWriterProjection(containerId, options)
                : parent.projection,
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
          resolveProjectionUserKey:
            createParentProjectionUserKeyResolver(parent),
          stillCurrent: () => current,
        });
        await server.entered;
        current = false;
        server.retire(change);
        server.release();
        expect(await created).toBeNull();
        expect(server.requests).toEqual([
          held === "POST"
            ? "POST /containers"
            : `GET /containers/${parent.projection.containerId}/writer-projection`,
        ]);
        expect(server.renewals.count).toBe(0);
        // Only the refetch follows a (refused) submission.
        expect(submissions).toBe(held === "stale-path refetch" ? 1 : 0);
      } finally {
        server.stop();
        database.close();
      }
    },
  );
}
