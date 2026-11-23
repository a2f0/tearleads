import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  createExpiringApiServer,
  SCOPE_RETIREMENTS,
} from "../../../../test/helpers/workflows/expiringApiServer";
import { reconcileOrganizationDirectoryAndGroups } from "./readModelProjection";

test.each(SCOPE_RETIREMENTS)(
  "a read-model page that expires after %s is not renewed or replayed",
  async (change) => {
    const organizationId = crypto.randomUUID();
    const server = createExpiringApiServer({
      method: "GET",
      path: new RegExp(`^/organizations/${organizationId}/`),
    });
    const { close, execSql } = await createTestExecSql(
      `read-model-scope-${change}`,
    );
    let current = true;
    try {
      const reconciled = reconcileOrganizationDirectoryAndGroups({
        apiClient: server.api,
        currentUserId: crypto.randomUUID(),
        execSql,
        organizationId,
        stillCurrent: () => current,
      });
      await server.entered;
      current = false;
      server.retire(change);
      server.release();
      expect(await reconciled).toBeUndefined();
      expect(server.requests).toHaveLength(1);
      expect(server.renewals.count).toBe(0);
    } finally {
      server.stop();
      close();
    }
  },
  15_000,
);
