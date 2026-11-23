import { expect, test } from "bun:test";
import { createMockApiClient } from "@tearleads/test-utils";
import {
  createExpiringApiServer,
  SCOPE_RETIREMENTS,
} from "../../../test/helpers/workflows/expiringApiServer";
import {
  createInternalRuntimeFixture,
  createWorkflowInputFixture,
} from "../../../test/helpers/workflows/internalRuntimeFixtures";
import { listPendingBlobDeletions } from "./pendingBlobDeletions";

test.each(SCOPE_RETIREMENTS)(
  "a pending deletion read that expires after %s is not renewed or replayed",
  async (change) => {
    const organizationId = crypto.randomUUID();
    const server = createExpiringApiServer({
      method: "GET",
      path: new RegExp(`^/organizations/${organizationId}/`),
    });
    let current = createWorkflowInputFixture({
      apiClient: createMockApiClient({
        listOrganizationPendingBlobDeletionsResult:
          server.api.listOrganizationPendingBlobDeletionsResult,
      }),
      auth: { organizationId, userId: "admin" },
      execSql: async () => [],
    });
    try {
      const listed = listPendingBlobDeletions(
        createInternalRuntimeFixture(() => current),
        organizationId,
      );
      await server.entered;
      current = { ...current, auth: { ...current.auth, userId: "other" } };
      server.retire(change);
      server.release();
      expect((await listed).ok).toBe(false);
      expect(server.requests).toHaveLength(1);
      expect(server.renewals.count).toBe(0);
    } finally {
      server.stop();
    }
  },
  15_000,
);
