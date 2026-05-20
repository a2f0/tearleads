import { expect, test } from "bun:test";
import type {
  ListOrganizationGroupsResponse,
  OrganizationContainerGrantsResponse,
  OrganizationDirectoryResponse,
  OrganizationGroupContainersResponse,
  OrganizationGroupMembersResponse,
  OrganizationUserDetailResponse,
} from "@tearleads/validators/response";
import { createTestExecSql } from "../../../test/helpers/createTestExecSql";
import {
  ensureContainerTables,
  saveContainer,
} from "../../data/persistence/containers/containerPersistence";
import {
  loadOrganizationContainerGrants,
  loadOrganizationDataUsage,
  loadOrganizationDirectoryAndGroups,
  loadOrganizationGroupDetails,
  loadOrganizationUserDetail,
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

const grants: OrganizationContainerGrantsResponse = {
  organizationId,
  grants: [
    {
      accessLevel: "admin",
      containerId: "container-1",
      createdAt: "2026-05-16T12:00:00.000Z",
      depth: 0,
      metadataAccessEpoch: 1,
      metadataAccessStateHash: "metadata-state-hash",
      metadataDocumentId: null,
      parentId: null,
      updatedAt: "2026-05-16T12:30:00.000Z",
      subjectType: "group",
      subjectId: groupId,
      userId: null,
      signingKeyFingerprint: null,
      groupId,
      groupName: "Operators",
      organizationName: null,
    },
  ],
};

const dataUsage = {
  organizationId,
  blobs: {
    blobCount: 2,
    byteLength: 96,
  },
  documents: {
    byteLength: 32,
    documentCount: 1,
    updateCount: 2,
  },
  totalByteLength: 128,
};

const containersWithMissingDisplayNames = {
  ...containers,
  containers: containers.containers.map((container) => ({
    ...container,
    containerDisplayName: null,
  })),
};

const grantsWithMissingDisplayNames = {
  ...grants,
  grants: grants.grants.map((grant) => ({
    ...grant,
    containerDisplayName: null,
  })),
};

const userDetail: OrganizationUserDetailResponse = {
  organizationId,
  user: {
    userId: "user-1",
    signingKeyFingerprint: "signing-fingerprint",
    signingPublicKey: "signing-key",
    encapsulationPublicKey: "encapsulation-key",
    encapsulationKeyFingerprint: "encapsulation-fingerprint",
    createdAt: "2026-05-16T12:00:00.000Z",
    isSelf: false,
  },
  groups: groups.groups,
  grants: {
    directGrants: [],
    groupGrants: grants.grants,
    organizationGrants: [],
  },
};

const userDetailWithMissingDisplayNames = {
  ...userDetail,
  grants: {
    directGrants: [],
    groupGrants: grants.grants.map((grant) => ({
      ...grant,
      containerDisplayName: null,
    })),
    organizationGrants: [],
  },
};

test("loadOrganizationDirectoryAndGroups combines directory and group lists", async () => {
  const calls: string[] = [];
  const result = await loadOrganizationDirectoryAndGroups({
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

test("loadOrganizationDirectoryAndGroups reports unavailable directory state", async () => {
  const result = await loadOrganizationDirectoryAndGroups({
    apiClient: {
      listOrganizationDirectory: async () => null,
      listOrganizationGroups: async () => groups,
    },
    organizationId,
  });

  expect(result).toBeNull();
});

test("loadOrganizationGroupDetails preserves partial group detail results", async () => {
  const calls: string[] = [];
  const result = await loadOrganizationGroupDetails({
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
    containers: containersWithMissingDisplayNames,
  });
});

test("loadOrganizationContainerGrants forwards organization grant enumeration", async () => {
  const calls: string[] = [];
  const result = await loadOrganizationContainerGrants({
    apiClient: {
      listOrganizationContainerGrants: async (nextOrganizationId) => {
        calls.push(`grants:${nextOrganizationId}`);
        return grants;
      },
    },
    organizationId,
  });

  expect(calls).toEqual(["grants:org-1"]);
  expect(result).toEqual(grantsWithMissingDisplayNames);
});

test("loadOrganizationDataUsage forwards organization usage summary", async () => {
  const calls: string[] = [];
  const result = await loadOrganizationDataUsage({
    apiClient: {
      getOrganizationDataUsage: async (nextOrganizationId) => {
        calls.push(`usage:${nextOrganizationId}`);
        return dataUsage;
      },
    },
    organizationId,
  });

  expect(calls).toEqual(["usage:org-1"]);
  expect(result).toEqual(dataUsage);
});

test("loadOrganizationUserDetail forwards user detail", async () => {
  const calls: string[] = [];
  const result = await loadOrganizationUserDetail({
    apiClient: {
      getOrganizationUserDetail: async (nextOrganizationId, nextUserId) => {
        calls.push(`detail:${nextOrganizationId}:${nextUserId}`);
        return userDetail;
      },
    },
    organizationId,
    userId: "user-1",
  });

  expect(calls).toEqual(["detail:org-1:user-1"]);
  expect(result).toEqual(userDetailWithMissingDisplayNames);
});

test("organization read models include local container display names", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-container-display-names-test",
  );

  try {
    await ensureContainerTables(execSql);
    await saveContainer(execSql, {
      id: "container-1",
      organizationId,
      parentId: null,
      metadataDocumentId: null,
      name: "Quarterly Planning",
      icon: null,
    });

    const groupDetails = await loadOrganizationGroupDetails({
      apiClient: {
        listOrganizationGroupMembers: async () => members,
        listOrganizationGroupContainers: async () => containers,
      },
      execSql,
      groupId,
      organizationId,
    });
    const organizationGrants = await loadOrganizationContainerGrants({
      apiClient: {
        listOrganizationContainerGrants: async () => grants,
      },
      execSql,
      organizationId,
    });
    const detail = await loadOrganizationUserDetail({
      apiClient: {
        getOrganizationUserDetail: async () => userDetail,
      },
      execSql,
      organizationId,
      userId: "user-1",
    });

    expect(groupDetails.containers?.containers[0]?.containerDisplayName).toBe(
      "Quarterly Planning",
    );
    expect(organizationGrants?.grants[0]?.containerDisplayName).toBe(
      "Quarterly Planning",
    );
    expect(detail?.grants.groupGrants[0]?.containerDisplayName).toBe(
      "Quarterly Planning",
    );
  } finally {
    close();
  }
});
