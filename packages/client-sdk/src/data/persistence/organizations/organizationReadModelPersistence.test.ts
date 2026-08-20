import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  organizationReadModelDelta as delta,
  organizationReadModelDirectory as directory,
  organizationReadModelDirectoryUser as directoryUser,
  organizationReadModelGroups as groups,
  organizationReadModelOrganizationPolicy as organizationPolicy,
  organizationReadModelSnapshot as snapshot,
} from "../../../../test/helpers/organizationReadModelPersistenceFixtures";
import { subscribeOrganizationReadModelInvalidation } from "./organizationReadModelInvalidation";
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
          organizationPolicy: organizationPolicy("org-1", "stale"),
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
    expect(afterGroups?.policyHeads).toEqual([
      {
        organizationId: "org-1",
        principalType: "group",
        principalId: "admins-org-1",
        stateHash: "state-next",
        version: 2,
        keyEpoch: 2,
        keyFingerprint: "key-fingerprint-next",
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
    ]);
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
          organizationPolicy: organizationPolicy("org-1", "next"),
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
    expect(
      afterDirectory?.policyHeads.find(
        (head) => head.principalType === "organization",
      ),
    ).toMatchObject({
      stateHash: "organization-state-next",
      keyFingerprint: "organization-key-fingerprint-next",
    });
  } finally {
    close();
  }
});

test("organization read-model reset snapshots replace both lanes and purge only one organization", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-read-model-purge-persistence-test",
  );

  try {
    const initialOrgOne = snapshot("org-1", "cursor-1");
    initialOrgOne.lanes.groups.groups.push({
      groupId: "stale-org-1",
      organizationId: "org-1",
      name: "Stale",
      createdAt: "2026-07-16T12:00:00.000Z",
      isBuiltin: false,
      currentState: {
        stateHash: "stale-state",
        version: 1,
        keyEpoch: 1,
        keyFingerprint: "stale-key",
        memberCount: 0,
      },
    });
    initialOrgOne.lanes.groupMemberships.groups.push({
      groupId: "stale-org-1",
      stateHash: "stale-state",
      members: [],
    });
    await applyOrganizationReadModelResponse({
      currentUserId: "user-1",
      execSql,
      requestedCursor: null,
      response: initialOrgOne,
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
    expect(
      resetProjection?.policyHeads.some(
        (head) => head.principalId === "stale-org-1",
      ),
    ).toBe(false);

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

    const wrongPolicyScope = snapshot("org-1", "cursor-wrong-policy-scope");
    await expect(
      applyOrganizationReadModelResponse({
        currentUserId: "user-1",
        execSql,
        requestedCursor: null,
        response: {
          ...wrongPolicyScope,
          lanes: {
            ...wrongPolicyScope.lanes,
            organizationPolicy: organizationPolicy("other-organization"),
          },
        },
      }),
    ).rejects.toThrow("policy response scope");

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

test("organization read-model persistence rejects v3 responses at runtime", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-read-model-protocol-version-test",
  );
  try {
    const initial = snapshot("org-1", "cursor-1");
    await applyOrganizationReadModelResponse({
      currentUserId: "user-1",
      execSql,
      requestedCursor: null,
      response: initial,
    });

    const versionThree = {
      ...delta({
        groups: groups("org-1", "v3"),
        nextCursor: "cursor-v3",
        organizationId: "org-1",
      }),
      version: 3,
    } as unknown as Parameters<
      typeof applyOrganizationReadModelResponse
    >[0]["response"];
    await expect(
      applyOrganizationReadModelResponse({
        currentUserId: "user-1",
        execSql,
        requestedCursor: "cursor-1",
        response: versionThree,
      }),
    ).rejects.toThrow("protocol version is unsupported");

    await expect(
      loadOrganizationReadModelProjection(execSql, "org-1", "user-1"),
    ).resolves.toMatchObject({
      cursor: "cursor-1",
      groups: initial.lanes.groups,
      protocolVersion: 6,
    });
  } finally {
    close();
  }
});

test("organization policy head and cursor roll back together on head failure", async () => {
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
      CREATE TRIGGER fail_organization_policy_head_insert
      BEFORE INSERT ON organization_read_model_policy_heads
      WHEN NEW.state_hash = 'organization-state-must-roll-back'
      BEGIN
        SELECT RAISE(ABORT, 'forced organization policy head insert failure');
      END
    `);
    await expect(
      applyOrganizationReadModelResponse({
        currentUserId: "user-1",
        execSql,
        requestedCursor: "cursor-1",
        response: delta({
          nextCursor: "cursor-2",
          organizationPolicy: organizationPolicy("org-1", "must-roll-back"),
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
    expect(
      projection?.policyHeads.find(
        (head) => head.principalType === "organization",
      ),
    ).toMatchObject({ stateHash: "organization-state-initial" });
  } finally {
    close();
  }
});

test("an inexact persisted policy head purges the projection on load", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-read-model-policy-head-binding-test",
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
    await execSql(
      `UPDATE organization_read_model_policy_heads
       SET state_hash = 'mismatched-state'
       WHERE organization_id = 'org-1' AND principal_type = 'group'`,
    );

    // Invalid stored rows self-heal: the load purges the projection so the
    // next reconcile requests a cursorless snapshot instead of failing every
    // read and repair pass on the same row, and notifies realtime consumers
    // that their caught-up lease no longer covers stored rows.
    expect(
      await loadOrganizationReadModelProjection(execSql, "org-1", "user-1"),
    ).toBeNull();
    expect(invalidations).toEqual(["org-1"]);
    const stateRows = await execSql(
      "SELECT COUNT(*) FROM organization_read_model_state WHERE organization_id = 'org-1'",
      undefined,
      { rowMode: "array" },
    );
    expect(stateRows[0]?.[0]).toBe(0);

    await applyOrganizationReadModelResponse({
      currentUserId: "user-1",
      execSql,
      requestedCursor: null,
      response: snapshot("org-1", "cursor-2"),
    });
    const reapplied = await loadOrganizationReadModelProjection(
      execSql,
      "org-1",
      "user-1",
    );
    expect(reapplied?.cursor).toBe("cursor-2");
    // A clean load does not notify.
    expect(invalidations).toEqual(["org-1"]);
  } finally {
    unsubscribe();
    close();
  }
});
