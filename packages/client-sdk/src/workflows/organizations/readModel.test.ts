import { expect, test } from "bun:test";
import type {
  ListOrganizationGroupsResponse,
  OrganizationContainerGrantsResponse,
  OrganizationDirectoryResponse,
  OrganizationGroupContainersResponse,
  OrganizationGroupMembersResponse,
  OrganizationUserDetailResponse,
  PrincipalPolicyBundleResponse,
} from "@tearleads/validators/response";
import { createTestExecSql } from "../../../test/helpers/createTestExecSql";
import {
  ensureContainerTables,
  saveContainer,
} from "../../data/persistence/containers/containerPersistence";
import {
  buildOrganizationGroupPolicyHistory,
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

const principalPolicy: PrincipalPolicyBundleResponse = {
  currentState: {
    principalType: "group",
    principalId: groupId,
    version: 3,
    prevStateHash: "group-state-2",
    keyEpoch: 2,
    encapsulationPublicKey: "group-encapsulation-public-key-2",
    keyFingerprint: "group-key-fingerprint-2",
    membershipMode: "projection",
    membershipRoot: "group-membership-root-3",
    projectionRoot: "group-projection-root-3",
    payloadCiphertextHash: "group-payload-hash-3",
    memberCount: 1,
    signedAt: "2026-05-16T12:10:00.000Z",
    signerUserId: "user-1",
    signerUserKeyFingerprint: "signing-fingerprint-1",
    signature: "group-signature-3",
    stateHash: "group-state-3",
    createdAt: "2026-05-16T12:10:01.000Z",
  },
  currentPayload: {
    principalType: "group",
    principalId: groupId,
    stateHash: "group-state-3",
    cipherSuite: "aes-256-gcm",
    ciphertext: "group-payload-3",
    ciphertextHash: "group-payload-hash-3",
    createdAt: "2026-05-16T12:10:01.000Z",
  },
  currentProjection: [
    {
      memberPrincipalType: "user",
      memberPrincipalId: "user-1",
      role: "admin",
    },
  ],
  currentMemberEnvelopes: {
    principalType: "group",
    principalId: groupId,
    stateHash: "group-state-3",
    epoch: 2,
    envelopes: [],
  },
  previousStates: [
    {
      state: {
        principalType: "group",
        principalId: groupId,
        version: 1,
        prevStateHash: null,
        keyEpoch: 1,
        encapsulationPublicKey: "group-encapsulation-public-key-1",
        keyFingerprint: "group-key-fingerprint-1",
        membershipMode: "projection",
        membershipRoot: "group-membership-root-1",
        projectionRoot: "group-projection-root-1",
        payloadCiphertextHash: "group-payload-hash-1",
        memberCount: 1,
        signedAt: "2026-05-16T12:00:00.000Z",
        signerUserId: "user-1",
        signerUserKeyFingerprint: "signing-fingerprint-1",
        signature: "group-signature-1",
        stateHash: "group-state-1",
        createdAt: "2026-05-16T12:00:01.000Z",
      },
      projection: [
        {
          memberPrincipalType: "user",
          memberPrincipalId: "user-1",
          role: "admin",
        },
      ],
    },
    {
      state: {
        principalType: "group",
        principalId: groupId,
        version: 2,
        prevStateHash: "group-state-1",
        keyEpoch: 1,
        encapsulationPublicKey: "group-encapsulation-public-key-1",
        keyFingerprint: "group-key-fingerprint-1",
        membershipMode: "projection",
        membershipRoot: "group-membership-root-2",
        projectionRoot: "group-projection-root-2",
        payloadCiphertextHash: "group-payload-hash-2",
        memberCount: 2,
        signedAt: "2026-05-16T12:05:00.000Z",
        signerUserId: "user-1",
        signerUserKeyFingerprint: "signing-fingerprint-1",
        signature: "group-signature-2",
        stateHash: "group-state-2",
        createdAt: "2026-05-16T12:05:01.000Z",
      },
      projection: [
        {
          memberPrincipalType: "user",
          memberPrincipalId: "user-1",
          role: "member",
        },
        {
          memberPrincipalType: "user",
          memberPrincipalId: "user-2",
          role: "member",
        },
      ],
    },
  ],
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
      isBuiltin: false,
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
      isBuiltin: true,
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
      getCurrentPrincipalPolicy: async (principalType, nextGroupId) => {
        calls.push(`policy:${principalType}:${nextGroupId}`);
        return principalPolicy;
      },
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
    "policy:group:group-1",
  ]);
  expect(result).toEqual({
    members,
    containers: containersWithMissingDisplayNames,
    policyHistory: buildOrganizationGroupPolicyHistory(principalPolicy),
  });
});

test("buildOrganizationGroupPolicyHistory diffs policy projections", () => {
  const history = buildOrganizationGroupPolicyHistory(principalPolicy);

  expect(history.groupId).toBe(groupId);
  expect(history.entries.map((entry) => entry.version)).toEqual([3, 2, 1]);
  expect(history.entries[0]?.changes).toEqual([
    {
      changeType: "role_changed",
      memberPrincipalType: "user",
      memberPrincipalId: "user-1",
      previousRole: "member",
      nextRole: "admin",
    },
    {
      changeType: "removed",
      memberPrincipalType: "user",
      memberPrincipalId: "user-2",
      previousRole: "member",
      nextRole: null,
    },
  ]);
  expect(history.entries[1]?.changes).toEqual([
    {
      changeType: "role_changed",
      memberPrincipalType: "user",
      memberPrincipalId: "user-1",
      previousRole: "admin",
      nextRole: "member",
    },
    {
      changeType: "added",
      memberPrincipalType: "user",
      memberPrincipalId: "user-2",
      previousRole: null,
      nextRole: "member",
    },
  ]);
  expect(history.entries[2]?.changes).toEqual([
    {
      changeType: "added",
      memberPrincipalType: "user",
      memberPrincipalId: "user-1",
      previousRole: null,
      nextRole: "admin",
    },
  ]);
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
        getCurrentPrincipalPolicy: async () => principalPolicy,
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
