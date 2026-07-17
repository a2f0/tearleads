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
  groups: [],
};
const groupMemberships = {
  organizationId,
  deletedGroupIds: [],
  groups: [
    {
      groupId: "member-group-1",
      stateHash: "member-state-1",
      members: [
        {
          memberPrincipalType: "user",
          memberPrincipalId: "user-1",
          role: "admin",
          userId: "user-1",
          signingKeyFingerprint: "signing-fingerprint-1",
          signingPublicKey: "signing-public-key-1",
          encapsulationPublicKey: "encapsulation-public-key-1",
          encapsulationKeyFingerprint: "encapsulation-fingerprint-1",
          groupId: null,
          groupName: null,
        },
      ],
    },
  ],
};

test("validates organization read-model snapshots and deltas", () => {
  expect(
    isOrganizationReadModelResponse({
      version: 2,
      mode: "snapshot",
      organizationId,
      nextCursor: "cursor-1",
      hasMore: false,
      currentUser: { isOrgAdmin: true },
      lanes: { directory, groupMemberships, groups },
    }),
  ).toBe(true);
  expect(
    isOrganizationReadModelResponse({
      version: 2,
      mode: "delta",
      organizationId,
      nextCursor: "cursor-2",
      hasMore: false,
      currentUser: { isOrgAdmin: false },
      lanes: { groupMemberships },
    }),
  ).toBe(true);
  expect(
    isOrganizationReadModelResponse({
      version: 2,
      mode: "delta",
      organizationId,
      nextCursor: "cursor-2",
      hasMore: false,
      currentUser: { isOrgAdmin: true },
      lanes: {},
    }),
  ).toBe(true);
});

test("rejects protocol v1 and incomplete snapshots", () => {
  expect(
    isOrganizationReadModelResponse({
      version: 1,
      mode: "snapshot",
      organizationId,
      nextCursor: "cursor-1",
      hasMore: false,
      currentUser: { isOrgAdmin: true },
      lanes: { directory, groupMemberships, groups },
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
      lanes: { directory, groups },
    }),
  ).toBe(false);
});

test("rejects cross-organization or malformed read-model lanes", () => {
  expect(
    isOrganizationReadModelResponse({
      version: 2,
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
      version: 2,
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
      version: 2,
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
      version: 2,
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
      version: 2,
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
        version: 2,
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
      version: 2,
      mode: "snapshot",
      organizationId,
      nextCursor: "cursor-2",
      hasMore: false,
      currentUser: { isOrgAdmin: true },
      lanes: {
        directory,
        groupMemberships: {
          ...groupMemberships,
          deletedGroupIds: ["deleted-group-1"],
        },
        groups,
      },
    }),
  ).toBe(false);
});

test("rejects invalid envelopes and legacy fields", () => {
  expect(
    isOrganizationReadModelResponse({
      version: 2,
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
      version: 2,
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
      version: 2,
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
      version: 2,
      mode: "delta",
      organizationId,
      nextCursor: "cursor-2",
      hasMore: false,
      lanes: {},
    }),
  ).toBe(false);
  expect(
    isOrganizationReadModelResponse({
      version: 2,
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
        groupMemberships,
        groups,
      },
    }),
  ).toBe(false);
});
