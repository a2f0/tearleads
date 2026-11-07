import { expect, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import {
  createInternalRuntimeFixture,
  createWorkflowInputFixture,
} from "../../../test/helpers/internalRuntimeFixtures";
import { createDeviceUsageStore } from "../../workflows/organizations/readModel/deviceDataUsage.testFixtures";
import type { ContainerContents } from "../containerContents";
import type { InternalWorkflowRuntimeInput } from "../runtime/workflowRuntime";
import { createOrganizations } from ".";

test("device usage measures the active organization and is null without one", async () => {
  const { close, execSql } = await createTestExecSql(
    "organizations-device-data-usage",
  );
  let auth: Partial<InternalWorkflowRuntimeInput["auth"]> = {
    organizationId: "org-a",
    userId: "user-1",
  };
  let dbStatus: InternalWorkflowRuntimeInput["infra"]["dbStatus"] = "ready";
  const organizations = createOrganizations(
    createInternalRuntimeFixture(() =>
      createWorkflowInputFixture({
        apiClient: createMockApiClient({}),
        auth,
        dbStatus,
        execSql,
      }),
    ),
    {} as ContainerContents,
    () => {
      throw new Error("No organization is resumed in this test");
    },
  );

  try {
    const store = await createDeviceUsageStore(execSql);
    await store.container("folder-a", "org-a");
    await store.container("folder-b", "org-b");
    await store.document({
      checkpoint: "a".repeat(12),
      containerId: "folder-a",
      localId: "note-a",
    });
    await store.document({
      checkpoint: "b".repeat(5),
      containerId: "folder-b",
      localId: "note-b",
    });

    const usageA = await organizations.loadDeviceDataUsage();
    expect(usageA?.organizationId).toBe("org-a");
    expect(usageA?.totalByteLength).toBe(12);

    auth = { organizationId: "org-b", userId: "user-1" };
    const usageB = await organizations.loadDeviceDataUsage();
    expect(usageB?.organizationId).toBe("org-b");
    expect(usageB?.totalByteLength).toBe(5);

    dbStatus = "idle";
    await expect(organizations.loadDeviceDataUsage()).resolves.toBeNull();
    dbStatus = "ready";
    auth = { organizationId: null, userId: "user-1" };
    await expect(organizations.loadDeviceDataUsage()).resolves.toBeNull();
    auth = {
      isAuthenticated: false,
      organizationId: "org-a",
      userId: "user-1",
    };
    await expect(organizations.loadDeviceDataUsage()).resolves.toBeNull();
  } finally {
    close();
  }
});
