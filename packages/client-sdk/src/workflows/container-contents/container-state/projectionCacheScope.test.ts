import { expect, test } from "bun:test";
import {
  createExpiringApiServer,
  SCOPE_RETIREMENTS,
} from "../../../../test/helpers/workflows/expiringApiServer";
import { readContainerWriterProjection } from "./projectionCache";

// The parent projection read under a folder create, as in ensureContactsContainer.
test.each(SCOPE_RETIREMENTS)(
  "a parent projection read that expires after %s does not renew",
  async (change) => {
    const server = createExpiringApiServer({
      method: "GET",
      path: /^\/containers\/[^/]+\/writer-projection$/,
    });
    let current = true;
    try {
      const read = readContainerWriterProjection(
        server.api,
        "scoped-parent",
        () => current,
      );
      await server.entered;
      current = false;
      server.retire(change);
      server.release();
      expect(await read).toBeNull();
      expect(server.requests).toEqual([
        "GET /containers/scoped-parent/writer-projection",
      ]);
      expect(server.renewals.count).toBe(0);
    } finally {
      server.stop();
    }
  },
);
