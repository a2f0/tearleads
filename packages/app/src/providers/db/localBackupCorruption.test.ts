import { expect, spyOn, test } from "bun:test";
import { createMemoryBlobStore } from "@tearleads/client-sdk";
import { createNativeTestExecSql } from "@tearleads/test-utils";
import { identityBackupTable } from "../../../test/helpers/principalBackupFixture";
import { unexpectedSecurityIncidents } from "../../../test/helpers/unexpectedSecurityIncidents";
import { createBackupPayload, restoreBackupPayload } from "./localBackupData";
import {
  quoteSqlIdentifier,
  readBackupDatabase,
  restoreBackupDatabase,
} from "./localBackupDatabase";

for (const [kind, currentProjection] of [
  ["invalid JSON", "{"],
  ["invalid shape", JSON.stringify({ privateData: "not a member list" })],
] as const) {
  test(`export diagnoses ${kind} as corruption without changing source data`, async () => {
    const source = createNativeTestExecSql();
    const blobStore = createMemoryBlobStore();
    try {
      const table = await identityBackupTable("principalPolicyBundles", {
        current_projection_json: currentProjection,
      });
      await source.execSql(table.sql);
      await source.execSql(
        `INSERT INTO ${quoteSqlIdentifier(table.name)} (${table.columns.map(quoteSqlIdentifier).join(", ")}) VALUES (${table.columns.map(() => "?").join(", ")})`,
        table.columns.map((column) => table.rows[0]?.[column] ?? null),
      );
      await source.execSql("CREATE TABLE sentinel (id TEXT PRIMARY KEY)");
      await source.execSql("INSERT INTO sentinel VALUES ('preserved')");
      await blobStore.writeBytes("existing", new Uint8Array([1, 2, 3]));
      const before = await readBackupDatabase({ execSql: source.execSql });
      const write = spyOn(blobStore, "writeBytes");
      const remove = spyOn(blobStore, "deleteBytes");
      const result = await createBackupPayload({
        blobStore,
        execSql: source.execSql,
        databaseId: null,
        signingFingerprint: null,
      }).catch((error: unknown) => error);
      expect(result).toBeInstanceOf(Error);
      expect(String(result)).toContain("invalid principal identity data");
      expect(String(result)).toContain("principal_policy_bundles");
      expect(String(result)).toContain("Preserve the source database");
      expect(String(result)).not.toMatch(/obsolete|reset|privateData/);
      expect(write).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
      expect(await blobStore.readBytes("existing")).toEqual(
        new Uint8Array([1, 2, 3]),
      );
      expect(await readBackupDatabase({ execSql: source.execSql })).toEqual(
        before,
      );
    } finally {
      source.close();
    }
  });

  for (const boundary of ["database", "payload"] as const) {
    test(`${boundary} rejects ${kind} before SQL/blob effects`, async () => {
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
        const table = await identityBackupTable("principalPolicyBundles", {
          current_projection_json: currentProjection,
        });
        const sql = spyOn(target, "execSql");
        const write = spyOn(blobStore, "writeBytes");
        const result =
          boundary === "database"
            ? restoreBackupDatabase({
                execSql: target.execSql,
                tables: [table],
                indexes: [],
              })
            : restoreBackupPayload({
                blobStore,
                execSql: target.execSql,
                securityIncidents: unexpectedSecurityIncidents,
                payload: {
                  ...payload,
                  database: { tables: [table], indexes: [] },
                  blobs: [
                    {
                      storageKey: "existing",
                      byteLength: 1,
                      bytesBase64: "CQ==",
                    },
                  ],
                },
              });
        await expect(result).rejects.toThrow("invalid principal identity data");
        expect(sql).not.toHaveBeenCalled();
        expect(write).not.toHaveBeenCalled();
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
