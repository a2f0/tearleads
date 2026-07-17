import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  organizationReadModelDelta as delta,
  organizationReadModelDirectory as directory,
  organizationReadModelDirectoryUser as directoryUser,
  organizationReadModelGroups as groups,
  organizationReadModelSnapshot as snapshot,
} from "../../../../test/helpers/organizationReadModelPersistenceFixtures";
import {
  applyOrganizationReadModelResponse,
  loadOrganizationReadModelProjection,
  purgeOrganizationReadModelProjection,
} from "./organizationReadModelPersistence";

test("organization read-model deltas replace only supplied lanes and reject stale application", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-read-model-delta-persistence-test",
  );

  try {
    const initial = snapshot("org-1", "cursor-1");
    await applyOrganizationReadModelResponse({
      currentUserId: "user-1",
      execSql,
      requestedCursor: null,
      response: initial,
    });

    const groupsDelta = delta({
      groups: groups("org-1", "next"),
      nextCursor: "cursor-2",
      organizationId: "org-1",
    });
    await expect(
      applyOrganizationReadModelResponse({
        currentUserId: "user-1",
        execSql,
        requestedCursor: "cursor-1",
        response: groupsDelta,
      }),
    ).resolves.toBe("applied");
    await expect(
      applyOrganizationReadModelResponse({
        currentUserId: "user-1",
        execSql,
        requestedCursor: "cursor-1",
        response: groupsDelta,
      }),
    ).resolves.toBe("already-applied");

    const staleDirectory = directory("org-1", {
      profileDocumentId: "must-not-apply",
      users: [],
    });
    await expect(
      applyOrganizationReadModelResponse({
        currentUserId: "user-1",
        execSql,
        requestedCursor: "cursor-1",
        response: delta({
          directory: staleDirectory,
          isOrgAdmin: false,
          nextCursor: "cursor-3",
          organizationId: "org-1",
        }),
      }),
    ).resolves.toBe("stale");

    const afterGroups = await loadOrganizationReadModelProjection(
      execSql,
      "org-1",
      "user-1",
    );
    expect(afterGroups?.cursor).toBe("cursor-2");
    expect(afterGroups?.directory).toEqual({
      organizationId: "org-1",
      profileDocumentId: initial.lanes.directory.profileDocumentId,
      users: [
        expect.objectContaining({ userId: "user-1" }),
        expect.objectContaining({ userId: "user-2" }),
      ],
    });
    expect(afterGroups?.groups).toEqual(groups("org-1", "next"));
    expect(afterGroups?.requester).toEqual({ isOrgAdmin: true });

    const nextDirectory = directory("org-1", {
      profileDocumentId: "organization-profile-next",
      users: [directoryUser("user-1", { isSelf: true })],
    });
    await expect(
      applyOrganizationReadModelResponse({
        currentUserId: "user-1",
        execSql,
        requestedCursor: "cursor-2",
        response: delta({
          directory: nextDirectory,
          isOrgAdmin: false,
          nextCursor: "cursor-3",
          organizationId: "org-1",
        }),
      }),
    ).resolves.toBe("applied");

    const afterDirectory = await loadOrganizationReadModelProjection(
      execSql,
      "org-1",
      "user-1",
    );
    expect(afterDirectory?.cursor).toBe("cursor-3");
    expect(afterDirectory?.directory.profileDocumentId).toBe(
      "organization-profile-next",
    );
    expect(afterDirectory?.requester).toEqual({ isOrgAdmin: false });
    expect(afterDirectory?.groups).toEqual(groups("org-1", "next"));
  } finally {
    close();
  }
});

test("organization read-model reset snapshots replace both lanes and purge only one organization", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-read-model-purge-persistence-test",
  );

  try {
    await applyOrganizationReadModelResponse({
      currentUserId: "user-1",
      execSql,
      requestedCursor: null,
      response: snapshot("org-1", "cursor-1"),
    });
    await applyOrganizationReadModelResponse({
      currentUserId: "user-1",
      execSql,
      requestedCursor: null,
      response: snapshot("org-2", "cursor-a"),
    });

    const reset = snapshot("org-1", "cursor-2", "reset");
    reset.lanes.directory.users.splice(
      0,
      reset.lanes.directory.users.length,
      directoryUser("user-reset"),
    );
    await expect(
      applyOrganizationReadModelResponse({
        currentUserId: "user-1",
        execSql,
        requestedCursor: "cursor-1",
        response: reset,
      }),
    ).resolves.toBe("applied");
    const resetProjection = await loadOrganizationReadModelProjection(
      execSql,
      "org-1",
      "user-1",
    );
    expect(resetProjection?.directory.users).toEqual([
      expect.objectContaining({ userId: "user-reset" }),
    ]);
    expect(resetProjection?.groups).toEqual(groups("org-1", "reset"));

    await purgeOrganizationReadModelProjection(execSql, "org-1");
    await expect(
      loadOrganizationReadModelProjection(execSql, "org-1", "user-1"),
    ).resolves.toBeNull();
    await expect(
      loadOrganizationReadModelProjection(execSql, "org-2", "user-1"),
    ).resolves.toMatchObject({ cursor: "cursor-a", organizationId: "org-2" });
  } finally {
    close();
  }
});

test("organization read-model persistence rejects requester flag and duplicate ID ambiguity", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-read-model-validation-persistence-test",
  );

  try {
    const wrongRequester = snapshot("org-1", "cursor-wrong-requester");
    const self = wrongRequester.lanes.directory.users[0];
    if (!self) {
      throw new Error("Expected a self directory fixture");
    }
    self.isSelf = false;
    await expect(
      applyOrganizationReadModelResponse({
        currentUserId: "user-1",
        execSql,
        requestedCursor: null,
        response: wrongRequester,
      }),
    ).rejects.toThrow("requester flags");

    const duplicateDirectory = snapshot("org-1", "cursor-duplicate-user");
    const duplicateUser = duplicateDirectory.lanes.directory.users[0];
    if (!duplicateUser) {
      throw new Error("Expected a directory fixture");
    }
    duplicateDirectory.lanes.directory.users.push({ ...duplicateUser });
    await expect(
      applyOrganizationReadModelResponse({
        currentUserId: "user-1",
        execSql,
        requestedCursor: null,
        response: duplicateDirectory,
      }),
    ).rejects.toThrow("duplicate IDs");

    const duplicateGroups = snapshot("org-1", "cursor-duplicate-group");
    const duplicateGroup = duplicateGroups.lanes.groups.groups[0];
    if (!duplicateGroup) {
      throw new Error("Expected a group fixture");
    }
    duplicateGroups.lanes.groups.groups.push({ ...duplicateGroup });
    await expect(
      applyOrganizationReadModelResponse({
        currentUserId: "user-1",
        execSql,
        requestedCursor: null,
        response: duplicateGroups,
      }),
    ).rejects.toThrow("duplicate IDs");
  } finally {
    close();
  }
});

test("organization read-model response and cursor roll back together on lane failure", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-read-model-atomic-persistence-test",
  );

  try {
    await applyOrganizationReadModelResponse({
      currentUserId: "user-1",
      execSql,
      requestedCursor: null,
      response: snapshot("org-1", "cursor-1"),
    });

    await execSql(`
      CREATE TRIGGER fail_organization_directory_insert
      BEFORE INSERT ON organization_read_model_directory_users
      WHEN NEW.user_id = 'fail-user'
      BEGIN
        SELECT RAISE(ABORT, 'forced organization directory insert failure');
      END
    `);
    const failingDirectory = directory("org-1", {
      profileDocumentId: "must-roll-back",
      users: [directoryUser("fail-user")],
    });
    await expect(
      applyOrganizationReadModelResponse({
        currentUserId: "user-1",
        execSql,
        requestedCursor: "cursor-1",
        response: delta({
          directory: failingDirectory,
          nextCursor: "cursor-2",
          organizationId: "org-1",
        }),
      }),
    ).rejects.toThrow();

    const projection = await loadOrganizationReadModelProjection(
      execSql,
      "org-1",
      "user-1",
    );
    expect(projection?.cursor).toBe("cursor-1");
    expect(projection?.directory.profileDocumentId).toBe(
      "organization-profile-org-1",
    );
    expect(projection?.directory.users.map((user) => user.userId)).toEqual([
      "user-1",
      "user-2",
    ]);
  } finally {
    close();
  }
});
