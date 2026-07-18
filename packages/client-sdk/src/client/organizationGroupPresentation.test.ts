import { expect, test } from "bun:test";
import { createMockApiClient } from "@tearleads/test-utils";
import type { OrganizationGroupMembersResponse } from "@tearleads/validators/response";
import {
  containers,
  groupId,
  organizationId,
  principalPolicy,
} from "../../test/helpers/organizationReadModelFixtures";
import type { BlobStore } from "../data/blobContracts";
import { defaultDocumentProjectorRegistry } from "../data/documents/documentKinds";
import { createDomainScope } from "../data/domainScope";
import { unavailableExecSql } from "../data/sqlite/sqlSchema";
import {
  buildOrganizationGroupPolicyHistory,
  type OrganizationGroupPolicyHistory,
} from "../workflows/organizations";
import { loadOrganizationGroupPresentationDetails } from "./organizationGroupPresentation";
import type { OrganizationReadModelCoordinator } from "./organizationReadModels";
import type { InternalWorkflowRuntimeInput } from "./workflowRuntime";

const projectedMembers: OrganizationGroupMembersResponse = {
  organizationId,
  groupId,
  members: [
    {
      memberPrincipalType: "user",
      memberPrincipalId: "projected-user",
      role: "admin",
      userId: "projected-user",
      signingKeyFingerprint: "projected-signing-fingerprint",
      signingPublicKey: "projected-signing-public-key",
      encapsulationPublicKey: "projected-encapsulation-public-key",
      encapsulationKeyFingerprint: "projected-encapsulation-fingerprint",
      groupId: null,
      groupName: null,
    },
  ],
};

const authoritativeMembers: OrganizationGroupMembersResponse = {
  organizationId,
  groupId,
  members: [],
};

const projectedPolicyHistory =
  buildOrganizationGroupPolicyHistory(principalPolicy);

function runtimeWith(
  apiClient: InternalWorkflowRuntimeInput["apiClient"],
  logError: InternalWorkflowRuntimeInput["util"]["logError"] = () => {},
): InternalWorkflowRuntimeInput {
  return {
    apiClient,
    resolveTrustedUserIdentity: async () => null,
    auth: {
      isAuthenticated: true,
      organizationId,
      userId: "current-user",
    },
    crypto: {
      encapsulationKeyPair: null,
      signingFingerprint: null,
      signingKeyPair: null,
    },
    infra: {
      blobStore: {} as BlobStore,
      dbStatus: "idle",
      documentProjectors: defaultDocumentProjectorRegistry,
      execSql: unavailableExecSql,
    },
    state: {
      containerId: null,
      domainScope: createDomainScope(),
      events: [],
      online: true,
    },
    util: {
      log: () => {},
      logError,
    },
  };
}

function coordinatorWithMembers(
  members: OrganizationGroupMembersResponse | null,
  calls: string[],
  policyHistory: OrganizationGroupPolicyHistory | null = projectedPolicyHistory,
  policyHistoryError?: Error | undefined,
): OrganizationReadModelCoordinator {
  return {
    async loadLocal() {
      return null;
    },
    async loadLocalGrants() {
      return null;
    },
    async loadLocalGroupContainers(nextGroupId, nextOrganizationId) {
      calls.push(`containers:${nextOrganizationId}:${nextGroupId}`);
      return {
        ...containers,
        containers: containers.containers.map((container) => ({
          ...container,
          containerDisplayName: null,
        })),
      };
    },
    async loadLocalGroupMembers(nextGroupId, nextOrganizationId) {
      calls.push(`members:${nextOrganizationId}:${nextGroupId}`);
      return members;
    },
    async loadLocalGroupPolicyHistory(nextGroupId, nextOrganizationId) {
      calls.push(`policy:${nextOrganizationId}:${nextGroupId}`);
      if (policyHistoryError) {
        throw policyHistoryError;
      }
      return policyHistory;
    },
    async loadLocalUserDetail() {
      return null;
    },
    async reconcile() {
      return null;
    },
    async reconcileAfterMutation() {
      return null;
    },
  };
}

test("group presentation reads projected members without requesting members", async () => {
  const networkCalls: string[] = [];
  const localCalls: string[] = [];
  const apiClient = createMockApiClient({
    async getCurrentPrincipalPolicy(principalType, principalId) {
      networkCalls.push(`policy:${principalType}:${principalId}`);
      return principalPolicy;
    },
    async listOrganizationGroupMembers(nextOrganizationId, nextGroupId) {
      networkCalls.push(`members:${nextOrganizationId}:${nextGroupId}`);
      return authoritativeMembers;
    },
  });

  const result = await loadOrganizationGroupPresentationDetails({
    groupId,
    readModelCoordinator: coordinatorWithMembers(projectedMembers, localCalls),
    runtime: runtimeWith(apiClient),
  });

  expect(result.members).toEqual(projectedMembers);
  expect(result.policyHistory).toEqual(projectedPolicyHistory);
  expect(localCalls).toEqual(["members:org-1:group-1", "policy:org-1:group-1"]);
  expect(networkCalls).toEqual([]);
});

test("group presentation does not fall back when projected members are absent", async () => {
  const networkCalls: string[] = [];
  const localCalls: string[] = [];
  const apiClient = createMockApiClient({
    async getCurrentPrincipalPolicy(principalType, principalId) {
      networkCalls.push(`policy:${principalType}:${principalId}`);
      return principalPolicy;
    },
    async listOrganizationGroupMembers(nextOrganizationId, nextGroupId) {
      networkCalls.push(`members:${nextOrganizationId}:${nextGroupId}`);
      return authoritativeMembers;
    },
  });

  const result = await loadOrganizationGroupPresentationDetails({
    groupId,
    readModelCoordinator: coordinatorWithMembers(null, localCalls),
    runtime: runtimeWith(apiClient),
  });

  expect(result.members).toBeNull();
  expect(result.policyHistory).toEqual(projectedPolicyHistory);
  expect(localCalls).toEqual(["members:org-1:group-1", "policy:org-1:group-1"]);
  expect(networkCalls).toEqual([]);
});

test("group presentation fetches policy history once after a local miss", async () => {
  const networkCalls: string[] = [];
  const localCalls: string[] = [];
  const apiClient = createMockApiClient({
    async getCurrentPrincipalPolicy(principalType, principalId) {
      networkCalls.push(`policy:${principalType}:${principalId}`);
      return principalPolicy;
    },
    async listOrganizationGroupMembers(nextOrganizationId, nextGroupId) {
      networkCalls.push(`members:${nextOrganizationId}:${nextGroupId}`);
      return authoritativeMembers;
    },
  });

  const result = await loadOrganizationGroupPresentationDetails({
    groupId,
    readModelCoordinator: coordinatorWithMembers(
      projectedMembers,
      localCalls,
      null,
    ),
    runtime: runtimeWith(apiClient),
  });

  expect(result.members).toEqual(projectedMembers);
  expect(result.policyHistory).toEqual(projectedPolicyHistory);
  expect(localCalls).toEqual(["members:org-1:group-1", "policy:org-1:group-1"]);
  expect(networkCalls).toEqual(["policy:group:group-1"]);
});

test("group presentation recovers from local policy storage failures", async () => {
  const networkCalls: string[] = [];
  const localCalls: string[] = [];
  const loggedErrors: Array<{ cause: unknown; message: string | Error }> = [];
  const localError = new Error("local policy storage is corrupt");
  const apiClient = createMockApiClient({
    async getCurrentPrincipalPolicy(principalType, principalId) {
      networkCalls.push(`policy:${principalType}:${principalId}`);
      return principalPolicy;
    },
  });

  const result = await loadOrganizationGroupPresentationDetails({
    groupId,
    readModelCoordinator: coordinatorWithMembers(
      projectedMembers,
      localCalls,
      null,
      localError,
    ),
    runtime: runtimeWith(apiClient, (message, cause) => {
      loggedErrors.push({ cause, message });
    }),
  });

  expect(result.policyHistory).toEqual(projectedPolicyHistory);
  expect(networkCalls).toEqual(["policy:group:group-1"]);
  expect(loggedErrors).toEqual([
    {
      cause: localError,
      message: "Failed to load local organization group policy history",
    },
  ]);
});
