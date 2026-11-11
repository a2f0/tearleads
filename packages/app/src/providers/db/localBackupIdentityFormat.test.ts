import { expect, spyOn, test } from "bun:test";
import { createMemoryBlobStore } from "@tearleads/client-sdk";
import {
  clientSQLiteSchema,
  defineSqlTableSchema,
} from "@tearleads/client-sdk/sqlite";
import { createNativeTestExecSql } from "@tearleads/test-utils";
import {
  backupProjection,
  identityBackupTable,
} from "../../../test/helpers/principalBackupFixture";
import { unexpectedSecurityIncidents } from "../../../test/helpers/unexpectedSecurityIncidents";
import { createBackupPayload, restoreBackupPayload } from "./localBackupData";
import {
  readBackupDatabase,
  restoreBackupDatabase,
} from "./localBackupDatabase";
import type { BackupPayload, BackupTable } from "./localBackupFormat";

async function obsoleteTable(): Promise<BackupTable> {
  const source = createNativeTestExecSql();
  try {
    const schema = defineSqlTableSchema(
      clientSQLiteSchema.principalPolicyBundles,
    );
    await source.execSql(
      schema.createSql.replace(
        /\s*"identity_bundle_format" INTEGER NOT NULL DEFAULT 1,?/,
        "",
      ),
    );
    const { tables } = await readBackupDatabase({ execSql: source.execSql });
    const table = tables[0];
    if (!table) throw new Error("Missing source table");
    return table;
  } finally {
    source.close();
  }
}

test("export refuses to relabel an obsolete source as a current backup", async () => {
  const source = createNativeTestExecSql();
  try {
    await source.execSql((await obsoleteTable()).sql);
    const before = await readBackupDatabase({ execSql: source.execSql });
    await expect(
      createBackupPayload({
        blobStore: createMemoryBlobStore(),
        execSql: source.execSql,
        databaseId: null,
        signingFingerprint: null,
      }),
    ).rejects.toThrow("obsolete principal identity format");
    expect(await readBackupDatabase({ execSql: source.execSql })).toEqual(
      before,
    );
  } finally {
    source.close();
  }
});

test("direct payload restore checks its version before SQL or blob writes", async () => {
  const target = createNativeTestExecSql();
  const blobStore = createMemoryBlobStore();
  try {
    const payload = await createBackupPayload({
      blobStore,
      execSql: target.execSql,
      databaseId: null,
      signingFingerprint: null,
    });
    const sql = spyOn(target, "execSql");
    const write = spyOn(blobStore, "writeBytes");
    await expect(
      restoreBackupPayload({
        blobStore,
        execSql: target.execSql,
        securityIncidents: unexpectedSecurityIncidents,
        payload: { ...payload, version: 16 } as unknown as BackupPayload,
      }),
    ).rejects.toThrow("Backup payload version is not supported");
    expect(sql).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  } finally {
    target.close();
  }
});

for (const boundary of ["database", "payload"] as const) {
  for (const corruption of [
    "old-schema",
    "old-projection",
    "folded-alias",
    "missing-column",
    "extra-column",
    "wrong-column",
    "undeclared-marker",
  ] as const) {
    test(`${boundary} rejects ${corruption} before any SQL/blob effects`, async () => {
      const target = createNativeTestExecSql();
      const blobStore = createMemoryBlobStore();
      try {
        await target.execSql("CREATE TABLE sentinel (id TEXT PRIMARY KEY)");
        await target.execSql("INSERT INTO sentinel VALUES ('preserved')");
        await blobStore.writeBytes("existing", new Uint8Array([1, 2, 3]));
        const before = await readBackupDatabase({ execSql: target.execSql });
        const payload = await createBackupPayload({
          blobStore,
          execSql: target.execSql,
          databaseId: null,
          signingFingerprint: null,
        });
        const legacy = JSON.stringify(
          backupProjection.map(({ userId, role }) => ({ userId, role })),
        );
        let table =
          corruption === "old-schema"
            ? await obsoleteTable()
            : await identityBackupTable("principalPolicyBundles");
        if (corruption === "old-projection")
          table = {
            ...table,
            rows: table.rows.map((row) => ({
              ...row,
              current_projection_json: legacy,
            })),
          };
        if (corruption === "folded-alias")
          table = {
            ...table,
            columns: ["CURRENT_PROJECTION_JSON", ...table.columns],
            rows: table.rows.map((row) => ({
              CURRENT_PROJECTION_JSON: legacy,
              ...row,
            })),
          };
        if (corruption === "missing-column")
          table = {
            ...table,
            columns: table.columns.filter((column) => column !== "updated_at"),
          };
        if (corruption === "extra-column")
          table = { ...table, columns: [...table.columns, "extra"] };
        if (corruption === "wrong-column")
          table = {
            ...table,
            columns: table.columns.map((column) =>
              column === "updated_at" ? "extra" : column,
            ),
          };
        if (corruption === "undeclared-marker")
          table = {
            ...table,
            sql: table.sql.replace(
              /\s*"identity_bundle_format" INTEGER NOT NULL DEFAULT 1,?/,
              "",
            ),
          };
        if (corruption === "missing-column" || corruption === "wrong-column")
          table = {
            ...table,
            sql: table.sql.replace(
              '"updated_at" TEXT NOT NULL',
              `"updated_at" TEXT NOT NULL DEFAULT 'fallback'`,
            ),
          };
        const tables = [table];
        const write = spyOn(blobStore, "writeBytes");
        const sql = spyOn(target, "execSql");
        const result =
          boundary === "database"
            ? restoreBackupDatabase({
                execSql: target.execSql,
                tables,
                indexes: [],
              })
            : restoreBackupPayload({
                blobStore,
                execSql: target.execSql,
                securityIncidents: unexpectedSecurityIncidents,
                payload: {
                  ...payload,
                  database: { tables, indexes: [] },
                  blobs: [
                    {
                      storageKey: "existing",
                      byteLength: 1,
                      bytesBase64: "CQ==",
                    },
                  ],
                },
              });
        await expect(result).rejects.toThrow(
          "obsolete principal identity format",
        );
        expect(write).not.toHaveBeenCalled();
        expect(sql).not.toHaveBeenCalled();
        expect(await blobStore.readBytes("existing")).toEqual(
          new Uint8Array([1, 2, 3]),
        );
        expect(await readBackupDatabase({ execSql: target.execSql })).toEqual(
          before,
        );
      } finally {
        target.close();
      }
    });
  }
}
