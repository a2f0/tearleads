import { expect, test } from "bun:test";
import {
  isListOrganizationGroupsResponse,
  isOrganizationContainerGrantsResponse,
  isOrganizationDirectoryResponse,
  isOrganizationGroupContainersResponse,
  isOrganizationGroupMembersResponse,
  isOrganizationProfileResponse,
  isOrganizationUserDetailResponse,
} from "./index";

test("organization manager responses", () => {
  expect(
    isOrganizationDirectoryResponse({
      organizationId: "org-1",
      profileDocumentId: null,
      currentUser: { isOrgAdmin: true },
      users: [
        {
          userId: "user-1",
          signingKeyFingerprint: "signing-fingerprint",
          signingPublicKey: "signing-key",
          encapsulationPublicKey: "encapsulation-key",
          encapsulationKeyFingerprint: "encapsulation-fingerprint",
          createdAt: new Date().toISOString(),
          isPersonalOrganizationOwner: false,
          isSelf: true,
          status: "active",
          profileDocumentId: null,
          joinedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          disabledAt: null,
          disabledByUserId: null,
        },
      ],
    }),
  ).toBe(true);
  expect(
    isOrganizationDirectoryResponse({
      organizationId: "org-1",
      currentUser: { isOrgAdmin: false },
      users: [{ userId: "user-1" }],
    }),
  ).toBe(false);
  expect(
    isOrganizationProfileResponse({
      organizationId: "org-1",
      profileDocumentId: "profile-document-1",
    }),
  ).toBe(true);
  expect(isOrganizationProfileResponse({ organizationId: "org-1" })).toBe(
    false,
  );

  expect(
    isListOrganizationGroupsResponse({
      organizationId: "org-1",
      memberGroupId: "member-group-1",
      groups: [
        {
          groupId: "group-1",
          organizationId: "org-1",
          name: "Operators",
          createdAt: new Date().toISOString(),
          isBuiltin: false,
          currentState: {
            stateHash: "state-hash",
            version: 1,
            keyEpoch: 1,
            keyFingerprint: "key-fingerprint",
            memberCount: 1,
          },
        },
      ],
    }),
  ).toBe(true);
  expect(
    isListOrganizationGroupsResponse({
      organizationId: "org-1",
      groups: [],
    }),
  ).toBe(false);
  expect(
    isListOrganizationGroupsResponse({
      organizationId: "org-1",
      groups: [{ groupId: "group-1", currentState: { memberCount: -1 } }],
    }),
  ).toBe(false);

  expect(
    isOrganizationGroupMembersResponse({
      organizationId: "org-1",
      groupId: "group-1",
      members: [
        {
          userId: "user-1",
          role: "admin",
          signingKeyFingerprint: "signing-fingerprint",
          signingPublicKey: "signing-key",
          encapsulationPublicKey: "encapsulation-key",
          encapsulationKeyFingerprint: "encapsulation-fingerprint",
        },
      ],
    }),
  ).toBe(true);
  expect(isOrganizationGroupMembersResponse(null)).toBe(false);

  expect(
    isOrganizationGroupContainersResponse({
      organizationId: "org-1",
      groupId: "group-1",
      containers: [
        {
          accessLevel: "admin",
          containerId: "container-1",
          createdAt: new Date().toISOString(),
          depth: 0,
          isBuiltin: false,
          metadataAccessEpoch: 1,
          metadataAccessStateHash: "access-state-hash",
          metadataDocumentId: "metadata-document-1",
          parentId: null,
          updatedAt: new Date().toISOString(),
        },
      ],
    }),
  ).toBe(true);
  expect(
    isOrganizationGroupContainersResponse({
      organizationId: "org-1",
      groupId: "group-1",
      containers: [{ containerId: "container-1", accessLevel: "owner" }],
    }),
  ).toBe(false);

  expect(
    isOrganizationContainerGrantsResponse({
      organizationId: "org-1",
      grants: [
        {
          accessLevel: "admin",
          containerId: "container-1",
          createdAt: new Date().toISOString(),
          depth: 0,
          isBuiltin: true,
          metadataAccessEpoch: 1,
          metadataAccessStateHash: "access-state-hash",
          metadataDocumentId: "metadata-document-1",
          parentId: null,
          updatedAt: new Date().toISOString(),
          subjectType: "group",
          subjectId: "group-1",
          userId: null,
          signingKeyFingerprint: null,
          groupId: "group-1",
          groupName: "Admins",
        },
      ],
    }),
  ).toBe(true);
  expect(
    isOrganizationContainerGrantsResponse({
      organizationId: "org-1",
      grants: [{ containerId: "container-1", subjectType: "team" }],
    }),
  ).toBe(false);

  expect(
    isOrganizationUserDetailResponse({
      organizationId: "org-1",
      user: {
        userId: "user-1",
        signingKeyFingerprint: "signing-fingerprint",
        signingPublicKey: "signing-key",
        encapsulationPublicKey: "encapsulation-key",
        encapsulationKeyFingerprint: "encapsulation-fingerprint",
        createdAt: new Date().toISOString(),
        isPersonalOrganizationOwner: false,
        isSelf: true,
        status: "disabled",
        profileDocumentId: "profile-document-1",
        joinedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        disabledAt: new Date().toISOString(),
        disabledByUserId: "admin-1",
      },
      groups: [
        {
          groupId: "group-1",
          organizationId: "org-1",
          name: "Operators",
          createdAt: new Date().toISOString(),
          isBuiltin: false,
          currentState: null,
        },
      ],
      grants: {
        directGrants: [],
        groupGrants: [
          {
            accessLevel: "admin",
            containerId: "container-1",
            createdAt: new Date().toISOString(),
            depth: 0,
            isBuiltin: true,
            metadataAccessEpoch: 1,
            metadataAccessStateHash: "access-state-hash",
            metadataDocumentId: "metadata-document-1",
            parentId: null,
            updatedAt: new Date().toISOString(),
            subjectType: "group",
            subjectId: "group-1",
            userId: null,
            signingKeyFingerprint: null,
            groupId: "group-1",
            groupName: "Admins",
          },
        ],
      },
    }),
  ).toBe(true);
  expect(
    isOrganizationUserDetailResponse({
      organizationId: "org-1",
      user: { userId: "user-1" },
      groups: [],
      grants: {
        directGrants: [],
        groupGrants: [],
      },
    }),
  ).toBe(false);
});
