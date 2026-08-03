import type {
  ListOrganizationGroupsResponse,
  OrganizationContainerGrantsResponse,
  OrganizationDataUsageResponse,
  OrganizationGroupContainersResponse,
  OrganizationUserDetailResponse,
  PrincipalPolicyBundleResponse,
} from "@tearleads/validators/response";

export const organizationId = "org-1";
export const groupId = "group-1";

const groups: ListOrganizationGroupsResponse = {
  organizationId,
  memberGroupId: "member-group-1",
  groups: [
    {
      groupId,
      organizationId,
      name: "Operators",
      createdAt: "2026-05-16T12:00:00.000Z",
      isBuiltin: false,
      currentState: null,
    },
  ],
};

export const principalPolicy: PrincipalPolicyBundleResponse = {
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
    memberEnvelopesRoot: "group-member-envelopes-root-3",
    projectionRoot: "group-projection-root-3",
    payloadCiphertextHash: "group-payload-hash-3",
    memberCount: 1,
    externalAuthority: null,
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
      userId: "user-1",
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
        memberEnvelopesRoot: "group-member-envelopes-root-1",
        projectionRoot: "group-projection-root-1",
        payloadCiphertextHash: "group-payload-hash-1",
        memberCount: 1,
        externalAuthority: null,
        signedAt: "2026-05-16T12:00:00.000Z",
        signerUserId: "user-1",
        signerUserKeyFingerprint: "signing-fingerprint-1",
        signature: "group-signature-1",
        stateHash: "group-state-1",
        createdAt: "2026-05-16T12:00:01.000Z",
      },
      projection: [
        {
          userId: "user-1",
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
        memberEnvelopesRoot: "group-member-envelopes-root-2",
        projectionRoot: "group-projection-root-2",
        payloadCiphertextHash: "group-payload-hash-2",
        memberCount: 2,
        externalAuthority: null,
        signedAt: "2026-05-16T12:05:00.000Z",
        signerUserId: "user-1",
        signerUserKeyFingerprint: "signing-fingerprint-1",
        signature: "group-signature-2",
        stateHash: "group-state-2",
        createdAt: "2026-05-16T12:05:01.000Z",
      },
      projection: [
        {
          userId: "user-1",
          role: "member",
        },
        {
          userId: "user-2",
          role: "member",
        },
      ],
    },
  ],
};

export const organizationPrincipalPolicy: PrincipalPolicyBundleResponse = {
  ...principalPolicy,
  currentState: {
    ...principalPolicy.currentState,
    principalType: "organization",
    principalId: organizationId,
  },
  currentPayload: {
    ...principalPolicy.currentPayload,
    principalType: "organization",
    principalId: organizationId,
  },
  currentMemberEnvelopes: {
    ...principalPolicy.currentMemberEnvelopes,
    principalType: "organization",
    principalId: organizationId,
  },
  previousStates: principalPolicy.previousStates.map((entry) => ({
    ...entry,
    state: {
      ...entry.state,
      principalType: "organization",
      principalId: organizationId,
    },
  })),
};

export const containers: OrganizationGroupContainersResponse = {
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

export const dataUsage: OrganizationDataUsageResponse = {
  organizationId,
  blobs: {
    blobCount: 2,
    byteLength: 96,
  },
  documents: {
    breakdown: [
      {
        category: "containerMetadata",
        byteLength: 0,
        documentCount: 0,
        updateCount: 0,
      },
      {
        category: "rosterProfiles",
        byteLength: 0,
        documentCount: 0,
        updateCount: 0,
      },
      {
        category: "organizationMetadata",
        byteLength: 0,
        documentCount: 0,
        updateCount: 0,
      },
      { category: "user", byteLength: 32, documentCount: 1, updateCount: 2 },
    ],
    byteLength: 32,
    documentCount: 1,
    updateCount: 2,
  },
  totalByteLength: 128,
};

export const userDetail: OrganizationUserDetailResponse = {
  organizationId,
  user: {
    userId: "user-1",
    signingKeyFingerprint: "signing-fingerprint",
    signingPublicKey: "signing-key",
    encapsulationPublicKey: "encapsulation-key",
    encapsulationKeyFingerprint: "encapsulation-fingerprint",
    createdAt: "2026-05-16T12:00:00.000Z",
    isSelf: false,
    status: "active",
    profileDocumentId: null,
    joinedAt: "2026-05-16T12:00:00.000Z",
    updatedAt: "2026-05-16T12:00:00.000Z",
    disabledAt: null,
    disabledByUserId: null,
  },
  groups: groups.groups,
  grants: {
    directGrants: [],
    groupGrants: grants.grants,
    organizationGrants: [],
  },
};
