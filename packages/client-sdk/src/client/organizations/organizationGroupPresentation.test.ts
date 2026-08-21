import { expect, test } from "bun:test";
import { createMockApiClient } from "@symcrypt/test-utils";
import type { OrganizationGroupMembersResponse } from "@symcrypt/validators/response";
import { createWorkflowInputFixture } from "../../../test/helpers/internalRuntimeFixtures";
import {
  containers,
  groupId,
  organizationId,
  principalPolicy,
} from "../../../test/helpers/organizationReadModelFixtures";
import { unavailableExecSql } from "../../data/sqlite/sqlSchema";
import {
  buildOrganizationGroupPolicyHistory,
  type OrganizationGroupPolicyHistory,
} from "../../workflows/organizations";
import type { InternalWorkflowRuntimeInput } from "../workflowRuntime";
import { loadOrganizationGroupPresentationDetails } from "./organizationGroupPresentation";
import type { OrganizationReadModelCoordinator } from "./organizationReadModels";

const projectedMembers: OrganizationGroupMembersResponse = {
  organizationId,
  groupId,
  members: [
    {
      userId: "projected-user",
      role: "admin",
      signingKeyFingerprint: "projected-signing-fingerprint",
      signingPublicKey: "projected-signing-public-key",
      encapsulationPublicKey: "projected-encapsulation-public-key",
      encapsulationKeyFingerprint: "projected-encapsulation-fingerprint",
    },
  ],
};

const projectedPolicyHistory = buildOrganizationGroupPolicyHistory(
  principalPolicy,
  organizationId,
);

function runtimeWith(
  apiClient: InternalWorkflowRuntimeInput["apiClient"],
  logError: InternalWorkflowRuntimeInput["util"]["logError"] = () => {},
): InternalWorkflowRuntimeInput {
  return createWorkflowInputFixture({
    apiClient,
    auth: { organizationId, userId: "current-user" },
    dbStatus: "idle",
    execSql: unavailableExecSql,
    logError,
  });
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
    async loadGroupPolicyHistory(nextGroupId, nextOrganizationId) {
      calls.push(`policy:${nextOrganizationId}:${nextGroupId}`);
      if (policyHistoryError) {
        throw policyHistoryError;
      }
      return policyHistory;
    },
    async loadOrganizationPolicyHistory() {
      return null;
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

test("group presentation never renders a raw policy response after a verified miss", async () => {
  const networkCalls: string[] = [];
  const localCalls: string[] = [];
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
    ),
    runtime: runtimeWith(apiClient),
  });

  expect(result.members).toEqual(projectedMembers);
  expect(result.policyHistory).toBeNull();
  expect(localCalls).toEqual(["members:org-1:group-1", "policy:org-1:group-1"]);
  expect(networkCalls).toEqual([]);
});

test("group presentation does not bypass verified storage failures", async () => {
  const networkCalls: string[] = [];
  const localCalls: string[] = [];
  const localError = new Error("local policy storage is corrupt");
  const apiClient = createMockApiClient({
    async getCurrentPrincipalPolicy(principalType, principalId) {
      networkCalls.push(`policy:${principalType}:${principalId}`);
      return principalPolicy;
    },
  });

  await expect(
    loadOrganizationGroupPresentationDetails({
      groupId,
      readModelCoordinator: coordinatorWithMembers(
        projectedMembers,
        localCalls,
        null,
        localError,
      ),
      runtime: runtimeWith(apiClient),
    }),
  ).rejects.toBe(localError);
  expect(networkCalls).toEqual([]);
});
