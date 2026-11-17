import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { organizationReadModelTables } from "../schema";
import { ensureSqlTables } from "../sqlSchema";
import { migrateLocalSchema } from "./migrateLocalSchema";

const CREATED_AT = "2026-11-01T00:00:00.000Z";

// The version-1 shape, as the table definition created it before step 2.
const VERSION_1_DIRECTORY_USERS = `CREATE TABLE "organization_read_model_directory_users" (
  "organization_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL,
  "signing_key_fingerprint" TEXT NOT NULL,
  "signing_public_key" TEXT NOT NULL,
  "encapsulation_public_key" TEXT NOT NULL,
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

test("step 2 drops the directory rows' public keys and keeps the rows", async () => {
  const { close, execSql } = await createTestExecSql(
    "local-schema-directory-keys",
  );
  try {
    await execSql(VERSION_1_DIRECTORY_USERS);
    await execSql(
      `INSERT INTO organization_read_model_directory_users VALUES
        ('organization', 'user', 0, 'signing-fingerprint', 'signing-key',
         'encapsulation-key', 'encapsulation-fingerprint', 0, ?, 'active',
         NULL, ?, ?, NULL, NULL, NULL)`,
      [CREATED_AT, CREATED_AT, CREATED_AT],
    );

    const state = await migrateLocalSchema(execSql);
    expect(state.status).toBe("legacy");

    const columns = (
      await execSql(
        "SELECT name FROM pragma_table_info('organization_read_model_directory_users')",
      )
    ).map(({ name }) => String(name));
    expect(columns).not.toContain("signing_public_key");
    expect(columns).not.toContain("encapsulation_public_key");
    expect(columns).toContain("signing_key_fingerprint");
    expect(
      await execSql(
        "SELECT user_id, signing_key_fingerprint, encapsulation_key_fingerprint FROM organization_read_model_directory_users",
      ),
    ).toEqual([
      {
        encapsulation_key_fingerprint: "encapsulation-fingerprint",
        signing_key_fingerprint: "signing-fingerprint",
        user_id: "user",
      },
    ]);
    // The migrated table is the shape the current definition writes.
    await ensureSqlTables(execSql, organizationReadModelTables);
    await execSql(
      `INSERT INTO organization_read_model_directory_users
        (organization_id, user_id, sort_order, signing_key_fingerprint,
         encapsulation_key_fingerprint, is_personal_organization_owner,
         created_at, status, joined_at, updated_at)
       VALUES ('organization', 'peer', 1, 's', 'e', 0, ?, 'active', ?, ?)`,
      [CREATED_AT, CREATED_AT, CREATED_AT],
    );
  } finally {
    close();
  }
});

test("step 2 skips a database that never created the directory table", async () => {
  const { close, execSql } = await createTestExecSql(
    "local-schema-directory-keys-absent",
  );
  try {
    await execSql('CREATE TABLE "other" ("id" TEXT PRIMARY KEY)');
    expect((await migrateLocalSchema(execSql)).status).toBe("legacy");
    await ensureSqlTables(execSql, organizationReadModelTables);
  } finally {
    close();
  }
});
