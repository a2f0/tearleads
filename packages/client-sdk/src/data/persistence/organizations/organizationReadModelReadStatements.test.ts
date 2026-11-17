import { expect, test } from "bun:test";
import { createNativeTestExecSql } from "@tearleads/test-utils";
import { organizationReadModelSnapshot } from "../../../../test/helpers/organizationReadModelPersistenceFixtures";
import { countingExecSql } from "../../../../test/helpers/statementCounting";
import { OrganizationReadModelRepository } from "./organizationReadModelRepository";

test("membership reads state and requester together and keeps requester scoping", async () => {
  const db = createNativeTestExecSql();
  const counted = countingExecSql(db.execSql);
  const repository = new OrganizationReadModelRepository(counted.execSql);
  try {
    await repository.applyOrganizationReadModelResponse({
      currentUserId: "user-1",
      requestedCursor: null,
      response: organizationReadModelSnapshot(
        "org-1",
        "cursor",
        "initial",
        false,
      ),
    });
    expect(
      await counted.count(async () => {
        expect(
          await repository.loadOrganizationReadModelGroupMembers(
            "org-1",
            "admins-org-1",
            "user-1",
          ),
        ).toMatchObject({ members: [{ userId: "user-1", role: "admin" }] });
      }),
    ).toBe(5);
    expect(
      await repository.loadOrganizationReadModelGroupMembers(
        "org-1",
        "admins-org-1",
        "other-user",
      ),
    ).toBeNull();
    expect(
      await repository.loadOrganizationReadModelGroupMembers(
        "missing-org",
        "admins-org-1",
        "user-1",
      ),
    ).toBeNull();
    expect(
      (await repository.loadOrganizationReadModelProjection("org-1", "user-1"))
        ?.requester,
    ).toEqual({ isOrgAdmin: false });
  } finally {
    db.close();
  }
});

test("projection reads its requester with its state without losing unbound projections", async () => {
  const db = createNativeTestExecSql();
  const counted = countingExecSql(db.execSql);
  const repository = new OrganizationReadModelRepository(counted.execSql);
  try {
    await repository.applyOrganizationReadModelResponse({
      currentUserId: "user-1",
      requestedCursor: null,
      response: organizationReadModelSnapshot("org-1", "cursor"),
    });
    expect(
      await counted.count(async () => {
        expect(
          await repository.loadOrganizationReadModelProjection(
            "org-1",
            "user-1",
          ),
        ).toMatchObject({ cursor: "cursor", requester: { isOrgAdmin: true } });
      }),
    ).toBe(7);
    expect(
      await repository.loadOrganizationReadModelProjection(
        "org-1",
        "other-user",
      ),
    ).toMatchObject({ cursor: "cursor", requester: null });
    expect(
      await repository.loadOrganizationReadModelProjection(
        "missing-org",
        "user-1",
      ),
    ).toBeNull();
  } finally {
    db.close();
  }
});
