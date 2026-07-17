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

test("validates organization read-model snapshots and deltas", () => {
  expect(
    isOrganizationReadModelResponse({
      version: 1,
      mode: "snapshot",
      organizationId,
      nextCursor: "cursor-1",
      hasMore: false,
      currentUser: { isOrgAdmin: true },
      lanes: { directory, groups },
    }),
  ).toBe(true);
  expect(
    isOrganizationReadModelResponse({
      version: 1,
      mode: "delta",
      organizationId,
      nextCursor: "cursor-2",
      hasMore: false,
      currentUser: { isOrgAdmin: false },
      lanes: { groups },
    }),
  ).toBe(true);
  expect(
    isOrganizationReadModelResponse({
      version: 1,
      mode: "delta",
      organizationId,
      nextCursor: "cursor-2",
      hasMore: false,
      currentUser: { isOrgAdmin: true },
      lanes: {},
    }),
  ).toBe(true);
});

test("rejects incomplete or cross-organization read-model responses", () => {
  expect(
    isOrganizationReadModelResponse({
      version: 1,
      mode: "snapshot",
      organizationId,
      nextCursor: "cursor-1",
      hasMore: false,
      currentUser: { isOrgAdmin: true },
      lanes: { directory },
    }),
  ).toBe(false);
  expect(
    isOrganizationReadModelResponse({
      version: 1,
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
      version: 1,
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
      version: 1,
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
      version: 1,
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
      version: 1,
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
  expect(
    isOrganizationReadModelResponse({
      version: 1,
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
      version: 1,
      mode: "delta",
      organizationId,
      nextCursor: "cursor-2",
      hasMore: false,
      lanes: {},
    }),
  ).toBe(false);
  expect(
    isOrganizationReadModelResponse({
      version: 1,
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
        groups,
      },
    }),
  ).toBe(false);
});
