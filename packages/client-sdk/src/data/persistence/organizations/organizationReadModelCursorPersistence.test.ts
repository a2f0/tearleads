import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  organizationReadModelDelta as delta,
  organizationReadModelGroups as groups,
  organizationReadModelSnapshot as snapshot,
} from "../../../../test/helpers/organizationReadModelPersistenceFixtures";
import { loadAppliedOrganizationReadModelCursor } from "./organizationReadModelCursorPersistence";
import { applyOrganizationReadModelResponse } from "./organizationReadModelPersistence";

test("another identity applying shared lanes does not make this requester current", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-read-model-applied-cursor-test",
  );
  const applied = (requesterUserId: string) =>
    loadAppliedOrganizationReadModelCursor({
      execSql,
      organizationId: "org-1",
      requesterUserId,
    });

  try {
    await applyOrganizationReadModelResponse({
      currentUserId: "user-1",
      execSql,
      requestedCursor: null,
      response: snapshot("org-1", "cursor-1"),
    });
    // Identity B records its own requester row at the same cursor.
    await applyOrganizationReadModelResponse({
      currentUserId: "user-2",
      execSql,
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
    await applyOrganizationReadModelResponse({
      currentUserId: "user-1",
      execSql,
      requestedCursor: "cursor-1",
      response: next,
    });
    expect(await applied("user-1")).toBe("cursor-2");
    // Identity B's own requester fields are still from cursor-1, so a hint at
    // cursor-2 must still reconcile for B.
    expect(await applied("user-2")).toBeNull();

    await applyOrganizationReadModelResponse({
      currentUserId: "user-2",
      execSql,
      requestedCursor: "cursor-1",
      response: { ...next, currentUser: { isOrgAdmin: false } },
    });
    expect(await applied("user-2")).toBe("cursor-2");
  } finally {
    close();
  }
});
