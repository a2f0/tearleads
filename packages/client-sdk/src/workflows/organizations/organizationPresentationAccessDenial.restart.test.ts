import { expect, test } from "bun:test";
import { createTestExecSql } from "@symcrypt/test-utils";
import { dataUsage } from "../../../test/helpers/organizationReadModelFixtures";
import {
  organizationReadModelFailure,
  organizationReadModelOrganizationId,
  organizationReadModelSnapshot,
  organizationReadModelUserId,
} from "../../../test/helpers/organizationReadModelProjectionFixtures";
import { createRejectingExecSql } from "../../../test/helpers/rejectingExecSql";
import { loadOrganizationDataUsageProjection } from "../../data/persistence/organizations/organizationDataUsagePersistence";
import {
  applyOrganizationReadModelResponse,
  loadOrganizationReadModelProjection,
} from "../../data/persistence/organizations/organizationReadModelPersistence";
import {
  loadLocalOrganizationDataUsage,
  reconcileOrganizationDataUsage,
} from "./dataUsageReadModel";
import {
  loadLocalOrganizationDirectoryAndGroups,
  reconcileOrganizationDirectoryAndGroups,
} from "./readModelProjection";

const organizationId = organizationReadModelOrganizationId;
const requesterUserId = organizationReadModelUserId;

test("a failed purge cannot serve the revoked projection after a restart", async () => {
  const testDb = await createTestExecSql(
    "organization-presentation-denial-restart-test",
  );
  let rejectPurgeDeletes = false;
  const execSql = createRejectingExecSql(
    testDb.execSql,
    (sql) =>
      rejectPurgeDeletes &&
      (sql.includes('delete from "organization_read_model_requesters"') ||
        sql.includes('delete from "organization_data_usage_snapshots"')),
  );

  try {
    await applyOrganizationReadModelResponse({
      currentUserId: requesterUserId,
      execSql,
      requestedCursor: null,
      response: organizationReadModelSnapshot(),
    });
    await reconcileOrganizationDataUsage({
      apiClient: {
        getOrganizationDataUsageResult: async () => ({
          data: dataUsage,
          ok: true,
        }),
      },
      execSql,
      organizationId,
      requesterUserId,
    });

    rejectPurgeDeletes = true;
    await expect(
      reconcileOrganizationDirectoryAndGroups({
        apiClient: {
          getOrganizationReadModelResult: async () =>
            organizationReadModelFailure({ kind: "http", status: 403 }),
        },
        currentUserId: requesterUserId,
        execSql,
        organizationId,
      }),
    ).resolves.toBeNull();
    rejectPurgeDeletes = false;

    // A restart loses the in-memory denial: a fresh executor over the same
    // database models the next app launch, offline.
    const restarted = createRejectingExecSql(testDb.execSql, () => false);
    await expect(
      loadLocalOrganizationDirectoryAndGroups({
        currentUserId: requesterUserId,
        execSql: restarted,
        organizationId,
      }),
    ).resolves.toBeNull();
    await expect(
      loadLocalOrganizationDataUsage({
        execSql: restarted,
        organizationId,
        requesterUserId,
      }),
    ).resolves.toBeNull();
    // Only the durable markers hide the reads: the revoked rows themselves
    // survived the failed purge.
    await expect(
      loadOrganizationReadModelProjection(
        restarted,
        organizationId,
        requesterUserId,
      ),
    ).resolves.not.toBeNull();
    await expect(
      loadOrganizationDataUsageProjection(
        restarted,
        organizationId,
        requesterUserId,
      ),
    ).resolves.toEqual(dataUsage);

    // Restored access reconciles from a cursorless snapshot (the marker hid
    // the stale local cursor) and clears the markers for both projections.
    const requestedCursors: Array<string | undefined> = [];
    await expect(
      reconcileOrganizationDirectoryAndGroups({
        apiClient: {
          getOrganizationReadModelResult: async (_organizationId, cursor) => {
            requestedCursors.push(cursor);
            return {
              data: organizationReadModelSnapshot({ cursor: "cursor-fresh" }),
              ok: true,
            };
          },
        },
        currentUserId: requesterUserId,
        execSql: restarted,
        organizationId,
      }),
    ).resolves.not.toBeNull();
    expect(requestedCursors[0]).toBeUndefined();
    await expect(
      loadLocalOrganizationDirectoryAndGroups({
        currentUserId: requesterUserId,
        execSql: restarted,
        organizationId,
      }),
    ).resolves.not.toBeNull();
    await expect(
      reconcileOrganizationDataUsage({
        apiClient: {
          getOrganizationDataUsageResult: async () => ({
            data: dataUsage,
            ok: true,
          }),
        },
        execSql: restarted,
        organizationId,
        requesterUserId,
      }),
    ).resolves.toEqual(dataUsage);
    await expect(
      loadLocalOrganizationDataUsage({
        execSql: restarted,
        organizationId,
        requesterUserId,
      }),
    ).resolves.toEqual(dataUsage);
  } finally {
    testDb.close();
  }
});

test("a denied requester's purge keeps shared rows for another local identity", async () => {
  const testDb = await createTestExecSql(
    "organization-presentation-shared-identity-purge-test",
  );
  const execSql = createRejectingExecSql(testDb.execSql, () => false);
  const otherUserId = "user-2";

  try {
    await applyOrganizationReadModelResponse({
      currentUserId: requesterUserId,
      execSql,
      requestedCursor: null,
      response: organizationReadModelSnapshot(),
    });
    await execSql(
      `INSERT INTO organization_read_model_requesters
         (organization_id, user_id, is_org_admin, updated_at)
       VALUES (?, ?, 0, ?)`,
      [organizationId, otherUserId, "2026-07-18T12:00:00.000Z"],
    );

    // The server denies user-2: only that requester's access falls.
    await expect(
      reconcileOrganizationDirectoryAndGroups({
        apiClient: {
          getOrganizationReadModelResult: async () =>
            organizationReadModelFailure({ kind: "http", status: 403 }),
        },
        currentUserId: otherUserId,
        execSql,
        organizationId,
      }),
    ).resolves.toBeNull();
    await expect(
      loadLocalOrganizationDirectoryAndGroups({
        currentUserId: otherUserId,
        execSql,
        organizationId,
      }),
    ).resolves.toBeNull();
    await expect(
      loadLocalOrganizationDirectoryAndGroups({
        currentUserId: requesterUserId,
        execSql,
        organizationId,
      }),
    ).resolves.not.toBeNull();

    // Restoring user-2 rebuilds from a fresh snapshot without dropping
    // user-1's surviving requester row alongside the replaced shared rows.
    const base = organizationReadModelSnapshot({ cursor: "cursor-restored" });
    const restoredAsUserTwo = {
      ...base,
      currentUser: { isOrgAdmin: false },
      lanes: {
        ...base.lanes,
        directory: base.lanes.directory && {
          ...base.lanes.directory,
          users: base.lanes.directory.users.map((user) => ({
            ...user,
            isSelf: user.userId === otherUserId,
          })),
        },
      },
    };
    await expect(
      reconcileOrganizationDirectoryAndGroups({
        apiClient: {
          getOrganizationReadModelResult: async () => ({
            data: restoredAsUserTwo,
            ok: true,
          }),
        },
        currentUserId: otherUserId,
        execSql,
        organizationId,
      }),
    ).resolves.not.toBeNull();
    await expect(
      loadLocalOrganizationDirectoryAndGroups({
        currentUserId: requesterUserId,
        execSql,
        organizationId,
      }),
    ).resolves.not.toBeNull();
    await expect(
      loadLocalOrganizationDirectoryAndGroups({
        currentUserId: otherUserId,
        execSql,
        organizationId,
      }),
    ).resolves.not.toBeNull();

    // Denying both requesters drops the organization-wide rows with the last.
    for (const deniedUserId of [otherUserId, requesterUserId]) {
      await expect(
        reconcileOrganizationDirectoryAndGroups({
          apiClient: {
            getOrganizationReadModelResult: async () =>
              organizationReadModelFailure({ kind: "http", status: 403 }),
          },
          currentUserId: deniedUserId,
          execSql,
          organizationId,
        }),
      ).resolves.toBeNull();
    }
    await expect(
      loadOrganizationReadModelProjection(
        execSql,
        organizationId,
        requesterUserId,
      ),
    ).resolves.toBeNull();
  } finally {
    testDb.close();
  }
});
