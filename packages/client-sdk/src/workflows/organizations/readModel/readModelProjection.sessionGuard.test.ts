import { expect, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import { ORGANIZATION_PRESENTATION_ERROR_CODES } from "@tearleads/validators/response";
import {
  organizationReadModelFailure,
  organizationReadModelOrganizationId,
  organizationReadModelSnapshot,
  organizationReadModelUserId,
} from "../../../../test/helpers/data/organizationReadModelProjectionFixtures";
import { OrganizationReadModelRepository } from "../../../data/persistence/organizations/organizationReadModelRepository";
import { reconcileOrganizationDirectoryAndGroups } from "./readModelProjection";

const organizationId = organizationReadModelOrganizationId;
const userId = organizationReadModelUserId;

test("a session that ends while its denial waits records and purges nothing", async () => {
  const { close, execSql } = await createTestExecSql(
    "read-model-denial-queued-session-test",
  );
  const repository = new OrganizationReadModelRepository(execSql);
  try {
    await repository.applyOrganizationReadModelResponse({
      currentUserId: userId,
      requestedCursor: null,
      response: organizationReadModelSnapshot({ cursor: "cursor-1" }),
    });
    const apiClient = createMockApiClient({
      getOrganizationReadModelResult: async () =>
        organizationReadModelFailure({
          code: ORGANIZATION_PRESENTATION_ERROR_CODES.accessDenied,
          kind: "http",
          status: 403,
        }),
    });
    // Current when the 403 arrives, ended before its queued writes run.
    let checks = 0;

    await expect(
      reconcileOrganizationDirectoryAndGroups({
        apiClient,
        currentUserId: userId,
        execSql,
        organizationId,
        stillCurrent: () => {
          checks += 1;
          return checks <= 1;
        },
      }),
    ).resolves.toBeNull();
    await expect(
      repository.hasOrganizationPresentationDenial(
        { organizationId, requesterUserId: userId },
        "readModel",
      ),
    ).resolves.toBe(false);
    await expect(
      repository.loadOrganizationReadModelProjection(organizationId, userId),
    ).resolves.toMatchObject({ cursor: "cursor-1" });
  } finally {
    close();
  }
});
