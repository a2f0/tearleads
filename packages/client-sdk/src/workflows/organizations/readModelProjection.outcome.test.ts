import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  organizationReadModelFailure,
  organizationReadModelOrganizationId,
  organizationReadModelSnapshot,
  organizationReadModelUserId,
} from "../../../test/helpers/organizationReadModelProjectionFixtures";
import { applyOrganizationReadModelResponse } from "../../data/persistence/organizations/organizationReadModelPersistence";
import { reconcileOrganizationDirectoryAndGroupsWithOutcome } from "./readModelProjection";

const organizationId = organizationReadModelOrganizationId;
const currentUserId = organizationReadModelUserId;

test("only a pass whose feed request succeeded reports reconciliation", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-read-model-reconcile-outcome-test",
  );
  try {
    await applyOrganizationReadModelResponse({
      currentUserId,
      execSql,
      requestedCursor: null,
      response: organizationReadModelSnapshot(),
    });

    // A failure keeps the last-known-good projection for presentation, but
    // must not let a caller treat the feed as read.
    const failed = await reconcileOrganizationDirectoryAndGroupsWithOutcome({
      apiClient: {
        async getOrganizationReadModelResult() {
          return organizationReadModelFailure({
            kind: "network",
            status: null,
          });
        },
      },
      currentUserId,
      execSql,
      organizationId,
    });
    expect(failed.directoryAndGroups?.directory.organizationId).toBe(
      organizationId,
    );
    expect(failed.reconciled).toBe(false);

    const succeeded = await reconcileOrganizationDirectoryAndGroupsWithOutcome({
      apiClient: {
        async getOrganizationReadModelResult() {
          return { data: organizationReadModelSnapshot(), ok: true };
        },
      },
      currentUserId,
      execSql,
      organizationId,
    });
    expect(succeeded.directoryAndGroups?.directory.organizationId).toBe(
      organizationId,
    );
    expect(succeeded.reconciled).toBe(true);
  } finally {
    close();
  }
});
