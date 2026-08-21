import { expect, test } from "bun:test";
import { createTestExecSql } from "@symcrypt/test-utils";
import { dataUsage } from "../../../../test/helpers/organizationReadModelFixtures";
import {
  organizationReadModelDelta as delta,
  organizationReadModelDirectory as directory,
  organizationReadModelDirectoryUser as directoryUser,
  organizationReadModelGroups as groups,
  organizationReadModelSnapshot as snapshot,
} from "../../../../test/helpers/organizationReadModelPersistenceFixtures";
import {
  loadOrganizationDataUsageProjection,
  saveOrganizationDataUsageProjection,
} from "./organizationDataUsagePersistence";
import { subscribeOrganizationReadModelInvalidation } from "./organizationReadModelInvalidation";
import { loadOrganizationReadModelGroupMembers } from "./organizationReadModelMemberLoad";
import {
  applyOrganizationReadModelResponse,
  loadOrganizationReadModelProjection,
} from "./organizationReadModelPersistence";

test("organization read-model snapshots persist normalized requester-safe projections", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-read-model-snapshot-persistence-test",
  );

  try {
    const response = snapshot("org-1", "opaque-cursor-over-9007199254740991");
    await expect(
      applyOrganizationReadModelResponse({
        currentUserId: "user-1",
        execSql,
        requestedCursor: null,
        response,
      }),
    ).resolves.toBe("applied");

    const userOneProjection = await loadOrganizationReadModelProjection(
      execSql,
      "org-1",
      "user-1",
    );
    expect(userOneProjection).toEqual({
      cursor: response.nextCursor,
      directory: {
        organizationId: "org-1",
        profileDocumentId: "organization-profile-org-1",
        users: [
          expect.objectContaining({ isSelf: true, userId: "user-1" }),
          expect.objectContaining({ isSelf: false, userId: "user-2" }),
        ],
      },
      grants: { organizationId: "org-1", grants: [] },
      groups: groups("org-1"),
      membershipEdges: [
        {
          groupId: "admins-org-1",
          userId: "user-1",
        },
      ],
      organizationId: "org-1",
      policyHeads: [
        {
          organizationId: "org-1",
          principalType: "group",
          principalId: "admins-org-1",
          stateHash: "state-initial",
          version: 2,
          keyEpoch: 2,
          keyFingerprint: "key-fingerprint-initial",
          memberCount: 1,
        },
        {
          organizationId: "org-1",
          principalType: "organization",
          principalId: "org-1",
          stateHash: "organization-state-initial",
          version: 2,
          keyEpoch: 2,
          keyFingerprint: "organization-key-fingerprint-initial",
          memberCount: 1,
        },
      ],
      protocolVersion: 6,
      requester: { isOrgAdmin: true },
      updatedAt: expect.any(String),
    });

    const userTwoProjection = await loadOrganizationReadModelProjection(
      execSql,
      "org-1",
      "user-2",
    );
    expect(userTwoProjection?.requester).toBeNull();
    expect(userTwoProjection?.directory.users).toEqual([
      expect.objectContaining({ isSelf: false, userId: "user-1" }),
      expect.objectContaining({ isSelf: true, userId: "user-2" }),
    ]);
  } finally {
    close();
  }
});

test("local group members require a requester projection", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-read-model-members-requester-test",
  );
  try {
    await applyOrganizationReadModelResponse({
      currentUserId: "user-1",
      execSql,
      requestedCursor: null,
      response: snapshot("org-1", "cursor-1"),
    });

    await expect(
      loadOrganizationReadModelGroupMembers(
        execSql,
        "org-1",
        "admins-org-1",
        "user-without-requester",
      ),
    ).resolves.toBeNull();
  } finally {
    close();
  }
});

test("same-next-cursor responses persist sequential requester metadata", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-read-model-sequential-requesters-test",
  );

  try {
    await applyOrganizationReadModelResponse({
      currentUserId: "user-1",
      execSql,
      requestedCursor: null,
      response: snapshot("org-1", "cursor-1"),
    });
    const firstResponse = delta({
      groups: groups("org-1", "next"),
      nextCursor: "cursor-2",
      organizationId: "org-1",
    });
    await expect(
      applyOrganizationReadModelResponse({
        currentUserId: "user-1",
        execSql,
        requestedCursor: "cursor-1",
        response: firstResponse,
      }),
    ).resolves.toBe("applied");
    await expect(
      applyOrganizationReadModelResponse({
        currentUserId: "user-2",
        execSql,
        requestedCursor: "cursor-1",
        response: { ...firstResponse, currentUser: { isOrgAdmin: false } },
      }),
    ).resolves.toBe("already-applied");

    await expect(
      loadOrganizationReadModelProjection(execSql, "org-1", "user-1"),
    ).resolves.toMatchObject({ requester: { isOrgAdmin: true } });
    await expect(
      loadOrganizationReadModelProjection(execSql, "org-1", "user-2"),
    ).resolves.toMatchObject({
      cursor: "cursor-2",
      requester: { isOrgAdmin: false },
    });
  } finally {
    close();
  }
});

test("concurrent requester responses preserve both requester projections", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-read-model-concurrent-requesters-test",
  );

  try {
    await applyOrganizationReadModelResponse({
      currentUserId: "user-1",
      execSql,
      requestedCursor: null,
      response: snapshot("org-1", "cursor-1"),
    });
    const response = delta({
      groups: groups("org-1", "concurrent"),
      nextCursor: "cursor-2",
      organizationId: "org-1",
    });
    const results = await Promise.all([
      applyOrganizationReadModelResponse({
        currentUserId: "user-1",
        execSql,
        requestedCursor: "cursor-1",
        response,
      }),
      applyOrganizationReadModelResponse({
        currentUserId: "user-2",
        execSql,
        requestedCursor: "cursor-1",
        response: { ...response, currentUser: { isOrgAdmin: false } },
      }),
    ]);

    expect(results.sort()).toEqual(["already-applied", "applied"]);
    const [userOne, userTwo] = await Promise.all([
      loadOrganizationReadModelProjection(execSql, "org-1", "user-1"),
      loadOrganizationReadModelProjection(execSql, "org-1", "user-2"),
    ]);
    expect(userOne?.requester).toEqual({ isOrgAdmin: true });
    expect(userTwo?.requester).toEqual({ isOrgAdmin: false });
    expect(userOne?.groups).toEqual(groups("org-1", "concurrent"));
    expect(userTwo?.groups).toEqual(groups("org-1", "concurrent"));
  } finally {
    close();
  }
});

test("directory replacement prunes requester rows for inactive users", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-read-model-requester-prune-test",
  );

  try {
    await applyOrganizationReadModelResponse({
      currentUserId: "user-1",
      execSql,
      requestedCursor: null,
      response: snapshot("org-1", "cursor-1"),
    });
    const sharedDelta = delta({
      groups: groups("org-1", "next"),
      nextCursor: "cursor-2",
      organizationId: "org-1",
    });
    await applyOrganizationReadModelResponse({
      currentUserId: "user-1",
      execSql,
      requestedCursor: "cursor-1",
      response: sharedDelta,
    });
    await applyOrganizationReadModelResponse({
      currentUserId: "user-2",
      execSql,
      requestedCursor: "cursor-1",
      response: { ...sharedDelta, currentUser: { isOrgAdmin: false } },
    });
    await expect(
      loadOrganizationReadModelProjection(execSql, "org-1", "user-2"),
    ).resolves.toMatchObject({ requester: { isOrgAdmin: false } });
    await saveOrganizationDataUsageProjection({
      execSql,
      requesterUserId: "user-1",
      response: { ...dataUsage, organizationId: "org-1" },
    });
    await saveOrganizationDataUsageProjection({
      execSql,
      requesterUserId: "user-2",
      response: { ...dataUsage, organizationId: "org-1" },
    });

    // The authoritative directory now lists user-2 as disabled: the shared
    // rows survive, but user-2's requester row and usage projection must not.
    await applyOrganizationReadModelResponse({
      currentUserId: "user-1",
      execSql,
      requestedCursor: "cursor-2",
      response: delta({
        directory: directory("org-1", {
          users: [
            directoryUser("user-1", { isSelf: true }),
            directoryUser("user-2", { status: "disabled" }),
          ],
        }),
        nextCursor: "cursor-3",
        organizationId: "org-1",
      }),
    });

    const userTwo = await loadOrganizationReadModelProjection(
      execSql,
      "org-1",
      "user-2",
    );
    expect(userTwo?.requester).toBeNull();
    await expect(
      loadOrganizationDataUsageProjection(execSql, "org-1", "user-2"),
    ).resolves.toBeNull();
    await expect(
      loadOrganizationReadModelProjection(execSql, "org-1", "user-1"),
    ).resolves.toMatchObject({
      cursor: "cursor-3",
      requester: { isOrgAdmin: true },
    });
    await expect(
      loadOrganizationDataUsageProjection(execSql, "org-1", "user-1"),
    ).resolves.toMatchObject({ organizationId: "org-1" });
  } finally {
    close();
  }
});

test("a group-member load purge notifies invalidation subscribers", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-read-model-member-load-invalidation-test",
  );
  const invalidations: string[] = [];
  const unsubscribe = subscribeOrganizationReadModelInvalidation(
    execSql,
    (organizationId) => invalidations.push(organizationId),
  );

  try {
    await applyOrganizationReadModelResponse({
      currentUserId: "user-1",
      execSql,
      requestedCursor: null,
      response: snapshot("org-1", "cursor-1"),
    });
    await expect(
      loadOrganizationReadModelGroupMembers(
        execSql,
        "org-1",
        "admins-org-1",
        "user-1",
      ),
    ).resolves.not.toBeNull();
    expect(invalidations).toEqual([]);

    await execSql(
      `UPDATE organization_read_model_group_members
       SET state_hash = 'corrupt-state'
       WHERE organization_id = 'org-1'`,
    );
    await expect(
      loadOrganizationReadModelGroupMembers(
        execSql,
        "org-1",
        "admins-org-1",
        "user-1",
      ),
    ).resolves.toBeNull();
    expect(invalidations).toEqual(["org-1"]);
  } finally {
    unsubscribe();
    close();
  }
});
