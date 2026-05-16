import { expect, test } from "bun:test";
import type {
  ListOrganizationGroupsResponse,
  OrganizationDirectoryResponse,
  OrganizationGroupContainersResponse,
  OrganizationGroupMembersResponse,
} from "@tearleads/validators/response";
import {
  loadOrgManagerDirectoryAndGroups,
  loadOrgManagerGroupDetails,
} from "./readModel";

const organizationId = "org-1";
const groupId = "group-1";

const directory: OrganizationDirectoryResponse = {
  organizationId,
  currentUser: {
    isOrgAdmin: true,
  },
  users: [],
};

const groups: ListOrganizationGroupsResponse = {
  organizationId,
  groups: [
    {
      groupId,
      organizationId,
      name: "Operators",
      createdAt: "2026-05-16T12:00:00.000Z",
      currentState: null,
    },
  ],
};

const members: OrganizationGroupMembersResponse = {
  organizationId,
  groupId,
  members: [],
};

const containers: OrganizationGroupContainersResponse = {
  organizationId,
  groupId,
  containers: [
    {
      accessLevel: "read",
      containerId: "container-1",
      createdAt: "2026-05-16T12:00:00.000Z",
      depth: 0,
      metadataAccessEpoch: 1,
      metadataAccessStateHash: "metadata-state-hash",
      metadataDocumentId: null,
      parentId: null,
      updatedAt: "2026-05-16T12:30:00.000Z",
    },
  ],
};

test("loadOrgManagerDirectoryAndGroups combines directory and group lists", async () => {
  const calls: string[] = [];
  const result = await loadOrgManagerDirectoryAndGroups({
    apiClient: {
      listOrganizationDirectory: async (nextOrganizationId) => {
        calls.push(`directory:${nextOrganizationId}`);
        return directory;
      },
      listOrganizationGroups: async (nextOrganizationId) => {
        calls.push(`groups:${nextOrganizationId}`);
        return groups;
      },
    },
    organizationId,
  });

  expect([...calls].sort()).toEqual(["directory:org-1", "groups:org-1"]);
  expect(result).toEqual({
    directory,
    groups: groups.groups,
  });
});

test("loadOrgManagerDirectoryAndGroups reports unavailable directory state", async () => {
  const result = await loadOrgManagerDirectoryAndGroups({
    apiClient: {
      listOrganizationDirectory: async () => null,
      listOrganizationGroups: async () => groups,
    },
    organizationId,
  });

  expect(result).toBeNull();
});

test("loadOrgManagerGroupDetails preserves partial group detail results", async () => {
  const calls: string[] = [];
  const result = await loadOrgManagerGroupDetails({
    apiClient: {
      listOrganizationGroupMembers: async (nextOrganizationId, nextGroupId) => {
        calls.push(`members:${nextOrganizationId}:${nextGroupId}`);
        return members;
      },
      listOrganizationGroupContainers: async (
        nextOrganizationId,
        nextGroupId,
      ) => {
        calls.push(`containers:${nextOrganizationId}:${nextGroupId}`);
        return containers;
      },
    },
    groupId,
    organizationId,
  });

  expect([...calls].sort()).toEqual([
    "containers:org-1:group-1",
    "members:org-1:group-1",
  ]);
  expect(result).toEqual({
    members,
    containers,
  });
});
