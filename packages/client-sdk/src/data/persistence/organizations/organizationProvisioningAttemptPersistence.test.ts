import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { eq } from "drizzle-orm";
import { organizationProvisioningAttempts } from "../../sqlite/schema/organizationProvisioningAttemptSchema";
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import { createExecSql } from "../../sqlite/sqlSchema";
import { sqlOrganizationProvisioningAttemptPersistence } from "./organizationProvisioningAttemptPersistence";

test("obsolete provisioning storage requires reset without altering pending artifacts", async () => {
  const { close, execSql } = await createTestExecSql(
    "obsolete-organization-provisioning-attempt",
  );
  try {
    await execSql(`CREATE TABLE organization_provisioning_attempts (
      replaced_organization_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      organization_id TEXT NOT NULL,
      root_container_id TEXT NOT NULL,
      serialized_artifacts TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`);
    await execSql(
      "INSERT INTO organization_provisioning_attempts VALUES (?, ?, ?, ?, ?, ?)",
      ["source", "user", "organization", "root", "pending-artifacts", "now"],
    );
    await expect(
      sqlOrganizationProvisioningAttemptPersistence.load(execSql, "source"),
    ).rejects.toThrow(
      "Local database schema for organization_provisioning_attempts is obsolete; reset the local database before continuing",
    );
    expect(
      await execSql(
        "SELECT serialized_artifacts FROM organization_provisioning_attempts",
      ),
    ).toEqual([{ serialized_artifacts: "pending-artifacts" }]);
    expect(
      await execSql(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?",
        ["organization_provisioning_creation_intent_idx"],
      ),
    ).toEqual([]);
  } finally {
    close();
  }
});

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

test("independent clients claim one pending creation intent atomically", async () => {
  const { close, execSql } = await createTestExecSql(
    "concurrent-ordinary-intent",
  );
  const connection = () =>
    createExecSql({
      exec: async ({ sql, bind, rowMode }) => ({
        rows: await execSql(sql, bind, rowMode ? { rowMode } : undefined),
      }),
    });
  const candidate = () => {
    const organizationId = crypto.randomUUID();
    return {
      organizationId,
      replacedOrganizationId: organizationId,
      rootContainerId: crypto.randomUUID(),
      serializedArtifacts: "candidate-artifacts",
      userId: "creator",
      creationIntent: "same-whole-input",
    };
  };
  try {
    const [left, right] = await Promise.all([
      sqlOrganizationProvisioningAttemptPersistence.loadOrSave(
        connection(),
        candidate(),
      ),
      sqlOrganizationProvisioningAttemptPersistence.loadOrSave(
        connection(),
        candidate(),
      ),
    ]);
    expect(left?.organizationId).toBe(right?.organizationId);
    expect(
      await execSql(
        "SELECT organization_id FROM organization_provisioning_attempts",
      ),
    ).toHaveLength(1);
  } finally {
    close();
  }
});
