import { expect, mock, test } from "bun:test";
import { createNativeTestExecSql } from "@tearleads/test-utils";
import {
  createInternalRuntimeFixture,
  createWorkflowInputFixture,
} from "../../../test/helpers/internalRuntimeFixtures";
import { clearDocumentDiscoveryEvidenceOnRemoteReset } from "../../data/persistence/documents/documentDiscoveryReset";
import { clientSqlTables, containers } from "../../data/sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../data/sqlite/sqlitePersistenceRuntime";
import { createExecSql, ensureSqlTables } from "../../data/sqlite/sqlSchema";
import { laneApi } from "../../workflows/container-contents/documentDiscovery.testUtils";
import {
  discoverContainerDocumentLanesForRuntime,
  discoverContainerDocumentsForRuntime,
} from "./documentDiscovery";

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
        apiClient: laneApi(list) as never,
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

test("runtime discovery lists every stored lane in one request", async () => {
  const native = createNativeTestExecSql();
  try {
    await ensureSqlTables(native.execSql, clientSqlTables);
    const runtime = getClientSQLitePersistenceRuntime(native.execSql);
    for (const id of ["first", "second", "rejected"])
      await runtime.db.insert(containers).values({
        id,
        organizationId: "org",
        parentId: null,
        metadataDocumentId: `metadata-${id}`,
        localCreatedAt: "2026-09-28",
        localUpdatedAt: "2026-09-28",
      });
    const requestedLanes: string[][] = [];
    const input = createWorkflowInputFixture({
      apiClient: {
        listContainerDocumentLanes: async ({
          lanes,
        }: {
          lanes: ReadonlyArray<{ containerId: string; laneId: string }>;
        }) => {
          requestedLanes.push(lanes.map((lane) => lane.containerId));
          return {
            results: lanes.map(({ containerId, laneId }) =>
              containerId === "rejected"
                ? { failure: { error: "Forbidden", status: 403 }, laneId }
                : {
                    laneId,
                    page: {
                      hasMore: false,
                      items: [],
                      nextWatermark: null,
                      tombstones: [],
                    },
                  },
            ),
          };
        },
      } as never,
      execSql: native.execSql,
    });
    const fullListings: string[] = [];

    const outcomes = await discoverContainerDocumentLanesForRuntime({
      requests: ["first", "missing", "rejected", "second"].map(
        (containerId) => ({
          containerId,
          onFullListing: () => fullListings.push(containerId),
        }),
      ),
      runtimeService: createInternalRuntimeFixture(() => input),
    });

    // A container without durable scope is never listed; one rejected lane
    // leaves the others applied.
    expect(requestedLanes).toEqual([["first", "rejected", "second"]]);
    expect(outcomes).toEqual([
      { containerId: "first", status: "fulfilled", value: [] },
      { containerId: "missing", status: "fulfilled", value: null },
      { containerId: "rejected", status: "fulfilled", value: null },
      { containerId: "second", status: "fulfilled", value: [] },
    ]);
    expect(fullListings).toEqual(["first", "second"]);
  } finally {
    native.close();
  }
});
