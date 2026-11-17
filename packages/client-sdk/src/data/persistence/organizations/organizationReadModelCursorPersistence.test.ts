import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  organizationReadModelDelta as delta,
  organizationReadModelGroups as groups,
  organizationReadModelSnapshot as snapshot,
} from "../../../../test/helpers/data/organizationReadModelPersistenceFixtures";
import { OrganizationReadModelRepository } from "./organizationReadModelRepository";

test("another identity applying shared lanes does not make this requester current", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-read-model-applied-cursor-test",
  );
  const repository = new OrganizationReadModelRepository(execSql);
  const applied = (requesterUserId: string) =>
    repository.loadAppliedOrganizationReadModelCursor({
      organizationId: "org-1",
      requesterUserId,
    });

  try {
    await repository.applyOrganizationReadModelResponse({
      currentUserId: "user-1",
      requestedCursor: null,
      response: snapshot("org-1", "cursor-1"),
    });
    // Identity B records its own requester row at the same cursor.
    await repository.applyOrganizationReadModelResponse({
      currentUserId: "user-2",
      requestedCursor: null,
      response: delta({
        groups: groups("org-1", "initial"),
        nextCursor: "cursor-1",
        organizationId: "org-1",
      }),
    });
    expect(await applied("user-2")).toBe("cursor-1");

    // Identity A applies cursor N on the shared storage.
    const next = delta({
      groups: groups("org-1", "next"),
      nextCursor: "cursor-2",
      organizationId: "org-1",
    });
    await repository.applyOrganizationReadModelResponse({
      currentUserId: "user-1",
      requestedCursor: "cursor-1",
      response: next,
    });
    expect(await applied("user-1")).toBe("cursor-2");
    // Identity B's own requester fields are still from cursor-1, so a hint at
    // cursor-2 must still reconcile for B.
    expect(await applied("user-2")).toBeNull();

    await repository.applyOrganizationReadModelResponse({
      currentUserId: "user-2",
      requestedCursor: "cursor-1",
      response: { ...next, currentUser: { isOrgAdmin: false } },
    });
    expect(await applied("user-2")).toBe("cursor-2");
  } finally {
    close();
  }
});
