import { expect, test } from "bun:test";
import type { OrganizationContainerGrant } from "@tearleads/client-sdk";
import { withoutOrganizationMetadataSystemGrants } from "./systemGrants";

const ADMINS = "group-admins";
const MEMBERS = "group-members";
const ROOT = "container-root";
const METADATA = "container-metadata";

function groupGrant(
  containerId: string,
  subjectId: string,
  isBuiltin: boolean,
): OrganizationContainerGrant {
  return {
    accessLevel: "admin",
    containerDisplayName: null,
    containerId,
    createdAt: "2026-05-20T12:00:00.000Z",
    depth: 0,
    groupId: subjectId,
    groupName: null,
    isBuiltin,
    metadataAccessEpoch: 1,
    metadataAccessStateHash: "access-state-hash",
    metadataDocumentId: null,
    parentId: null,
    signingKeyFingerprint: null,
    subjectId,
    subjectType: "group",
    updatedAt: "2026-05-20T12:00:00.000Z",
    userId: null,
  };
}

const rootAdmins = groupGrant(ROOT, ADMINS, true);
const metadataAdmins = groupGrant(METADATA, ADMINS, true);
const metadataMembers = groupGrant(METADATA, MEMBERS, true);
const customGrant = groupGrant(METADATA, "group-readers", false);

test("drops the metadata Members and Admins grants and keeps root Admins", () => {
  expect(
    withoutOrganizationMetadataSystemGrants(
      [[rootAdmins, metadataAdmins, metadataMembers, customGrant]],
      MEMBERS,
    ),
  ).toEqual([[rootAdmins, customGrant]]);
});

test("finds the metadata container across sections", () => {
  expect(
    withoutOrganizationMetadataSystemGrants(
      [[metadataAdmins, rootAdmins], [metadataMembers]],
      MEMBERS,
    ),
  ).toEqual([[rootAdmins], []]);
});

test("keeps every grant when the metadata container cannot be identified", () => {
  const sections = [[rootAdmins, metadataAdmins]];

  expect(withoutOrganizationMetadataSystemGrants(sections, MEMBERS)).toBe(
    sections,
  );
  expect(
    withoutOrganizationMetadataSystemGrants(
      [[rootAdmins, metadataAdmins, metadataMembers]],
      null,
    ),
  ).toEqual([[rootAdmins, metadataAdmins, metadataMembers]]);
});

test("a non-built-in Members grant does not mark its container", () => {
  const customMembers = groupGrant(ROOT, MEMBERS, false);

  expect(
    withoutOrganizationMetadataSystemGrants(
      [[rootAdmins, customMembers]],
      MEMBERS,
    ),
  ).toEqual([[rootAdmins, customMembers]]);
});
