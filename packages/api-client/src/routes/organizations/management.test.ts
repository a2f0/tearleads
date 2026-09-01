import { expect, test } from "bun:test";
import {
  createOrganizationGroupOperation,
  deleteOrganizationGroupOperation,
  getOrganizationReadModelOperation,
  listOrganizationGroupMembersOperation,
  updateOrganizationProfileOperation,
  updateOrganizationRosterEntryOperation,
} from "@tearleads/validators/operation";
import { createOrganizationGroup } from "./createGroup";
import { deleteOrganizationGroup } from "./deleteGroup";
import { listOrganizationGroupMembers } from "./groupMembers";
import { updateOrganizationProfile } from "./profile";
import { getOrganizationReadModel } from "./readModel";
import { updateOrganizationRosterEntry } from "./roster";

const groupId = "22222222-2222-4222-8222-222222222222";
const organizationId = "11111111-1111-4111-8111-111111111111";
const userId = "33333333-3333-4333-8333-333333333333";

test("organization management client metadata derives from shared operations", () => {
  expect(createOrganizationGroup).toMatchObject({
    method: createOrganizationGroupOperation.method,
  });
  expect(createOrganizationGroup.path(organizationId)).toBe(
    `/organizations/${organizationId}/groups`,
  );
  expect(deleteOrganizationGroup).toMatchObject({
    method: deleteOrganizationGroupOperation.method,
  });
  expect(deleteOrganizationGroup.path(organizationId, groupId)).toBe(
    `/organizations/${organizationId}/groups/${groupId}`,
  );
  expect(listOrganizationGroupMembers).toMatchObject({
    method: listOrganizationGroupMembersOperation.method,
  });
  expect(listOrganizationGroupMembers.path(organizationId, groupId)).toBe(
    `/organizations/${organizationId}/groups/${groupId}/members`,
  );
  expect(updateOrganizationProfile).toMatchObject({
    method: updateOrganizationProfileOperation.method,
  });
  expect(updateOrganizationProfile.path(organizationId)).toBe(
    `/organizations/${organizationId}/profile`,
  );
  expect(getOrganizationReadModel).toMatchObject({
    method: getOrganizationReadModelOperation.method,
  });
  expect(getOrganizationReadModel.path(organizationId, "opaque+/=cursor")).toBe(
    `/organizations/${organizationId}/read-model?cursor=opaque%2B%2F%3Dcursor`,
  );
  expect(getOrganizationReadModel.path(organizationId, undefined)).toBe(
    `/organizations/${organizationId}/read-model`,
  );
  expect(() => getOrganizationReadModel.path("invalid", undefined)).toThrow(
    "Invalid path parameters for organizations.readModel.get",
  );
  expect(updateOrganizationRosterEntry).toMatchObject({
    method: updateOrganizationRosterEntryOperation.method,
  });
  expect(updateOrganizationRosterEntry.path(organizationId, userId)).toBe(
    `/organizations/${organizationId}/roster/${userId}`,
  );
  expect(() => createOrganizationGroup.path("invalid")).toThrow(
    "Invalid path parameters for organizations.groups.create",
  );
});
