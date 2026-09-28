import { expect, mock, test } from "bun:test";
import { createNativeTestExecSql } from "@tearleads/test-utils";
import {
  createInternalRuntimeFixture,
  createWorkflowInputFixture,
} from "../../test/helpers/internalRuntimeFixtures";
import { clearDocumentDiscoveryEvidenceOnRemoteReset } from "../data/persistence/documents/documentDiscoveryReset";
import { clientSqlTables, containers } from "../data/sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../data/sqlite/sqlitePersistenceRuntime";
import { createExecSql, ensureSqlTables } from "../data/sqlite/sqlSchema";
import { discoverContainerDocumentsForRuntime } from "./containerDocumentDiscovery";

for (const mode of ["stored", "missing", "reset during scope read"] as const) {
  test(`runtime discovery reads durable organization scope (${mode})`, async () => {
    const native = createNativeTestExecSql();
    try {
      await ensureSqlTables(native.execSql, clientSqlTables);
      const runtime = getClientSQLitePersistenceRuntime(native.execSql);
      if (mode !== "missing")
        await runtime.db.insert(containers).values({
          id: "container",
          organizationId: "org",
          parentId: null,
          metadataDocumentId: "metadata",
          localCreatedAt: "2026-09-28",
          localUpdatedAt: "2026-09-28",
        });
      let scopeRead = false;
      const execSql = createExecSql({
        exec: async ({ sql, bind, rowMode }) => {
          const rows = await native.execSql(
            sql,
            bind,
            rowMode ? { rowMode } : undefined,
          );
          if (!scopeRead && sql.includes('from "containers"')) {
            scopeRead = true;
            if (mode === "reset during scope read")
              await runtime.db.transaction((tx) =>
                clearDocumentDiscoveryEvidenceOnRemoteReset(tx, {
                  containerIds: ["container"],
                  documentIds: [],
                }),
              );
          }
          return { rows };
        },
      });
      const list = mock(async () => ({
        items: [],
        tombstones: [],
        hasMore: false,
        nextWatermark: { id: "document", updatedAt: "2026-09-28" },
      }));
      const input = createWorkflowInputFixture({
        apiClient: { listContainerDocuments: list } as never,
        execSql,
      });
      const onFullListing = mock(() => {});
      const onPendingDiscovery = mock(() => {});
      const result = await discoverContainerDocumentsForRuntime({
        containerId: "container",
        runtimeService: createInternalRuntimeFixture(() => input),
        onFullListing,
        onPendingDiscovery,
      });
      expect(scopeRead).toBe(true);
      expect(list).toHaveBeenCalledTimes(mode === "missing" ? 0 : 1);
      expect(onFullListing).toHaveBeenCalledTimes(mode === "stored" ? 1 : 0);
      expect(result).toEqual(mode === "stored" ? [] : null);
      expect(onPendingDiscovery).not.toHaveBeenCalled();
    } finally {
      native.close();
    }
  });
}
