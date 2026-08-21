import { expect, test } from "bun:test";
import type { RequestResult } from "@symcrypt/api-client";
import { createMockApiClient, createTestExecSql } from "@symcrypt/test-utils";
import type { OrganizationReadModelResponse } from "@symcrypt/validators/response";
import { createParentProjection } from "../../test/helpers/containerFixtures";
import {
  createInternalRuntimeFixture,
  createWorkflowInputFixture,
} from "../../test/helpers/internalRuntimeFixtures";
import {
  organizationReadModelSnapshot,
  organizationReadModelUserId,
} from "../../test/helpers/organizationReadModelProjectionFixtures";
import { createDomainScope } from "../data/domainScope";
import { createContainerContents } from "./containerContents";
import { createOrganizations } from "./organizations";
import type { InternalWorkflowRuntimeInput } from "./workflowRuntime";

async function waitForRequest(requestCount: () => number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (requestCount() > 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for organization read-model request.");
}

test("container info reads groups strictly from the durable local projection", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-info-organization-read-model-test",
  );
  const parent = await createParentProjection();
  const organizationId = parent.projection.organizationId;
  let readModelRequests = 0;
  let resolveRequest: (
    result: RequestResult<OrganizationReadModelResponse>,
  ) => void = () => {};
  const pendingRequest = new Promise<
    RequestResult<OrganizationReadModelResponse>
  >((resolve) => {
    resolveRequest = resolve;
  });
  const apiClient = createMockApiClient({
    getContainerWriterProjection: async () => parent.projection,
    getOrganizationReadModelResult: async () => {
      readModelRequests += 1;
      return pendingRequest;
    },
  });
  const workflowInput = createWorkflowInputFixture({
    apiClient,
    auth: { organizationId, userId: organizationReadModelUserId },
    execSql,
  });
  const runtime = createInternalRuntimeFixture(() => workflowInput);
  const containerContents = createContainerContents(runtime);
  const organizations = createOrganizations(runtime, containerContents);

  try {
    const [firstColdInfo, secondColdInfo] = await Promise.all([
      containerContents.loadContainerInfo({
        containerId: parent.projection.containerId,
      }),
      containerContents.loadContainerInfo({
        containerId: parent.projection.containerId,
      }),
    ]);
    expect(firstColdInfo.remoteInfo?.groups).toEqual([]);
    expect(secondColdInfo.remoteInfo?.groups).toEqual([]);
    expect(readModelRequests).toBe(0);

    const directoryAndGroups = organizations.loadDirectoryAndGroups();
    await waitForRequest(() => readModelRequests);
    expect(readModelRequests).toBe(1);

    resolveRequest({
      data: organizationReadModelSnapshot({
        currentUserId: organizationReadModelUserId,
        groupName: "Operators",
        organizationId,
      }),
      ok: true,
    });
    const organizationProjection = await directoryAndGroups;
    expect(organizationProjection?.groups.map((group) => group.name)).toEqual([
      "Operators",
    ]);

    const [firstWarmInfo, secondWarmInfo] = await Promise.all([
      containerContents.loadContainerInfo({
        containerId: parent.projection.containerId,
      }),
      containerContents.loadContainerInfo({
        containerId: parent.projection.containerId,
      }),
    ]);
    expect(firstWarmInfo.remoteInfo?.groups.map((group) => group.name)).toEqual(
      ["Operators"],
    );
    expect(secondWarmInfo.remoteInfo?.groups).toEqual(
      firstWarmInfo.remoteInfo?.groups,
    );
    expect(readModelRequests).toBe(1);
  } finally {
    close();
  }
});

test("container info does not reconcile or cross an identity scope change", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-info-organization-scope-change-test",
  );
  const parent = await createParentProjection();
  let readModelRequests = 0;
  const apiClient = createMockApiClient({
    getContainerWriterProjection: async () => parent.projection,
    getOrganizationReadModelResult: async (organizationId) => {
      readModelRequests += 1;
      return {
        data: organizationReadModelSnapshot({
          currentUserId: organizationReadModelUserId,
          groupName: "Operators",
          organizationId,
        }),
        ok: true,
      } as const;
    },
  });
  const baseWorkflowInput = createWorkflowInputFixture({ apiClient, execSql });
  let workflowInput: InternalWorkflowRuntimeInput = {
    ...baseWorkflowInput,
    auth: {
      isAuthenticated: false,
      organizationId: null,
      userId: null,
    },
  };
  const runtime = createInternalRuntimeFixture(() => workflowInput);
  const containerContents = createContainerContents(runtime);
  const organizations = createOrganizations(runtime, containerContents);

  try {
    const unauthenticatedLoad = containerContents.loadContainerInfo({
      containerId: parent.projection.containerId,
    });
    workflowInput = {
      ...baseWorkflowInput,
      auth: {
        isAuthenticated: true,
        organizationId: "organization-b",
        userId: organizationReadModelUserId,
      },
    };
    expect((await unauthenticatedLoad).remoteInfo?.groups).toEqual([]);

    workflowInput = {
      ...baseWorkflowInput,
      auth: {
        isAuthenticated: true,
        organizationId: parent.projection.organizationId,
        userId: organizationReadModelUserId,
      },
    };
    await organizations.loadDirectoryAndGroups();
    expect(readModelRequests).toBe(1);
    readModelRequests = 0;
    expect(
      (
        await containerContents.loadContainerInfo({
          containerId: parent.projection.containerId,
        })
      ).remoteInfo?.groups.map((group) => group.name),
    ).toEqual(["Operators"]);

    const organizationALoad = containerContents.loadContainerInfo({
      containerId: parent.projection.containerId,
    });
    workflowInput = {
      ...baseWorkflowInput,
      auth: {
        isAuthenticated: true,
        organizationId: "organization-b",
        userId: organizationReadModelUserId,
      },
    };
    expect((await organizationALoad).remoteInfo?.groups).toEqual([]);

    workflowInput = {
      ...baseWorkflowInput,
      auth: {
        isAuthenticated: true,
        organizationId: parent.projection.organizationId,
        userId: organizationReadModelUserId,
      },
    };
    const originalIdentityLoad = containerContents.loadContainerInfo({
      containerId: parent.projection.containerId,
    });
    workflowInput = {
      ...baseWorkflowInput,
      auth: {
        isAuthenticated: true,
        organizationId: parent.projection.organizationId,
        userId: "different-user",
      },
      state: {
        ...baseWorkflowInput.state,
        domainScope: createDomainScope(),
      },
    };
    expect((await originalIdentityLoad).remoteInfo?.groups).toEqual([]);
    expect(readModelRequests).toBe(0);
  } finally {
    close();
  }
});
