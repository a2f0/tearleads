import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  organizationReadModelDelta as delta,
  organizationReadModelGroups as groups,
  organizationReadModelSnapshot as snapshot,
} from "../../../../test/helpers/organizationReadModelPersistenceFixtures";
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
      groups: groups("org-1"),
      organizationId: "org-1",
      protocolVersion: 2,
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
