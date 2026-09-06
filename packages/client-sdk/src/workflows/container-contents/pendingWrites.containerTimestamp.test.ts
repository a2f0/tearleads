import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { defaultContainerContentsPersistence } from "./containerPersistence";
import { createContainerDocumentQueriesFromRuntime } from "./documentQueries";
import { saveTestSyncedContainer } from "./documentQueries.testFixtures";

test("listPendingWrites exposes an otherwise-uncovered local container timestamp", async () => {
  const { close, execSql } = await createTestExecSql(
    "pending-writes-container-timestamp",
  );
  try {
    const serverUpdatedAt = "2026-01-01T00:00:00.000Z";
    const localUpdatedAt = "2026-01-01T00:00:01.000Z";
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    await saveTestSyncedContainer({
      execSql,
      id: "container-a",
      name: "Container A",
      organizationId: "organization-a",
      timestamp: serverUpdatedAt,
    });
    await execSql("UPDATE containers SET local_updated_at = ? WHERE id = ?", [
      localUpdatedAt,
      "container-a",
    ]);

    const queries = createContainerDocumentQueriesFromRuntime({
      infra: { execSql },
    });
    expect(await queries.listPendingWrites()).toEqual([
      {
        containerId: "container-a",
        createdAt: null,
        localId: "container-a",
        name: "Container A",
        namespace: null,
        objectKind: "container",
        operations: [
          {
            byteLength: 0,
            count: 1,
            createdAt: null,
            kind: "update",
            lastAttemptedAt: null,
            lastError: null,
            status: "pending",
            targetContainerId: null,
            updatedAt: localUpdatedAt,
          },
        ],
        organizationId: "organization-a",
        remoteId: "container-a",
        status: "pending",
        updatedAt: localUpdatedAt,
      },
    ]);
  } finally {
    close();
  }
});
