import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { eq } from "drizzle-orm";
import { organizationProvisioningAttempts } from "../../sqlite/organizationProvisioningAttemptSchema";
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import { sqlOrganizationProvisioningAttemptPersistence } from "./organizationProvisioningAttemptPersistence";

test("restore completion cannot delete a newer organization attempt", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-provisioning-attempt-remove-test",
  );
  const attemptKey = "native-subscription-restore:user";
  const newerOrganizationId = crypto.randomUUID();
  try {
    await sqlOrganizationProvisioningAttemptPersistence.loadOrSave(execSql, {
      organizationId: newerOrganizationId,
      replacedOrganizationId: attemptKey,
      rootContainerId: crypto.randomUUID(),
      serializedArtifacts: "newer-artifacts",
      userId: "user",
    });

    await sqlOrganizationProvisioningAttemptPersistence.remove(execSql, {
      organizationId: crypto.randomUUID(),
      replacedOrganizationId: attemptKey,
      userId: "user",
    });

    const [retained] = await getClientSQLitePersistenceRuntime(execSql)
      .db.select()
      .from(organizationProvisioningAttempts)
      .where(
        eq(organizationProvisioningAttempts.replacedOrganizationId, attemptKey),
      );
    expect(retained?.organizationId).toBe(newerOrganizationId);
  } finally {
    close();
  }
});
