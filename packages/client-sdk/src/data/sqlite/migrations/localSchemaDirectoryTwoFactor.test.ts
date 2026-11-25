import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { organizationReadModelTables } from "../schema/organizationReadModelTableRegistry";
import { ensureSqlTables } from "../sqlSchema";
import { localSchemaMigrations } from "./localSchemaMigrations";
import { migrateLocalSchema } from "./migrateLocalSchema";

const CREATED_AT = "2026-11-25T00:00:00.000Z";

// The version-11 shape: the current table without the two-factor requirement.
const VERSION_11_DIRECTORY_USERS = `CREATE TABLE "organization_read_model_directory_users" (
  "organization_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL,
  "signing_key_fingerprint" TEXT NOT NULL,
  "encapsulation_key_fingerprint" TEXT NOT NULL,
  "is_personal_organization_owner" INTEGER NOT NULL,
  "created_at" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "profile_document_id" TEXT,
  "joined_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  "disabled_at" TEXT,
  "disabled_by_user_id" TEXT,
  "leave_request" TEXT,
  PRIMARY KEY ("organization_id", "user_id")
)`;

const VERSION_11_STEPS = localSchemaMigrations.filter(
  (migration) => migration.version <= 11,
);

test("step 12 reads a version-11 directory's members as not required", async () => {
  const { close, execSql } = await createTestExecSql(
    "local-schema-directory-two-factor",
  );
  try {
    await migrateLocalSchema(execSql, { migrations: VERSION_11_STEPS });
    await execSql(VERSION_11_DIRECTORY_USERS);
    await execSql(
      `INSERT INTO organization_read_model_directory_users (organization_id,
         user_id, sort_order, signing_key_fingerprint,
         encapsulation_key_fingerprint, is_personal_organization_owner,
         created_at, status, joined_at, updated_at)
       VALUES ('org', 'user', 0, 'signing', 'kem', 0, ?, 'active', ?, ?)`,
      [CREATED_AT, CREATED_AT, CREATED_AT],
    );

    expect((await migrateLocalSchema(execSql)).status).toBe("behind");

    expect(
      await execSql(
        "SELECT user_id, two_factor_required FROM organization_read_model_directory_users",
      ),
    ).toEqual([{ two_factor_required: 0, user_id: "user" }]);
    await ensureSqlTables(execSql, organizationReadModelTables);
  } finally {
    close();
  }
});

test("the current definition refuses a directory without the requirement", async () => {
  const { close, execSql } = await createTestExecSql(
    "local-schema-directory-two-factor-missing",
  );
  try {
    await migrateLocalSchema(execSql);
    await execSql(VERSION_11_DIRECTORY_USERS);

    await expect(
      ensureSqlTables(execSql, organizationReadModelTables),
    ).rejects.toThrow("obsolete");
  } finally {
    close();
  }
});
