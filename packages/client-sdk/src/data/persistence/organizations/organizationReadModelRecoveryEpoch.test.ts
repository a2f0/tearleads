import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  organizationReadModelDelta as delta,
  organizationReadModelGroups as groups,
  organizationReadModelSnapshot as snapshot,
} from "../../../../test/helpers/organizationReadModelPersistenceFixtures";
import { getOrCreatePrincipalPolicyCoordinator } from "../../principals/principalPolicyCoordinator";
import { purgeOrganizationAccessProjection } from "./organizationAccessRevocationPersistence";
import { applyOrganizationReadModelResponse } from "./organizationReadModelPersistence";

test("an applied organization read-model change evicts in-flight principal recovery", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-read-model-recovery-epoch-test",
  );
  try {
    expect(
      getOrCreatePrincipalPolicyCoordinator(execSql).recoveryEpoch("org-1"),
    ).toBe(0);
    await applyOrganizationReadModelResponse({
      currentUserId: "user-1",
      execSql,
      requestedCursor: null,
      response: snapshot("org-1", "cursor-1"),
    });
    expect(
      getOrCreatePrincipalPolicyCoordinator(execSql).recoveryEpoch("org-1"),
    ).toBe(1);
    const change = delta({
      groups: groups("org-1", "next"),
      nextCursor: "cursor-2",
      organizationId: "org-1",
    });
    await applyOrganizationReadModelResponse({
      currentUserId: "user-1",
      execSql,
      requestedCursor: "cursor-1",
      response: change,
    });
    expect(
      getOrCreatePrincipalPolicyCoordinator(execSql).recoveryEpoch("org-1"),
    ).toBe(2);
    // A replayed response changes nothing and keeps the operation's memo.
    await expect(
      applyOrganizationReadModelResponse({
        currentUserId: "user-1",
        execSql,
        requestedCursor: "cursor-1",
        response: change,
      }),
    ).resolves.toBe("already-applied");
    expect(
      getOrCreatePrincipalPolicyCoordinator(execSql).recoveryEpoch("org-1"),
    ).toBe(2);
    expect(
      getOrCreatePrincipalPolicyCoordinator(execSql).recoveryEpoch("org-2"),
    ).toBe(0);
    await purgeOrganizationAccessProjection({
      execSql,
      organizationId: "org-1",
      requesterUserId: "user-1",
    });
    expect(
      getOrCreatePrincipalPolicyCoordinator(execSql).recoveryEpoch("org-1"),
    ).toBe(3);
  } finally {
    close();
  }
});
