import { expect, test } from "bun:test";
import { createCurrentShareMetadataFixture } from "../../../../../test/helpers/workflows/currentShareMetadata";
import {
  createExpiringApiServer,
  SCOPE_RETIREMENTS,
} from "../../../../../test/helpers/workflows/expiringApiServer";
import { shareRemoteContainerWithGroup } from "../remote";

// The runtime group share, re-wrapping a grant the admin policy already signs.
test.each(SCOPE_RETIREMENTS)(
  "a runtime group share POST that expires after %s is not renewed or replayed",
  async (change) => {
    const f = await createCurrentShareMetadataFixture();
    const server = createExpiringApiServer({
      method: "POST",
      path: /^\/containers\/[^/]+\/share$/,
    });
    f.options.apiClient.shareContainer = server.api.shareContainer;
    let current = true;
    try {
      const shared = shareRemoteContainerWithGroup({
        accessLevel: "admin",
        containerId: f.rootProjection.containerId,
        expectedGroupName: "Admins",
        previousProjection: f.rootProjection,
        recipientGroupId: f.admin.currentState.principalId,
        resolveProjectionUserKey: f.runtime.resolveTrustedUserIdentity,
        runtime: f.runtime,
        stillCurrent: () => current,
      });
      await server.entered;
      current = false;
      server.retire(change);
      server.release();
      expect(await shared).toBeNull();
      expect(server.requests).toEqual([
        `POST /containers/${f.rootProjection.containerId}/share`,
      ]);
      expect(server.renewals.count).toBe(0);
    } finally {
      server.stop();
      f.close();
    }
  },
  15_000,
);
