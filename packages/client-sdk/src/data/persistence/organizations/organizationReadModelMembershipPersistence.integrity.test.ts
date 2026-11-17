import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import type {
  OrganizationReadModelGroupMembershipsResponse,
  OrganizationReadModelSnapshotResponse,
} from "@tearleads/validators/response";
import {
  organizationReadModelSnapshot,
  organizationReadModelUserId,
} from "../../../../test/helpers/organizationReadModelProjectionFixtures";
import { OrganizationReadModelRepository } from "./organizationReadModelRepository";

function withMemberships(
  response: OrganizationReadModelSnapshotResponse,
  groupMemberships: OrganizationReadModelGroupMembershipsResponse,
): OrganizationReadModelSnapshotResponse {
  return {
    ...response,
    lanes: { ...response.lanes, groupMemberships },
  };
}

async function expectRejectedSnapshot(
  repository: OrganizationReadModelRepository,
  response: OrganizationReadModelSnapshotResponse,
  message: string,
): Promise<void> {
  await expect(
    repository.applyOrganizationReadModelResponse({
      currentUserId: organizationReadModelUserId,
      requestedCursor: null,
      response,
    }),
  ).rejects.toThrow(message);
  await expect(
    repository.loadOrganizationReadModelProjection(
      response.organizationId,
      organizationReadModelUserId,
    ),
  ).resolves.toBeNull();
}

test("membership snapshots require the reserved Members head", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-membership-missing-members-head",
  );
  const repository = new OrganizationReadModelRepository(execSql);
  const response = organizationReadModelSnapshot();
  const memberships = response.lanes.groupMemberships;
  try {
    await expectRejectedSnapshot(
      repository,
      withMemberships(response, {
        ...memberships,
        groups: memberships.groups.filter(
          (group) => group.groupId !== response.lanes.groups.memberGroupId,
        ),
      }),
      "Organization group membership coverage is inconsistent",
    );
  } finally {
    close();
  }
});

test("membership snapshots reject heads outside the group catalog", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-membership-extra-head",
  );
  const repository = new OrganizationReadModelRepository(execSql);
  const response = organizationReadModelSnapshot();
  const memberships = response.lanes.groupMemberships;
  try {
    await expectRejectedSnapshot(
      repository,
      withMemberships(response, {
        ...memberships,
        groups: [
          ...memberships.groups,
          { groupId: "unknown-group", stateHash: "unknown-state", members: [] },
        ],
      }),
      "Organization group membership coverage is inconsistent",
    );
  } finally {
    close();
  }
});

test("membership snapshots reject tombstones", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-membership-snapshot-tombstone",
  );
  const repository = new OrganizationReadModelRepository(execSql);
  const response = organizationReadModelSnapshot();
  try {
    await expectRejectedSnapshot(
      repository,
      withMemberships(response, {
        ...response.lanes.groupMemberships,
        deletedGroupIds: ["deleted-group"],
      }),
      "Organization membership snapshot contains deletions",
    );
  } finally {
    close();
  }
});

test("stateless catalog groups require no membership head", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-membership-stateless-group",
  );
  const repository = new OrganizationReadModelRepository(execSql);
  const response = organizationReadModelSnapshot();
  response.lanes.groups.groups.push({
    groupId: "stateless-group",
    organizationId: response.organizationId,

    createdAt: "2026-07-17T12:00:00.000Z",
    isBuiltin: false,
    currentState: null,
  });
  try {
    await expect(
      repository.applyOrganizationReadModelResponse({
        currentUserId: organizationReadModelUserId,
        requestedCursor: null,
        response,
      }),
    ).resolves.toBe("applied");
  } finally {
    close();
  }
});
