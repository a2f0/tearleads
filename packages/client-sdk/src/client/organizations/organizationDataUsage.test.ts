import { expect, test } from "bun:test";
import type { RequestResult } from "@tearleads/api-client";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import type { OrganizationDataUsageResponse } from "@tearleads/validators/response";
import {
  createInternalRuntimeFixture,
  createWorkflowInputFixture,
} from "../../../test/helpers/internalRuntimeFixtures";
import {
  dataUsage,
  organizationId,
} from "../../../test/helpers/organizationReadModelFixtures";
import { createDomainScope } from "../../data/domainScope";
import type { InternalWorkflowRuntimeInput } from "../workflowRuntime";
import {
  createOrganizationDataUsageCoordinator,
  type OrganizationDataUsageCoordinator,
} from "./organizationDataUsage";

interface DataUsageTestRuntime {
  readonly coordinator: OrganizationDataUsageCoordinator;
  readonly setDatabaseStatus: (
    status: InternalWorkflowRuntimeInput["infra"]["dbStatus"],
  ) => void;
  readonly setOnline: (online: boolean) => void;
}

function createDataUsageTestRuntime(input: {
  readonly apiClient: InternalWorkflowRuntimeInput["apiClient"];
  readonly execSql: InternalWorkflowRuntimeInput["infra"]["execSql"];
}): DataUsageTestRuntime {
  const domainScope = createDomainScope();
  let dbStatus: InternalWorkflowRuntimeInput["infra"]["dbStatus"] = "ready";
  let online = true;
  const workflowInput = (): InternalWorkflowRuntimeInput =>
    createWorkflowInputFixture({
      apiClient: input.apiClient,
      auth: { organizationId, userId: "user-1" },
      dbStatus,
      domainScope,
      execSql: input.execSql,
      online,
    });
  const runtime = createInternalRuntimeFixture(workflowInput);

  return {
    coordinator: createOrganizationDataUsageCoordinator(runtime),
    setDatabaseStatus: (nextStatus) => {
      dbStatus = nextStatus;
    },
    setOnline: (nextOnline) => {
      online = nextOnline;
    },
  };
}

test("organization usage reconciliation is single-flight per runtime scope", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-data-usage-single-flight",
  );
  let resolveRequest: (
    result: RequestResult<OrganizationDataUsageResponse>,
  ) => void = () => {};
  const pendingRequest = new Promise<
    RequestResult<OrganizationDataUsageResponse>
  >((resolve) => {
    resolveRequest = resolve;
  });
  let requestCount = 0;
  const runtime = createDataUsageTestRuntime({
    apiClient: createMockApiClient({
      getOrganizationDataUsageResult: async () => {
        requestCount += 1;
        return pendingRequest;
      },
    }),
    execSql,
  });

  try {
    const first = runtime.coordinator.reconcile();
    const second = runtime.coordinator.reconcile();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(requestCount).toBe(1);

    resolveRequest({ data: dataUsage, ok: true });
    await expect(Promise.all([first, second])).resolves.toEqual([
      dataUsage,
      dataUsage,
    ]);
  } finally {
    close();
  }
});

test("offline organization usage reads the durable projection without HTTP", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-data-usage-offline",
  );
  let requestCount = 0;
  const runtime = createDataUsageTestRuntime({
    apiClient: createMockApiClient({
      getOrganizationDataUsageResult: async () => {
        requestCount += 1;
        return { data: dataUsage, ok: true };
      },
    }),
    execSql,
  });

  try {
    await expect(runtime.coordinator.reconcile()).resolves.toEqual(dataUsage);
    expect(requestCount).toBe(1);
    runtime.setOnline(false);

    await expect(runtime.coordinator.reconcile()).resolves.toEqual(dataUsage);
    expect(requestCount).toBe(1);
  } finally {
    close();
  }
});

test("inactive and empty offline usage loads are non-authoritative", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-data-usage-inactive",
  );
  let requestCount = 0;
  const runtime = createDataUsageTestRuntime({
    apiClient: createMockApiClient({
      getOrganizationDataUsageResult: async () => {
        requestCount += 1;
        return { data: dataUsage, ok: true };
      },
    }),
    execSql,
  });

  try {
    runtime.setDatabaseStatus("idle");
    await expect(runtime.coordinator.reconcile()).resolves.toBeUndefined();
    runtime.setDatabaseStatus("ready");
    runtime.setOnline(false);
    await expect(runtime.coordinator.reconcile()).resolves.toBeUndefined();
    expect(requestCount).toBe(0);
  } finally {
    close();
  }
});
