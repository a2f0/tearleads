import { expect, test } from "bun:test";
import { validateBackupSchema } from "./backupSchemaValidation";

test.each([
  "CREATE TABLE \"notes\" (\"title\" TEXT DEFAULT '; -- it''s data') STRICT;",
  "/* schema */ CREATE TABLE IF NOT EXISTS [notes] (id TEXT PRIMARY KEY) WITHOUT ROWID; -- end",
  'CREATE TABLE `notes` ("a;""b" TEXT)',
])("accepts table definitions with SQLite quoting and comments: %s", (sql) => {
  expect(() =>
    validateBackupSchema({
      indexes: [],
      tables: [{ name: "notes", sql, columns: [], rows: [] }],
    }),
  ).not.toThrow();
});

test("accepts unique partial indexes", () => {
  expect(() =>
    validateBackupSchema({
      tables: [],
      indexes: [
        {
          name: "notes_idx",
          tableName: "notes",
          sql: 'CREATE UNIQUE INDEX "notes_idx" ON "notes" (title) WHERE title <> \';\';',
        },
      ],
    }),
  ).not.toThrow();
});

test.each([
  "CREATE TABLE notes (id TEXT); COMMIT; DELETE FROM trusted_user_identity_pins",
  "CREATE TABLE other (id TEXT)",
  "CREATE TABLE main.notes (id TEXT)",
  "CREATE TEMP TABLE notes (id TEXT)",
  "CREATE VIRTUAL TABLE notes USING fts5(id)",
  "CREATE TABLE notes AS SELECT * FROM trusted_user_identity_pins",
  "CREATE TABLE notes (id TEXT); /* comment */ DELETE FROM documents",
  "CREATE TABLE notes (id TEXT)\0; DELETE FROM documents",
  "CREATE TABLE notes (id TEXT DEFAULT 'unterminated)",
  "CREATE TABLE notes (id TEXT); /* unterminated",
])("rejects unsafe or mismatched table SQL: %s", (sql) => {
  expect(() =>
    validateBackupSchema({
      indexes: [],
      tables: [{ name: "notes", sql, columns: [], rows: [] }],
    }),
  ).toThrow("Backup schema");
});

test("rejects an index targeting a different table", () => {
  expect(() =>
    validateBackupSchema({
      tables: [],
      indexes: [
        {
          name: "notes_idx",
          tableName: "notes",
          sql: "CREATE INDEX notes_idx ON trusted_user_identity_pins(user_id)",
        },
      ],
    }),
  ).toThrow("Backup schema");
});
