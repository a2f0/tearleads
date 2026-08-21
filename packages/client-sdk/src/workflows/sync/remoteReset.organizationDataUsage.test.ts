import { expect, test } from "bun:test";
import type { RequestResult } from "@symcrypt/api-client";
import { createTestExecSql } from "@symcrypt/test-utils";
import type { OrganizationDataUsageResponse } from "@symcrypt/validators/response";
import {
  dataUsage,
  organizationId,
} from "../../../test/helpers/organizationReadModelFixtures";
import { loadOrganizationDataUsageProjection } from "../../data/persistence/organizations/organizationDataUsagePersistence";
import {
  organizationDataUsageCategories,
  organizationDataUsageSnapshots,
} from "../../data/sqlite/organizationDataUsageSchema";
import { clientSqlTables } from "../../data/sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../data/sqlite/sqlitePersistenceRuntime";
import { ensureSqlTables } from "../../data/sqlite/sqlTableSchema";
import { reconcileOrganizationDataUsage } from "../organizations/dataUsageReadModel";
import { clearRemoteSyncState } from "./remoteReset";

const REQUESTER_USER_ID = "user-1";

test("remote reset deletes durable organization data usage", async () => {
  const { close, execSql } = await createTestExecSql(
    "remote-reset-organization-data-usage",
  );
  try {
    await ensureSqlTables(execSql, clientSqlTables);
    const { db } = getClientSQLitePersistenceRuntime(execSql);
    await db.insert(organizationDataUsageSnapshots).values({
      organizationId: "org-1",
      requesterUserId: "user-1",
      projectionVersion: 1,
      blobCount: 1,
      blobByteLength: 10,
      documentByteLength: 20,
      documentCount: 1,
      documentUpdateCount: 2,
      totalByteLength: 30,
      refreshedAt: "2026-07-18T12:00:00.000Z",
    });
    await db.insert(organizationDataUsageCategories).values({
      organizationId: "org-1",
      requesterUserId: "user-1",
      category: "user",
      byteLength: 20,
      documentCount: 1,
      updateCount: 2,
    });

    await clearRemoteSyncState(execSql);

    expect(await db.select().from(organizationDataUsageSnapshots)).toEqual([]);
    expect(await db.select().from(organizationDataUsageCategories)).toEqual([]);
  } finally {
    close();
  }
});

test("remote reset invalidates an in-flight organization usage response", async () => {
  const { close, execSql } = await createTestExecSql(
    "remote-reset-in-flight-organization-data-usage",
  );
  let resolveRequest: (
    result: RequestResult<OrganizationDataUsageResponse>,
  ) => void = () => {};
  let signalRequestStarted = () => {};
  const requestStarted = new Promise<void>((resolve) => {
    signalRequestStarted = resolve;
  });
  const pendingRequest = new Promise<
    RequestResult<OrganizationDataUsageResponse>
  >((resolve) => {
    resolveRequest = resolve;
  });

  try {
    const reconciliation = reconcileOrganizationDataUsage({
      apiClient: {
        getOrganizationDataUsageResult: async () => {
          signalRequestStarted();
          return pendingRequest;
        },
      },
      execSql,
      organizationId,
      requesterUserId: REQUESTER_USER_ID,
    });
    await requestStarted;
    await clearRemoteSyncState(execSql);

    resolveRequest({ data: dataUsage, ok: true });
    await expect(reconciliation).resolves.toBeNull();
    await expect(
      loadOrganizationDataUsageProjection(
        execSql,
        organizationId,
        REQUESTER_USER_ID,
      ),
    ).resolves.toBeNull();
  } finally {
    close();
  }
});
