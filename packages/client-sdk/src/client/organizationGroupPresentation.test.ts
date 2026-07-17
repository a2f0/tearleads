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
import { loadOrganizationGroupDetails } from "../workflows/organizations";
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

test("group presentation reads projected members without requesting members", async () => {
  const networkCalls: string[] = [];
  const localCalls: string[] = [];
  const apiClient = createMockApiClient({
    async getCurrentPrincipalPolicy(principalType, principalId) {
      networkCalls.push(`policy:${principalType}:${principalId}`);
      return principalPolicy;
    },
    async listOrganizationGroupContainers(nextOrganizationId, nextGroupId) {
      networkCalls.push(`containers:${nextOrganizationId}:${nextGroupId}`);
      return containers;
    },
    async listOrganizationGroupMembers(nextOrganizationId, nextGroupId) {
      networkCalls.push(`members:${nextOrganizationId}:${nextGroupId}`);
      return authoritativeMembers;
    },
  });
  const readModelCoordinator = {
    async loadLocal() {
      return null;
    },
    async loadLocalGroupMembers(nextGroupId, nextOrganizationId) {
      localCalls.push(`members:${nextOrganizationId}:${nextGroupId}`);
      return projectedMembers;
    },
    async loadLocalOrReconcile() {
      return null;
    },
    async reconcile() {
      return null;
    },
  } satisfies OrganizationReadModelCoordinator;
  const runtime = {
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
      logError: () => {},
    },
  } satisfies InternalWorkflowRuntimeInput;

  const result = await loadOrganizationGroupPresentationDetails({
    groupId,
    readModelCoordinator,
    runtime,
  });

  expect(result.members).toEqual(projectedMembers);
  expect(localCalls).toEqual(["members:org-1:group-1"]);
  expect([...networkCalls].sort()).toEqual([
    "containers:org-1:group-1",
    "policy:group:group-1",
  ]);
});

test("authoritative group details still request members", async () => {
  const calls: string[] = [];
  const result = await loadOrganizationGroupDetails({
    apiClient: {
      async getCurrentPrincipalPolicy() {
        return principalPolicy;
      },
      async listOrganizationGroupContainers() {
        return containers;
      },
      async listOrganizationGroupMembers(nextOrganizationId, nextGroupId) {
        calls.push(`members:${nextOrganizationId}:${nextGroupId}`);
        return authoritativeMembers;
      },
    },
    groupId,
    organizationId,
  });

  expect(calls).toEqual(["members:org-1:group-1"]);
  expect(result.members).toEqual(authoritativeMembers);
});
