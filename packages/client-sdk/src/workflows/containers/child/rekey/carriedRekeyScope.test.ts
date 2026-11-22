import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { createContainerServer } from "../../../../../test/helpers/data/containerMutationServer";
import { createRotatedAncestorFixture } from "../../../../../test/helpers/workflows/ancestorRotationRecovery";
import { createContainerMutationServiceFixture } from "../../../../../test/helpers/workflows/containerMutationServiceFixture";
import {
  createExpiringApiServer,
  SCOPE_RETIREMENTS,
} from "../../../../../test/helpers/workflows/expiringApiServer";
import { isProjectionVerificationCancelledError } from "../../../../data/keyingProjectionVerification";

// A root rotation refused for stranding `child` reads the child's projection
// to sign its carried rekey. That read is held, and the caller retires.
test.each(SCOPE_RETIREMENTS)(
  "a carried rekey's projection read that expires after %s is not renewed or replayed",
  async (change) => {
    const fixture = await createRotatedAncestorFixture();
    const database = await createTestExecSql(`carried-rekey-scope-${change}`);
    const server = createExpiringApiServer({
      method: "GET",
      path: /^\/containers\/child\/writer-projection$/,
    });
    let current = true;
    try {
      const rootId = fixture.root.projection.containerId;
      const containers = createContainerServer(
        [
          fixture.root.projection,
          fixture.child.projection,
          fixture.grandchild.projection,
        ],
        { [rootId]: ["child"] },
      );
      const rotated = createContainerMutationServiceFixture({
        api: {
          ...containers.apiClient,
          getContainerWriterProjection: (
            containerId: string,
            options?: { readonly stillCurrent?: () => boolean },
          ) =>
            containerId === "child"
              ? server.api.getContainerWriterProjection(containerId, options)
              : containers.apiClient.getContainerWriterProjection(containerId),
        },
        encapsulationSecretKey: fixture.input.targetSecretKey,
        execSql: database.execSql,
        reportSecurityIncident: async () => {},
      })
        .rekeyRemoteContainer({
          author: fixture.input.author,
          containerId: rootId,
          resolveProjectionUserKey: fixture.input.resolveProjectionUserKey,
          stillCurrent: () => current,
        })
        .catch((error: unknown) => error);
      await server.entered;
      current = false;
      server.retire(change);
      server.release();
      // A retired caller ends in the cancellation verification would raise.
      expect(isProjectionVerificationCancelledError(await rotated)).toBe(true);
      expect(server.requests).toEqual([
        "GET /containers/child/writer-projection",
      ]);
      expect(server.renewals.count).toBe(0);
      // Only the refused rotation was submitted; nothing was resubmitted.
      expect(containers.submissions).toEqual([[rootId]]);
    } finally {
      server.stop();
      database.close();
    }
  },
  120_000,
);
