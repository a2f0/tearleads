import { expect, test } from "bun:test";
import { createNativeTestExecSql } from "@tearleads/test-utils";
import { ensureSqlTables } from "../sqlTableSchema";
import { clientSqlTables } from "./index";

const identityTables = [
  "principal_policy_bundles",
  "principal_history_prefixes",
  "principal_history_entries",
  "principal_history_stages",
  "principal_mutation_journal",
  "organization_provisioning_attempts",
];

test.each(identityTables)(
  "obsolete %s refuses before changing any live schema or pins",
  async (name) => {
    const { close, execSql } = createNativeTestExecSql();
    try {
      const table = clientSqlTables.find(
        (candidate) => candidate.name === name,
      );
      if (!table) throw new Error(`Missing table ${name}`);
      await execSql(
        table.createSql.replace(
          /\s*"identity_bundle_format" INTEGER NOT NULL DEFAULT 1,?/,
          "",
        ),
      );
      await execSql("CREATE TABLE identity_pins (fingerprint TEXT NOT NULL)");
      await execSql("INSERT INTO identity_pins VALUES ('preserved-pin')");
      const before = await execSql(
        "SELECT name, sql FROM sqlite_master ORDER BY name",
      );
      await expect(ensureSqlTables(execSql, clientSqlTables)).rejects.toThrow(
        `Local database schema for ${name} is obsolete; reset the local database before continuing`,
      );
      expect(
        await execSql("SELECT name, sql FROM sqlite_master ORDER BY name"),
      ).toEqual(before);
      expect(await execSql("SELECT * FROM identity_pins")).toEqual([
        { fingerprint: "preserved-pin" },
      ]);
    } finally {
      close();
    }
  },
);

test("live format checks follow SQLite identifier case folding", async () => {
  const { close, execSql } = createNativeTestExecSql();
  try {
    const table = clientSqlTables.find(
      (candidate) => candidate.name === "principal_mutation_journal",
    );
    if (!table) throw new Error("Missing journal table");
    await execSql(
      table.createSql.replace(
        '"identity_bundle_format"',
        '"IDENTITY_BUNDLE_FORMAT"',
      ),
    );
    await expect(ensureSqlTables(execSql, [table])).resolves.toBeUndefined();
  } finally {
    close();
  }
});

test("fresh principal tables use the identity-bundle format without rewriting pins", async () => {
  const { close, execSql } = createNativeTestExecSql();
  try {
    await ensureSqlTables(execSql, clientSqlTables);
    for (const name of identityTables) {
      expect(
        await execSql(
          `SELECT name, dflt_value FROM pragma_table_info('${name}') WHERE name = 'identity_bundle_format'`,
        ),
      ).toEqual([{ name: "identity_bundle_format", dflt_value: "1" }]);
    }
  } finally {
    close();
  }
});
