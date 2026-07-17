import { expect, test } from "bun:test";
import type { RequestResult } from "@tearleads/api-client";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import type { OrganizationReadModelResponse } from "@tearleads/validators/response";
import {
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

test("concurrent reconciliation is single-flight and never calls legacy roster APIs", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-read-model-single-flight-test",
  );
  const response = organizationReadModelSnapshot();
  let readModelRequests = 0;
  let legacyRequests = 0;
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
    async listOrganizationDirectory() {
      legacyRequests += 1;
      return null;
    },
    async listOrganizationGroups() {
      legacyRequests += 1;
      return null;
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

  try {
    const first = coordinator.reconcile();
    const second = coordinator.reconcile();
    expect(first).toBe(second);

    resolveRequest({ data: response, ok: true });
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult).toEqual(secondResult);
    expect(firstResult?.groups[0]?.name).toBe("Admins");
    expect(readModelRequests).toBe(1);
    expect(legacyRequests).toBe(0);
  } finally {
    close();
  }
});
