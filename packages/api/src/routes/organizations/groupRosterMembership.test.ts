import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  groups,
  organizationRosterEntries,
  organizations,
} from "@tearleads/api-shared/schema";
import { createTestUser, type TestUser } from "@tearleads/bob-and-alice";
import { and, eq } from "drizzle-orm";
import invariant from "invariant";
import {
  createGroupRequest,
  deleteGroupRequest,
} from "../../../test/helpers/organizationGroup";
import { joinOrg } from "../../../test/helpers/organizationMembership";
import { withGroupMembershipContainerMutations } from "../../../test/helpers/organizationMembershipGrants";
import {
  getDefaultOrganizationId,
  loadVerifiedPrincipalPolicy,
  submitOrganizationGroupPolicyCommit,
} from "../../../test/helpers/principalPolicy";
import { registerAndAuthenticate } from "../../../test/helpers/principalPolicyReadFixtures";
import { signGroupSuccessor } from "../../../test/helpers/rotatedReadGroupGrant";
import { getCurrentPrincipalState } from "../../access/read/principalStateStore";
import { routeApp } from "../../routeApp";

async function createGroup(owner: TestUser, additionalMembers: TestUser[]) {
  const organizationId = await getDefaultOrganizationId(owner.userId);
  const groupId = crypto.randomUUID();
  const response = await routeApp.request(
    `/organizations/${organizationId}/groups`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        await createGroupRequest({
          actor: owner,
          additionalMembers,
          groupId,
          name: "Roster only",
        }),
      ),
    },
  );
  return { groupId, organizationId, response };
}

async function commitMembers(input: {
  owner: TestUser;
  organizationId: string;
  groupId: string;
  members: TestUser[];
}) {
  const current = await loadVerifiedPrincipalPolicy(db, "group", input.groupId);
  const successor = await signGroupSuccessor({
    actor: input.owner,
    current,
    grants: current.grants,
    projection: [
      { userId: input.owner.userId, role: "admin" },
      ...input.members.map(({ userId }) => ({
        userId,
        role: "member" as const,
      })),
    ],
  });
  return submitOrganizationGroupPolicyCommit({
    actor: input.owner,
    organizationId: input.organizationId,
    groupId: input.groupId,
    groupPolicy: await withGroupMembershipContainerMutations({
      actor: input.owner,
      currentPolicy: current,
      signedState: successor.request,
    }),
  });
}

async function rosterStatus(organizationId: string, userId: string) {
  const [entry] = await db
    .select({ status: organizationRosterEntries.status })
    .from(organizationRosterEntries)
    .where(
      and(
        eq(organizationRosterEntries.organizationId, organizationId),
        eq(organizationRosterEntries.userId, userId),
      ),
    );
  return entry?.status;
}

test("group creation refuses another organization's user and rolls back", async () => {
  const owner = createTestUser();
  const outsider = createTestUser();
  await registerAndAuthenticate(owner, outsider);
  const organizationId = await getDefaultOrganizationId(owner.userId);
  expect(await rosterStatus(organizationId, outsider.userId)).toBeUndefined();
  expect(
    await rosterStatus(
      await getDefaultOrganizationId(outsider.userId),
      outsider.userId,
    ),
  ).toBe("active");
  const before = await getCurrentPrincipalState(
    "organization",
    organizationId,
    db,
  );
  const { groupId, response } = await createGroup(owner, [outsider]);
  expect(response.status, await response.clone().text()).toBe(409);
  expect(await response.json()).toEqual({
    error: "Principal contains users who are not active organization members",
  });
  expect(await getCurrentPrincipalState("group", groupId, db)).toBeNull();
  expect(await db.select().from(groups).where(eq(groups.id, groupId))).toEqual(
    [],
  );
  expect(
    await getCurrentPrincipalState("organization", organizationId, db),
  ).toEqual(before);
});

test("group successors require active roster membership in the same organization", async () => {
  const owner = createTestUser();
  const outsider = createTestUser();
  await registerAndAuthenticate(owner, outsider);
  const { groupId, organizationId, response } = await createGroup(owner, []);
  expect(response.status, await response.clone().text()).toBe(200);
  const before = await getCurrentPrincipalState("group", groupId, db);
  const orgBefore = await getCurrentPrincipalState(
    "organization",
    organizationId,
    db,
  );
  const rejected = await commitMembers({
    owner,
    groupId,
    organizationId,
    members: [outsider],
  });
  expect(rejected.status, await rejected.clone().text()).toBe(409);
  expect(await rejected.json()).toEqual({
    error: "Principal contains users who are not active organization members",
  });
  expect(await getCurrentPrincipalState("group", groupId, db)).toEqual(before);
  expect(
    await getCurrentPrincipalState("organization", organizationId, db),
  ).toEqual(orgBefore);
  await joinOrg(organizationId, owner, outsider);
  const accepted = await commitMembers({
    owner,
    groupId,
    organizationId,
    members: [outsider],
  });
  expect(accepted.status, await accepted.clone().text()).toBe(200);
});

test.each(["remove", "delete"] as const)(
  "Members removal requires %s of ordinary membership first and ignores its retained history",
  async (operation) => {
    const owner = createTestUser();
    const member = createTestUser();
    await registerAndAuthenticate(owner, member);
    const organizationId = await getDefaultOrganizationId(owner.userId);
    await joinOrg(organizationId, owner, member);
    const { groupId, response } = await createGroup(owner, [member]);
    expect(response.status, await response.clone().text()).toBe(200);
    const [organization] = await db
      .select({ memberGroupId: organizations.memberGroupId })
      .from(organizations)
      .where(eq(organizations.id, organizationId));
    invariant(organization, "expected organization");
    const before = await getCurrentPrincipalState(
      "group",
      organization.memberGroupId,
      db,
    );
    const orgBefore = await getCurrentPrincipalState(
      "organization",
      organizationId,
      db,
    );
    const rejected = await commitMembers({
      owner,
      organizationId,
      groupId: organization.memberGroupId,
      members: [],
    });
    expect(rejected.status, await rejected.clone().text()).toBe(409);
    expect(await rejected.json()).toEqual({
      error:
        "Remove users from other organization groups before removing them from Members",
    });
    expect(
      await getCurrentPrincipalState("group", organization.memberGroupId, db),
    ).toEqual(before);
    expect(
      await getCurrentPrincipalState("organization", organizationId, db),
    ).toEqual(orgBefore);
    expect(await rosterStatus(organizationId, member.userId)).toBe("active");
    const removed =
      operation === "delete"
        ? await deleteGroupRequest({ actor: owner, organizationId, groupId })
        : await commitMembers({ owner, organizationId, groupId, members: [] });
    expect(removed.status, await removed.clone().text()).toBe(200);
    const disabled = await commitMembers({
      owner,
      organizationId,
      groupId: organization.memberGroupId,
      members: [],
    });
    expect(disabled.status, await disabled.clone().text()).toBe(200);
    expect(await rosterStatus(organizationId, member.userId)).toBe("disabled");
  },
);
