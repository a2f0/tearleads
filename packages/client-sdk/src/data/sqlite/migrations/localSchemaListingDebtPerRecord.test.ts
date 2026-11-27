import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { DocumentListingRevalidationRepository } from "../../persistence/documents/documentListingRevalidationRepository";
import { documentTables } from "../schema/documentRecordSchema";
import { ensureSqlTables } from "../sqlSchema";
import { localSchemaMigrations } from "./localSchemaMigrations";
import { migrateLocalSchema } from "./migrateLocalSchema";

const AT = "2026-11-25T00:00:00.000Z";

const VERSION_15_STEPS = localSchemaMigrations.filter(
  (migration) => migration.version <= 15,
);

test("step 16 passes each document's debt to every record of it", async () => {
  const { close, execSql } = await createTestExecSql(
    "local-schema-listing-debt-per-record",
  );
  try {
    await migrateLocalSchema(execSql, { migrations: VERSION_15_STEPS });
    // The version-15 debt table, keyed by document, beside the records that
    // hold those documents. Creating them through their ensures would
    // migrate the database first.
    await execSql(`CREATE TABLE "document_listing_revalidations" (
      "document_id" TEXT NOT NULL PRIMARY KEY,
      "advertised_update_count" INTEGER NOT NULL,
      "revision" TEXT NOT NULL,
      "requested_at" TEXT NOT NULL)`);
    await execSql(`CREATE TABLE "documents" (
      "app_kind" TEXT NOT NULL, "local_id" TEXT NOT NULL,
      "document_id" TEXT, PRIMARY KEY ("app_kind", "local_id"))`);
    await execSql(
      `INSERT INTO documents VALUES
       ('documents', 'owner', 'doc'),
       ('documents', 'displaced', 'doc'),
       ('container-metadata', 'folder', 'unheld')`,
    );
    await execSql(
      `INSERT INTO document_listing_revalidations VALUES
       ('doc', 4, 'revision-1', ?),
       ('unheld', 2, 'revision-2', ?)`,
      [AT, AT],
    );

    expect((await migrateLocalSchema(execSql)).status).toBe("behind");

    expect(
      await execSql(
        `SELECT local_id, document_id, advertised_update_count,
                advertised_access_epoch, revision, requested_at
           FROM document_listing_revalidations ORDER BY local_id`,
      ),
    ).toEqual(
      ["displaced", "owner"].map((localId) => ({
        // No old row kept a head: epoch 0 is one any key bundle carries.
        advertised_access_epoch: 0,
        advertised_update_count: 4,
        document_id: "doc",
        local_id: localId,
        requested_at: AT,
        revision: "revision-1",
      })),
    );
    // The migrated table is the shape the current definition checks.
    await execSql("DROP TABLE documents");
    await ensureSqlTables(execSql, documentTables);
    expect(
      await new DocumentListingRevalidationRepository(execSql).listOwed(),
    ).toEqual([
      { documentId: "doc", localId: "displaced" },
      { documentId: "doc", localId: "owner" },
    ]);
  } finally {
    close();
  }
});

test("step 16 skips a database that never owed a listing read", async () => {
  const { close, execSql } = await createTestExecSql(
    "local-schema-listing-debt-absent",
  );
  try {
    await migrateLocalSchema(execSql, { migrations: VERSION_15_STEPS });

    expect((await migrateLocalSchema(execSql)).status).toBe("behind");
    await ensureSqlTables(execSql, documentTables);
  } finally {
    close();
  }
});
