import { expect, test } from "bun:test";
import type { RequestResult } from "@tearleads/api-client";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import type { OrganizationReadModelResponse } from "@tearleads/validators/response";
import {
  organizationReadModelGroupsDelta,
  organizationReadModelOrganizationId,
  organizationReadModelSnapshot,
  organizationReadModelUserId,
} from "../../test/helpers/organizationReadModelProjectionFixtures";
import type { BlobStore } from "../data/blobContracts";
import { defaultDocumentProjectorRegistry } from "../data/documents/documentKinds";
import { createDomainScope } from "../data/domainScope";
import { createOrganizationReadModelCoordinator } from "./organizationReadModels";
import type {
  InternalRuntime,
  InternalWorkflowRuntimeInput,
} from "./workflowRuntime";

test("concurrent read-model reconciliation is single-flight", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-read-model-single-flight-test",
  );
  const response = organizationReadModelSnapshot();
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
    async getOrganizationReadModelResult() {
      readModelRequests += 1;
      return pendingRequest;
    },
  });
  let workflowInput: InternalWorkflowRuntimeInput = {
    apiClient,
    resolveTrustedUserIdentity: async () => null,
    auth: {
      isAuthenticated: true,
      organizationId: organizationReadModelOrganizationId,
      userId: organizationReadModelUserId,
    },
    crypto: {
      encapsulationKeyPair: null,
      signingFingerprint: null,
      signingKeyPair: null,
    },
    infra: {
      blobStore: {} as BlobStore,
      dbStatus: "ready",
      documentProjectors: defaultDocumentProjectorRegistry,
      execSql,
    },
    state: {
      containerId: null,
      domainScope: createDomainScope(),
      events: [],
      online: true,
    },
    util: {
      log: () => {},
      logError: () => {},
    },
  };
  const runtime = {
    pinLocalUserIdentity: async () => {},
    publicRuntime: {
      version: 0,
      input: () => workflowInput,
      subscribe: () => () => {},
    },
    workflowInput: () => workflowInput,
  } satisfies InternalRuntime;
  const coordinator = createOrganizationReadModelCoordinator(runtime);

  expect(createOrganizationReadModelCoordinator(runtime)).toBe(coordinator);

  try {
    const first = coordinator.reconcile();
    const second = coordinator.reconcile();
    expect(first).toBe(second);

    resolveRequest({ data: response, ok: true });
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult).toEqual(secondResult);
    expect(firstResult?.groups[0]?.name).toBe("Admins");
    expect(readModelRequests).toBe(1);

    workflowInput = {
      ...workflowInput,
      state: { ...workflowInput.state, online: false },
    };
    await expect(coordinator.reconcile()).resolves.toBeNull();
    await expect(coordinator.reconcileAfterMutation()).resolves.toBeNull();
    expect(readModelRequests).toBe(1);
  } finally {
    close();
  }
});

test("post-mutation reconciliation waits for an older request and coalesces one trailing request", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-read-model-post-mutation-reconcile-test",
  );
  let readModelRequests = 0;
  let resolveFirst: (
    result: RequestResult<OrganizationReadModelResponse>,
  ) => void = () => {};
  let resolveTrailing: (
    result: RequestResult<OrganizationReadModelResponse>,
  ) => void = () => {};
  let markFirstStarted = () => {};
  let markScopeRequestStarted = () => {};
  let markTrailingStarted = () => {};
  const firstRequest = new Promise<
    RequestResult<OrganizationReadModelResponse>
  >((resolve) => {
    resolveFirst = resolve;
  });
  const trailingRequest = new Promise<
    RequestResult<OrganizationReadModelResponse>
  >((resolve) => {
    resolveTrailing = resolve;
  });
  const trailingStarted = new Promise<void>((resolve) => {
    markTrailingStarted = resolve;
  });
  let resolveScopeRequest: (
    result: RequestResult<OrganizationReadModelResponse>,
  ) => void = () => {};
  const scopeRequest = new Promise<
    RequestResult<OrganizationReadModelResponse>
  >((resolve) => {
    resolveScopeRequest = resolve;
  });
  const scopeRequestStarted = new Promise<void>((resolve) => {
    markScopeRequestStarted = resolve;
  });
  const firstStarted = new Promise<void>((resolve) => {
    markFirstStarted = resolve;
  });
  const apiClient = createMockApiClient({
    async getOrganizationReadModelResult() {
      readModelRequests += 1;
      if (readModelRequests === 1) {
        markFirstStarted();
        return firstRequest;
      }
      if (readModelRequests === 2) {
        markTrailingStarted();
        return trailingRequest;
      }
      markScopeRequestStarted();
      return scopeRequest;
    },
  });
  const workflowInput = {
    apiClient,
    resolveTrustedUserIdentity: async () => null,
    auth: {
      isAuthenticated: true,
      organizationId: organizationReadModelOrganizationId,
      userId: organizationReadModelUserId,
    },
    crypto: {
      encapsulationKeyPair: null,
      signingFingerprint: null,
      signingKeyPair: null,
    },
    infra: {
      blobStore: {} as BlobStore,
      dbStatus: "ready",
      documentProjectors: defaultDocumentProjectorRegistry,
      execSql,
    },
    state: {
      containerId: null,
      domainScope: createDomainScope(),
      events: [],
      online: true,
    },
    util: {
      log: () => {},
      logError: () => {},
    },
  } satisfies InternalWorkflowRuntimeInput;
  let currentOrganizationId: string | null =
    organizationReadModelOrganizationId;
  const runtime = {
    pinLocalUserIdentity: async () => {},
    publicRuntime: {
      version: 0,
      input: () => workflowInput,
      subscribe: () => () => {},
    },
    workflowInput: () => ({
      ...workflowInput,
      auth: { ...workflowInput.auth, organizationId: currentOrganizationId },
    }),
  } satisfies InternalRuntime;
  const coordinator = createOrganizationReadModelCoordinator(runtime);

  try {
    const older = coordinator.reconcile();
    await firstStarted;
    const afterMutationA = coordinator.reconcileAfterMutation();
    const afterMutationB = coordinator.reconcileAfterMutation();
    expect(readModelRequests).toBe(1);

    resolveFirst({ data: organizationReadModelSnapshot(), ok: true });
    await trailingStarted;
    expect(readModelRequests).toBe(2);
    resolveTrailing({
      data: organizationReadModelGroupsDelta({
        cursor: "cursor-2",
        groupName: "Admins after mutation",
      }),
      ok: true,
    });

    const [olderResult, trailingResultA, trailingResultB] = await Promise.all([
      older,
      afterMutationA,
      afterMutationB,
    ]);
    expect(olderResult?.readModelCursor).toBe("cursor-1");
    expect(trailingResultA?.readModelCursor).toBe("cursor-2");
    expect(trailingResultB?.readModelCursor).toBe("cursor-2");
    expect(trailingResultA?.groups[0]?.name).toBe("Admins after mutation");
    expect(readModelRequests).toBe(2);

    const olderScopeRequest = coordinator.reconcile();
    await scopeRequestStarted;
    const afterScopeMutation = coordinator.reconcileAfterMutation();
    currentOrganizationId = "organization-switched";
    resolveScopeRequest({
      data: organizationReadModelGroupsDelta({
        cursor: "cursor-3",
        groupName: "Admins before scope switch",
      }),
      ok: true,
    });
    await olderScopeRequest;
    await expect(afterScopeMutation).resolves.toBeNull();
    expect(readModelRequests).toBe(3);
  } finally {
    close();
  }
});
