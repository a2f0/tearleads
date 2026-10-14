import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { subscribeOrganizationReadModelInvalidation } from "../../data/persistence/organizations/organizationReadModelInvalidation";
import { clearRemoteSyncState } from "./remoteReset";

test("a remote sync reset invalidates the organization's read-model consumers", async () => {
  const { close, execSql } = await createTestExecSql(
    "remote-reset-read-model-invalidation",
  );
  const invalidated: string[] = [];
  const unsubscribe = subscribeOrganizationReadModelInvalidation(
    execSql,
    (organizationId) => invalidated.push(organizationId),
  );
  try {
    await clearRemoteSyncState(execSql, { organizationId: "org-reset" });
    expect(invalidated).toEqual(["org-reset"]);
  } finally {
    unsubscribe();
    close();
  }
});
