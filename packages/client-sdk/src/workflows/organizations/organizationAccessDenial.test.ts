import { expect, test } from "bun:test";
import type { RequestFailure, RequestResult } from "@tearleads/api-client";
import { createTestExecSql } from "@tearleads/test-utils";
import type { OrganizationDataUsageResponse } from "@tearleads/validators/response";
import { dataUsage } from "../../../test/helpers/organizationReadModelFixtures";
import {
  organizationReadModelFailure,
  organizationReadModelOrganizationId,
  organizationReadModelSnapshot,
  organizationReadModelUserId,
} from "../../../test/helpers/organizationReadModelProjectionFixtures";
import { loadOrganizationDataUsageProjection } from "../../data/persistence/organizations/organizationDataUsagePersistence";
import {
  applyOrganizationReadModelResponse,
  loadOrganizationReadModelProjection,
} from "../../data/persistence/organizations/organizationReadModelPersistence";
import {
  createExecSql,
  type ExecSql,
  type ExecSqlClientLike,
} from "../../data/sqlite/sqlSchema";
import {
  loadLocalOrganizationDataUsage,
  reconcileOrganizationDataUsage,
} from "./dataUsageReadModel";
import { reconcileOrganizationDirectoryAndGroups } from "./readModelProjection";

const organizationId = organizationReadModelOrganizationId;
const requesterUserId = organizationReadModelUserId;

function usageFailure(status: 403 | 404): RequestFailure {
  return {
    kind: "http",
    message: "usage request denied",
    method: "GET",
    ok: false,
    path: `/organizations/${organizationId}/data-usage`,
    report: () => {},
    status,
    statusText: "denied",
  };
}

function createRejectingExecSql(
  execSql: ExecSql,
  rejectSql: (sql: string) => boolean,
): ExecSql {
  const client: ExecSqlClientLike = {
    async exec({ bind, rowMode, sql }) {
      if (rejectSql(sql)) {
        throw new Error("forced projection purge failure");
      }
      const rows =
        rowMode === "array"
          ? await execSql(sql, bind, { rowMode: "array" })
          : await execSql(sql, bind, { rowMode: "object" });
      return { rows };
    },
  };
  return createExecSql(client);
}

async function reconcileUsageSuccessfully(execSql: ExecSql) {
  return reconcileOrganizationDataUsage({
    apiClient: {
      getOrganizationDataUsageResult: async () => ({
        data: { ...dataUsage, organizationId },
        ok: true,
      }),
    },
    execSql,
    organizationId,
    requesterUserId,
  });
}

test("read-model denial invalidates a delayed usage success", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-access-delayed-usage",
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
    await reconcileUsageSuccessfully(execSql);
    const delayedUsage = reconcileOrganizationDataUsage({
      apiClient: {
        getOrganizationDataUsageResult: async () => {
          signalRequestStarted();
          return pendingRequest;
        },
      },
      execSql,
      organizationId,
      requesterUserId,
    });
    await requestStarted;

    await expect(
      reconcileOrganizationDirectoryAndGroups({
        apiClient: {
          getOrganizationReadModelResult: async () =>
            organizationReadModelFailure({ kind: "http", status: 403 }),
        },
        currentUserId: requesterUserId,
        execSql,
        organizationId,
      }),
    ).resolves.toBeNull();

    resolveRequest({
      data: { ...dataUsage, organizationId },
      ok: true,
    });
    await expect(delayedUsage).resolves.toBeNull();
    await expect(
      loadOrganizationDataUsageProjection(
        execSql,
        organizationId,
        requesterUserId,
      ),
    ).resolves.toBeNull();
    await expect(
      loadLocalOrganizationDataUsage({
        execSql,
        organizationId,
        requesterUserId,
      }),
    ).resolves.toBeNull();

    await expect(reconcileUsageSuccessfully(execSql)).resolves.toEqual({
      ...dataUsage,
      organizationId,
    });
    await expect(
      loadLocalOrganizationDataUsage({
        execSql,
        organizationId,
        requesterUserId,
      }),
    ).resolves.toEqual({ ...dataUsage, organizationId });
  } finally {
    close();
  }
});

test("usage denial remains authoritative when durable cleanup fails", async () => {
  const testDb = await createTestExecSql(
    "organization-access-usage-purge-failure",
  );
  let rejectUsageDelete = false;
  const execSql = createRejectingExecSql(
    testDb.execSql,
    (sql) =>
      rejectUsageDelete &&
      sql.includes('delete from "organization_data_usage_categories"'),
  );
  const errors: unknown[][] = [];

  try {
    await reconcileUsageSuccessfully(execSql);
    rejectUsageDelete = true;
    await expect(
      reconcileOrganizationDataUsage({
        apiClient: {
          getOrganizationDataUsageResult: async () => usageFailure(404),
        },
        execSql,
        logError: (...args) => errors.push(args),
        organizationId,
        requesterUserId,
      }),
    ).resolves.toBeNull();
    await expect(
      loadLocalOrganizationDataUsage({
        execSql,
        organizationId,
        requesterUserId,
      }),
    ).resolves.toBeNull();
    await expect(
      loadOrganizationDataUsageProjection(
        execSql,
        organizationId,
        requesterUserId,
      ),
    ).resolves.toEqual({ ...dataUsage, organizationId });
    expect(errors).toHaveLength(1);
    expect(errors[0]?.[0]).toBe(
      "Failed to purge denied organization data usage",
    );

    rejectUsageDelete = false;
    await expect(reconcileUsageSuccessfully(execSql)).resolves.toEqual({
      ...dataUsage,
      organizationId,
    });
  } finally {
    testDb.close();
  }
});

test("read-model denial rolls back both projections when cleanup fails", async () => {
  const testDb = await createTestExecSql(
    "organization-access-read-model-purge-failure",
  );
  let rejectReadModelDelete = false;
  const execSql = createRejectingExecSql(
    testDb.execSql,
    (sql) =>
      rejectReadModelDelete &&
      sql.includes('delete from "organization_read_model_state"'),
  );
  const errors: unknown[][] = [];

  try {
    await applyOrganizationReadModelResponse({
      currentUserId: requesterUserId,
      execSql,
      requestedCursor: null,
      response: organizationReadModelSnapshot(),
    });
    await reconcileUsageSuccessfully(execSql);
    rejectReadModelDelete = true;

    await expect(
      reconcileOrganizationDirectoryAndGroups({
        apiClient: {
          getOrganizationReadModelResult: async () =>
            organizationReadModelFailure({ kind: "http", status: 403 }),
        },
        currentUserId: requesterUserId,
        execSql,
        logError: (...args) => errors.push(args),
        organizationId,
      }),
    ).resolves.toBeNull();
    await expect(
      loadLocalOrganizationDataUsage({
        execSql,
        organizationId,
        requesterUserId,
      }),
    ).resolves.toBeNull();
    await expect(
      loadOrganizationReadModelProjection(
        execSql,
        organizationId,
        requesterUserId,
      ),
    ).resolves.not.toBeNull();
    await expect(
      loadOrganizationDataUsageProjection(
        execSql,
        organizationId,
        requesterUserId,
      ),
    ).resolves.toEqual({ ...dataUsage, organizationId });
    expect(errors).toHaveLength(1);
    expect(errors[0]?.[0]).toBe("Failed to purge denied organization access");
  } finally {
    testDb.close();
  }
});
