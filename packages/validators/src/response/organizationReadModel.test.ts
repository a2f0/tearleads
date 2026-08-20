import { expect, test } from "bun:test";
import { isOrganizationReadModelResponse } from "./organizationReadModel";

const organizationId = "organization-1";
const directory = {
  organizationId,
  profileDocumentId: null,
  users: [],
};
const groups = {
  organizationId,
  memberGroupId: "member-group-1",
  groups: [
    {
      groupId: "group-1",
      organizationId,
      name: "Admins",
      createdAt: "2026-07-16T00:00:00.000Z",
      isBuiltin: true,
      currentState: {
        stateHash: "group-state-1",
        version: 1,
        keyEpoch: 1,
        keyFingerprint: "group-key-fingerprint-1",
        memberCount: 1,
      },
    },
  ],
};
const organizationPolicy = {
  organizationId,
  currentState: {
    stateHash: "organization-state-1",
    version: 1,
    keyEpoch: 1,
    keyFingerprint: "organization-key-fingerprint-1",
    memberCount: 1,
  },
};
const grant = {
  accessLevel: "admin",
  containerId: "container-1",
  createdAt: "2026-07-16T00:00:00.000Z",
  depth: 0,
  isBuiltin: true,
  metadataAccessEpoch: 1,
  metadataAccessStateHash: "manifest-1",
  metadataDocumentId: "document-1",
  parentId: null,
  updatedAt: "2026-07-16T00:00:00.000Z",
  subjectType: "group",
  subjectId: "group-1",
  userId: null,
  signingKeyFingerprint: null,
  groupId: "group-1",
  groupName: "Admins",
};
const grants = { organizationId, grants: [grant] };
const groupMemberships = {
  organizationId,
  deletedGroupIds: [],
  groups: [
    {
      groupId: "member-group-1",
      stateHash: "member-state-1",
      members: [
        {
          userId: "user-1",
          role: "admin",
          signingKeyFingerprint: "signing-fingerprint-1",
          signingPublicKey: "signing-public-key-1",
          encapsulationPublicKey: "encapsulation-public-key-1",
          encapsulationKeyFingerprint: "encapsulation-fingerprint-1",
        },
      ],
    },
  ],
};

test("validates organization read-model snapshots and deltas", () => {
  expect(
    isOrganizationReadModelResponse({
      version: 5,
      mode: "snapshot",
      organizationId,
      nextCursor: "cursor-1",
      hasMore: false,
      currentUser: { isOrgAdmin: true },
      lanes: {
        directory,
        grants,
        groupMemberships,
        groups,
        organizationPolicy,
      },
    }),
  ).toBe(true);
  expect(
    isOrganizationReadModelResponse({
      version: 5,
      mode: "delta",
      organizationId,
      nextCursor: "cursor-2",
      hasMore: false,
      currentUser: { isOrgAdmin: false },
      lanes: { grants, groupMemberships, organizationPolicy },
    }),
  ).toBe(true);
  expect(
    isOrganizationReadModelResponse({
      version: 5,
      mode: "delta",
      organizationId,
      nextCursor: "cursor-2",
      hasMore: false,
      currentUser: { isOrgAdmin: true },
      lanes: {},
    }),
  ).toBe(true);
});

test("rejects legacy protocols and incomplete snapshots", () => {
  // v4 is the version this reset replaced. Its group members carried
  // memberPrincipalType/memberPrincipalId rather than userId, so accepting a v4
  // response would read every member as having no id.
  expect(
    isOrganizationReadModelResponse({
      version: 4,
      mode: "snapshot",
      organizationId,
      nextCursor: "cursor-v4",
      hasMore: false,
      currentUser: { isOrgAdmin: true },
      lanes: { directory, grants, groupMemberships, groups },
    }),
  ).toBe(false);
  expect(
    isOrganizationReadModelResponse({
      version: 1,
      mode: "snapshot",
      organizationId,
      nextCursor: "cursor-1",
      hasMore: false,
      currentUser: { isOrgAdmin: true },
      lanes: { directory, grants, groupMemberships, groups },
    }),
  ).toBe(false);
  expect(
    isOrganizationReadModelResponse({
      version: 5,
      mode: "delta",
      organizationId,
      nextCursor: "cursor-2",
      hasMore: false,
      currentUser: { isOrgAdmin: true },
      lanes: {
        groups: {
          ...groups,
          groups: [
            {
              ...groups.groups[0],
              currentState: {
                stateHash: "group-state-1",
                version: 1,
                keyEpoch: 1,
                memberCount: 1,
              },
            },
          ],
        },
      },
    }),
  ).toBe(false);
  expect(
    isOrganizationReadModelResponse({
      version: 2,
      mode: "snapshot",
      organizationId,
      nextCursor: "cursor-1",
      hasMore: false,
      currentUser: { isOrgAdmin: true },
      lanes: { directory, grants, groupMemberships, groups },
    }),
  ).toBe(false);
  expect(
    isOrganizationReadModelResponse({
      version: 3,
      mode: "snapshot",
      organizationId,
      nextCursor: "cursor-1",
      hasMore: false,
      currentUser: { isOrgAdmin: true },
      lanes: {
        directory,
        grants,
        groupMemberships,
        groups,
        organizationPolicy,
      },
    }),
  ).toBe(false);
  expect(
    isOrganizationReadModelResponse({
      version: 5,
      mode: "snapshot",
      organizationId,
      nextCursor: "cursor-1",
      hasMore: false,
      currentUser: { isOrgAdmin: true },
      lanes: { directory, groups },
    }),
  ).toBe(false);
});

test("rejects cross-organization or malformed read-model lanes", () => {
  expect(
    isOrganizationReadModelResponse({
      version: 5,
      mode: "delta",
      organizationId,
      nextCursor: "cursor-2",
      hasMore: false,
      currentUser: { isOrgAdmin: true },
      lanes: {
        groups: { ...groups, organizationId: "organization-2" },
      },
    }),
  ).toBe(false);
  expect(
    isOrganizationReadModelResponse({
      version: 5,
      mode: "delta",
      organizationId,
      nextCursor: "cursor-2",
      hasMore: false,
      currentUser: { isOrgAdmin: true },
      lanes: {
        organizationPolicy: {
          ...organizationPolicy,
          organizationId: "organization-2",
        },
      },
    }),
  ).toBe(false);
  expect(
    isOrganizationReadModelResponse({
      version: 5,
      mode: "delta",
      organizationId,
      nextCursor: "cursor-2",
      hasMore: false,
      currentUser: { isOrgAdmin: true },
      lanes: {
        organizationPolicy: {
          ...organizationPolicy,
          currentState: {
            ...organizationPolicy.currentState,
            unexpected: true,
          },
        },
      },
    }),
  ).toBe(false);
  expect(
    isOrganizationReadModelResponse({
      version: 5,
      mode: "delta",
      organizationId,
      nextCursor: "cursor-2",
      hasMore: false,
      currentUser: { isOrgAdmin: true },
      lanes: { grants: { ...grants, organizationId: "organization-2" } },
    }),
  ).toBe(false);
  expect(
    isOrganizationReadModelResponse({
      version: 5,
      mode: "delta",
      organizationId,
      nextCursor: "cursor-2",
      hasMore: false,
      currentUser: { isOrgAdmin: true },
      lanes: {
        groupMemberships: {
          ...groupMemberships,
          organizationId: "organization-2",
        },
      },
    }),
  ).toBe(false);
  expect(
    isOrganizationReadModelResponse({
      version: 5,
      mode: "delta",
      organizationId,
      nextCursor: "cursor-2",
      hasMore: false,
      currentUser: { isOrgAdmin: true },
      lanes: {
        groupMemberships: {
          ...groupMemberships,
          groups: [
            {
              ...groupMemberships.groups[0],
              stateHash: "",
            },
          ],
        },
      },
    }),
  ).toBe(false);
  expect(
    isOrganizationReadModelResponse({
      version: 5,
      mode: "delta",
      organizationId,
      nextCursor: "cursor-2",
      hasMore: false,
      currentUser: { isOrgAdmin: true },
      lanes: { groups: { ...groups, memberships: [] } },
    }),
  ).toBe(false);
  expect(
    isOrganizationReadModelResponse({
      version: 5,
      mode: "delta",
      organizationId,
      nextCursor: "cursor-2",
      hasMore: false,
      currentUser: { isOrgAdmin: true },
      lanes: {
        groups: {
          ...groups,
          groups: [
            {
              groupId: "group-1",
              organizationId: "organization-2",
              name: "Foreign",
              createdAt: "2026-07-16T00:00:00.000Z",
              isBuiltin: false,
              currentState: null,
            },
          ],
        },
      },
    }),
  ).toBe(false);
});

test("rejects ambiguous group-membership lane data", () => {
  const membershipGroup = groupMemberships.groups[0];
  if (!membershipGroup) {
    throw new Error("expected membership group fixture");
  }
  const duplicateMemberGroup = {
    ...membershipGroup,
    members: [membershipGroup.members[0], membershipGroup.members[0]],
  };
  const invalidLanes = [
    { ...groupMemberships, groups: [membershipGroup, membershipGroup] },
    {
      ...groupMemberships,
      deletedGroupIds: ["deleted-group-1", "deleted-group-1"],
      groups: [],
    },
    {
      ...groupMemberships,
      deletedGroupIds: [membershipGroup.groupId],
    },
    { ...groupMemberships, deletedGroupIds: [""], groups: [] },
    { ...groupMemberships, groups: [duplicateMemberGroup] },
  ];

  for (const groupMembershipLane of invalidLanes) {
    expect(
      isOrganizationReadModelResponse({
        version: 5,
        mode: "delta",
        organizationId,
        nextCursor: "cursor-2",
        hasMore: false,
        currentUser: { isOrgAdmin: true },
        lanes: { groupMemberships: groupMembershipLane },
      }),
    ).toBe(false);
  }

  expect(
    isOrganizationReadModelResponse({
      version: 5,
      mode: "snapshot",
      organizationId,
      nextCursor: "cursor-2",
      hasMore: false,
      currentUser: { isOrgAdmin: true },
      lanes: {
        directory,
        grants,
        groupMemberships: {
          ...groupMemberships,
          deletedGroupIds: ["deleted-group-1"],
        },
        groups,
        organizationPolicy,
      },
    }),
  ).toBe(false);
});

test("rejects ambiguous or malformed grants", () => {
  const invalidGrants = [
    { ...grants, grants: [grant, grant] },
    { ...grants, grants: [{ ...grant, groupId: "group-2" }] },
    { ...grants, grants: [{ ...grant, signingKeyFingerprint: "unexpected" }] },
    { ...grants, grants: [{ ...grant, unexpected: true }] },
  ];

  for (const grantsLane of invalidGrants) {
    expect(
      isOrganizationReadModelResponse({
        version: 5,
        mode: "delta",
        organizationId,
        nextCursor: "cursor-2",
        hasMore: false,
        currentUser: { isOrgAdmin: true },
        lanes: { grants: grantsLane },
      }),
    ).toBe(false);
  }
});

test("rejects invalid envelopes and legacy fields", () => {
  expect(
    isOrganizationReadModelResponse({
      version: 5,
      mode: "delta",
      organizationId,
      nextCursor: "",
      hasMore: false,
      currentUser: { isOrgAdmin: true },
      lanes: {},
    }),
  ).toBe(false);
  expect(
    isOrganizationReadModelResponse({
      version: 5,
      mode: "delta",
      organizationId,
      nextCursor: "cursor-2",
      hasMore: false,
      currentUser: { isOrgAdmin: true },
      lanes: { grants: [] },
    }),
  ).toBe(false);
  expect(
    isOrganizationReadModelResponse({
      version: 5,
      mode: "delta",
      organizationId,
      nextCursor: "cursor-2",
      hasMore: false,
      currentUser: { isOrgAdmin: true },
      lanes: {},
      legacyDirectory: null,
    }),
  ).toBe(false);
});

test("requires requester metadata only at the response top level", () => {
  expect(
    isOrganizationReadModelResponse({
      version: 5,
      mode: "delta",
      organizationId,
      nextCursor: "cursor-2",
      hasMore: false,
      lanes: {},
    }),
  ).toBe(false);
  expect(
    isOrganizationReadModelResponse({
      version: 5,
      mode: "snapshot",
      organizationId,
      nextCursor: "cursor-2",
      hasMore: false,
      currentUser: { isOrgAdmin: true },
      lanes: {
        directory: {
          ...directory,
          currentUser: { isOrgAdmin: true },
        },
        grants,
        groupMemberships,
        groups,
        organizationPolicy,
      },
    }),
  ).toBe(false);
});
