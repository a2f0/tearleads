import { expect, mock, spyOn, test } from "bun:test";
import { createNativeTestExecSql } from "@tearleads/test-utils";
import {
  createInternalRuntimeFixture,
  createWorkflowInputFixture,
} from "../../../test/helpers/workflows/internalRuntimeFixtures";
import { DocumentDiscoveryEvidenceRepository } from "../../data/persistence/documents/documentDiscoveryEvidencePersistence";
import { clearDocumentDiscoveryEvidenceOnRemoteReset } from "../../data/persistence/documents/documentDiscoveryReset";
import { clientSqlTables, containers } from "../../data/sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../data/sqlite/sqlitePersistenceRuntime";
import {
  createExecSql,
  ensureSqlTables,
  runSerializedSqlMutation,
} from "../../data/sqlite/sqlSchema";
import { laneApi } from "../../workflows/container-contents/documentDiscovery/documentDiscovery.testUtils";
import { ContainerDocumentListingUnavailableError } from "../../workflows/container-contents/documentDiscovery/documentDiscoveryTypes";
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

// A failed listing request is retryable, so batch discovery rejects every
// lane it carried instead of settling as if the containers had no changes.
// The single-container API keeps its documented `null` for that case.
test("a failed listing request rejects its lanes as unavailable", async () => {
  const native = createNativeTestExecSql();
  try {
    await ensureSqlTables(native.execSql, clientSqlTables);
    const runtime = getClientSQLitePersistenceRuntime(native.execSql);
    for (const id of ["first", "second"])
      await runtime.db.insert(containers).values({
        id,
        organizationId: "org",
        parentId: null,
        metadataDocumentId: `metadata-${id}`,
        localCreatedAt: "2026-09-28",
        localUpdatedAt: "2026-09-28",
      });
    const input = createWorkflowInputFixture({
      apiClient: { listContainerDocumentLanes: async () => null } as never,
      execSql: native.execSql,
    });
    const runtimeService = createInternalRuntimeFixture(() => input);

    const outcomes = await discoverContainerDocumentLanesForRuntime({
      requests: ["first", "missing", "second"].map((containerId) => ({
        containerId,
      })),
      runtimeService,
    });

    expect(
      outcomes.map(({ containerId, status }) => [containerId, status]),
    ).toEqual([
      ["first", "rejected"],
      ["missing", "fulfilled"],
      ["second", "rejected"],
    ]);
    for (const outcome of outcomes) {
      if (outcome.status === "rejected")
        expect(outcome.reason).toBeInstanceOf(
          ContainerDocumentListingUnavailableError,
        );
    }
    await expect(
      discoverContainerDocumentsForRuntime({
        containerId: "first",
        runtimeService,
      }),
    ).resolves.toBeNull();
  } finally {
    native.close();
  }
});

test("cancelling discovery retires a pending principal policy lookup", async () => {
  const native = createNativeTestExecSql();
  const gate = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  const controller = new AbortController();
  const input = createWorkflowInputFixture({
    execSql: native.execSql,
    apiClient: laneApi(async () => ({
      items: [],
      tombstones: [],
      nextWatermark: null,
      hasMore: false,
    })) as never,
  });
  let current: (() => boolean) | undefined;
  const warmer = spyOn(input.principalPolicies, "createWarmer").mockReturnValue(
    async ({ stillCurrent }) => {
      current = stillCurrent;
      started.resolve();
      await gate.promise;
    },
  );
  try {
    await ensureSqlTables(native.execSql, clientSqlTables);
    await getClientSQLitePersistenceRuntime(native.execSql)
      .db.insert(containers)
      .values({
        id: "container",
        organizationId: "org",
        parentId: null,
        metadataDocumentId: "metadata",
        localCreatedAt: "2026-09-28",
        localUpdatedAt: "2026-09-28",
      });
    const listing = discoverContainerDocumentsForRuntime({
      runtimeService: createInternalRuntimeFixture(() => input),
      containerId: "container",
      signal: controller.signal,
    });
    await started.promise;
    expect(current?.()).toBe(true);
    controller.abort();
    await expect(listing).rejects.toThrow();
    expect(current?.()).toBe(false);
  } finally {
    gate.resolve();
    warmer.mockRestore();
    native.close();
  }
});

test("cancelling discovery returns before a held SQLite writer releases the queue", async () => {
  const native = createNativeTestExecSql();
  const release = Promise.withResolvers<void>();
  const entered = Promise.withResolvers<void>();
  const controller = new AbortController();
  await ensureSqlTables(native.execSql, clientSqlTables);
  const writer = runSerializedSqlMutation(native.execSql, async () => {
    entered.resolve();
    await release.promise;
  });
  await entered.promise;
  const list = mock(async () => null);
  const input = createWorkflowInputFixture({
    execSql: native.execSql,
    apiClient: { listContainerDocumentLanes: list } as never,
  });
  const read = discoverContainerDocumentsForRuntime({
    containerId: "held",
    signal: controller.signal,
    runtimeService: createInternalRuntimeFixture(() => input),
  });
  const reason = new Error("cancel queued discovery");
  controller.abort(reason);
  try {
    expect(
      await Promise.race([
        read.then(
          () => null,
          (error: unknown) => error,
        ),
        Bun.sleep(200).then(() => "still waiting"),
      ]),
    ).toBe(reason);
  } finally {
    release.resolve();
    await writer;
    await read.catch(() => {});
    await runSerializedSqlMutation(native.execSql, async () => {});
    native.close();
  }
  expect(list).not.toHaveBeenCalled();
});

test("a retry delay returned after cancellation cannot schedule another discovery", async () => {
  const native = createNativeTestExecSql();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const controller = new AbortController();
  const retry = spyOn(
    DocumentDiscoveryEvidenceRepository.prototype,
    "retryDelay",
  ).mockImplementation(async () => {
    entered.resolve();
    await release.promise;
    return 100;
  });
  const pending = mock(() => {});
  try {
    await ensureSqlTables(native.execSql, clientSqlTables);
    await getClientSQLitePersistenceRuntime(native.execSql)
      .db.insert(containers)
      .values({
        id: "container",
        organizationId: "org",
        parentId: null,
        metadataDocumentId: "metadata",
        localCreatedAt: "2026-09-28",
        localUpdatedAt: "2026-09-28",
      });
    const input = createWorkflowInputFixture({
      execSql: native.execSql,
      apiClient: laneApi(async () => ({
        items: [],
        tombstones: [],
        hasMore: false,
        nextWatermark: null,
      })) as never,
    });
    const read = discoverContainerDocumentsForRuntime({
      containerId: "container",
      signal: controller.signal,
      onPendingDiscovery: pending,
      runtimeService: createInternalRuntimeFixture(() => input),
    });
    await Promise.race([
      entered.promise,
      read.then(() => {
        throw new Error("Missed retry query");
      }),
    ]);
    controller.abort();
    await expect(read).rejects.toThrow();
    release.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(pending).not.toHaveBeenCalled();
  } finally {
    release.resolve();
    retry.mockRestore();
    native.close();
  }
});
