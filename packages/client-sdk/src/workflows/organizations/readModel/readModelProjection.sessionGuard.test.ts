import { expect, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import { ORGANIZATION_PRESENTATION_ERROR_CODES } from "@tearleads/validators/response";
import {
  organizationReadModelFailure,
  organizationReadModelOrganizationId,
  organizationReadModelSnapshot,
  organizationReadModelUserId,
} from "../../../../test/helpers/data/organizationReadModelProjectionFixtures";
import { subscribeOrganizationReadModelInvalidation } from "../../../data/persistence/organizations/organizationReadModelInvalidation";
import { OrganizationReadModelRepository } from "../../../data/persistence/organizations/organizationReadModelRepository";
import { createExecSql } from "../../../data/sqlite/sqlSchema";
import { loadLocalOrganizationPolicyReference } from "./localReadModelDetails";
import { reconcileOrganizationDirectoryAndGroups } from "./readModelProjection";

const organizationId = organizationReadModelOrganizationId;
const userId = organizationReadModelUserId;
const scope = { organizationId, requesterUserId: userId };

/**
 * A denied pass whose session ends while one of its denial writes is inside
 * its transaction: past every check before the write, before its commit.
 */
async function denialEndingDuring(name: string, statement: RegExp) {
  const base = await createTestExecSql(name);
  let armed = false;
  let ended = false;
  const execSql = createExecSql({
    async exec({ bind, rowMode, sql }) {
      if (armed && statement.test(sql)) ended = true;
      const rows =
        rowMode === "array"
          ? await base.execSql(sql, bind, { rowMode: "array" })
          : await base.execSql(sql, bind, { rowMode: "object" });
      return { rows };
    },
  });
  const repository = new OrganizationReadModelRepository(execSql);
  await repository.applyOrganizationReadModelResponse({
    currentUserId: userId,
    requestedCursor: null,
    response: organizationReadModelSnapshot({ cursor: "cursor-1" }),
  });
  // Seeding writes the same tables; only the pass's own writes end it.
  armed = true;
  const reconciled = await reconcileOrganizationDirectoryAndGroups({
    apiClient: createMockApiClient({
      getOrganizationReadModelResult: async () =>
        organizationReadModelFailure({
          code: ORGANIZATION_PRESENTATION_ERROR_CODES.accessDenied,
          kind: "http",
          status: 403,
        }),
    }),
    currentUserId: userId,
    execSql,
    organizationId,
    stillCurrent: () => !ended,
  });
  return { close: base.close, reconciled, repository };
}

test("a session that ends inside the denial marker's write rolls it back", async () => {
  const f = await denialEndingDuring(
    "read-model-denial-marker-commit-test",
    /insert into "organization_presentation_denials"/iu,
  );
  try {
    expect(f.reconciled).toBeUndefined();
    await expect(
      f.repository.hasOrganizationPresentationDenial(scope, "readModel"),
    ).resolves.toBe(false);
    await expect(
      f.repository.loadOrganizationReadModelProjection(organizationId, userId),
    ).resolves.toMatchObject({ cursor: "cursor-1" });
  } finally {
    f.close();
  }
});

test("a session that ends inside the denial purge's write rolls it back", async () => {
  const f = await denialEndingDuring(
    "read-model-denial-purge-commit-test",
    /delete from "organization_read_model_requesters"/iu,
  );
  try {
    expect(f.reconciled).toBeUndefined();
    // The marker committed while the session held; the purge did not.
    await expect(
      f.repository.hasOrganizationPresentationDenial(scope, "readModel"),
    ).resolves.toBe(true);
    await expect(
      f.repository.loadOrganizationReadModelProjection(organizationId, userId),
    ).resolves.toMatchObject({ cursor: "cursor-1" });
  } finally {
    f.close();
  }
});

test("a policy reference load commits no integrity purge for an ended session", async () => {
  const { close, execSql } = await createTestExecSql(
    "read-model-reference-integrity-guard-test",
  );
  const repository = new OrganizationReadModelRepository(execSql);
  const invalidations: string[] = [];
  const unsubscribe = subscribeOrganizationReadModelInvalidation(
    execSql,
    (invalidated) => invalidations.push(invalidated),
  );
  const reference = {
    currentUserId: userId,
    execSql,
    organizationId,
    principalId: organizationId,
    principalType: "organization" as const,
  };
  try {
    await repository.applyOrganizationReadModelResponse({
      currentUserId: userId,
      requestedCursor: null,
      response: organizationReadModelSnapshot({ cursor: "cursor-1" }),
    });
    await execSql(
      `UPDATE organization_read_model_groups
       SET key_fingerprint = NULL
       WHERE organization_id = ? AND state_hash IS NOT NULL`,
      [organizationId],
    );

    await expect(
      loadLocalOrganizationPolicyReference({
        ...reference,
        stillCurrent: () => false,
      }),
    ).resolves.toBeNull();
    expect(invalidations).toEqual([]);
    // Without a guard the same load purges the invalid rows.
    await loadLocalOrganizationPolicyReference(reference);
    expect(invalidations).toEqual([organizationId]);
  } finally {
    unsubscribe();
    close();
  }
});
