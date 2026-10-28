import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  organizationRosterEntries,
  organizations,
  users,
} from "@tearleads/api-shared/schema";
import { signOrganizationLeaveRequest } from "@tearleads/crypto";
import { createTestUser, type TestUser } from "@tearleads/test-utils";
import {
  isOrganizationMembershipResponse,
  isOrganizationReadModelResponse,
} from "@tearleads/validators/response";
import { and, eq } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import { addUserToAdminGroup } from "../../../test/helpers/organizationAdmin";
import {
  addMemberGroupUser,
  removeMemberGroupUser,
} from "../../../test/helpers/organizationMember";
import {
  addOrganizationMember,
  getDefaultOrganizationId,
} from "../../../test/helpers/organizationMembership";
import { loadVerifiedPrincipalPolicy } from "../../../test/helpers/principalPolicy";
import { registerUser } from "../../../test/helpers/registerUser";
import type { PublishedRealtimeEvent } from "../../realtime/publishedRealtimeEvents";
import { createRouteApp } from "../../routeApp";

async function registeredUser(): Promise<TestUser> {
  const user = createTestUser();
  await registerUser(user);
  await authenticate(user);
  return user;
}

/** A founder's organization with a second user enrolled in Members. */
async function organizationWithMember() {
  const founder = await registeredUser();
  const member = await registeredUser();
  const organizationId = await getDefaultOrganizationId(founder.userId);
  await addOrganizationMember({ actor: founder, member, organizationId });
  return { founder, member, organizationId };
}

/** The organization's current Members head, as a member's client cites it. */
async function currentMembersHead(organizationId: string) {
  const [organization] = await db
    .select({ memberGroupId: organizations.memberGroupId })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  invariant(organization, "expected the organization row");
  const { state } = await loadVerifiedPrincipalPolicy(
    db,
    "group",
    organization.memberGroupId,
  );
  return {
    keyEpoch: state.keyEpoch,
    keyFingerprint: state.keyFingerprint,
    principalId: state.principalId,
    stateHash: state.stateHash,
    version: state.version,
  };
}

type MembersHead = Awaited<ReturnType<typeof currentMembersHead>>;

async function signedRequest(
  signer: TestUser,
  input: {
    membersHead?: MembersHead;
    organizationId: string;
    requestedAt?: string;
    signing?: TestUser["signing"];
    userId?: string;
  },
) {
  return signOrganizationLeaveRequest(
    {
      membersHead:
        input.membersHead ?? (await currentMembersHead(input.organizationId)),
      organizationId: input.organizationId,
      requestedAt: input.requestedAt ?? new Date().toISOString(),
      userId: input.userId ?? signer.userId,
    },
    input.signing ?? signer.signing,
  );
}

function createApp(published: PublishedRealtimeEvent[] = []) {
  return createRouteApp({
    publish: async (event) => {
      published.push(event);
    },
  });
}

function leaveRequestPath(organizationId: string): string {
  return `/organization-memberships/${organizationId}/leave-request`;
}

async function putLeaveRequest(
  app: ReturnType<typeof createApp>,
  user: TestUser,
  organizationId: string,
  body: unknown,
): Promise<Response> {
  return app.request(leaveRequestPath(organizationId), {
    body: JSON.stringify(body),
    headers: {
      Authorization: `Bearer ${user.token}`,
      "Content-Type": "application/json",
    },
    method: "PUT",
  });
}

async function directoryLeaveRequest(
  app: ReturnType<typeof createApp>,
  viewer: TestUser,
  organizationId: string,
  userId: string,
) {
  const response = await app.request(
    `/organizations/${organizationId}/read-model`,
    { headers: { Authorization: `Bearer ${viewer.token}` } },
  );
  expect(response.status).toBe(200);
  const body: unknown = await response.json();
  invariant(
    isOrganizationReadModelResponse(body) && body.mode === "snapshot",
    "expected organization read-model snapshot",
  );
  return body.lanes.directory.users.find((user) => user.userId === userId)
    ?.leaveRequest;
}

test("a member files a signed leave request that administrators can read", async () => {
  const published: PublishedRealtimeEvent[] = [];
  const app = createApp(published);
  const { founder, member, organizationId } = await organizationWithMember();
  const request = await signedRequest(member, { organizationId });

  const response = await putLeaveRequest(app, member, organizationId, request);

  expect(response.status).toBe(200);
  const body: unknown = await response.json();
  expect(
    isOrganizationMembershipResponse(body) ? body.leaveRequestedAt : null,
  ).toBe(request.requestedAt);
  expect(published).toContainEqual({
    type: "organization_memberships_changed",
    userId: member.userId,
  });
  expect(
    await directoryLeaveRequest(app, founder, organizationId, member.userId),
  ).toEqual(request);

  const withdrawn = await app.request(leaveRequestPath(organizationId), {
    headers: { Authorization: `Bearer ${member.token}` },
    method: "DELETE",
  });
  expect(withdrawn.status).toBe(200);
  expect(
    await directoryLeaveRequest(app, founder, organizationId, member.userId),
  ).toBeNull();
});

test("a leave request must be the member's own, current, and correctly signed", async () => {
  const app = createApp();
  const { founder, member, organizationId } = await organizationWithMember();

  const membersHead = await currentMembersHead(organizationId);
  const signedByAnother = await signedRequest(member, {
    organizationId,
    signing: founder.signing,
  });
  const stale = await signedRequest(member, {
    organizationId,
    requestedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  });
  const otherOrganization = await signedRequest(member, {
    membersHead,
    organizationId: crypto.randomUUID(),
  });
  const otherMember = await signedRequest(member, {
    organizationId,
    userId: founder.userId,
  });
  const otherGroup = await signedRequest(member, {
    membersHead: { ...membersHead, principalId: crypto.randomUUID() },
    organizationId,
  });

  for (const body of [
    signedByAnother,
    stale,
    otherOrganization,
    otherMember,
    otherGroup,
  ]) {
    expect(
      (await putLeaveRequest(app, member, organizationId, body)).status,
    ).toBe(400);
  }
  expect(
    await directoryLeaveRequest(app, founder, organizationId, member.userId),
  ).toBeNull();
});

test("a personal organization or a sole administrator cannot ask to leave", async () => {
  const app = createApp();
  const founder = await registeredUser();
  const organizationId = await getDefaultOrganizationId(founder.userId);

  expect(
    (
      await putLeaveRequest(
        app,
        founder,
        organizationId,
        await signedRequest(founder, { organizationId }),
      )
    ).status,
  ).toBe(409);

  // Once the organization is no longer the founder's personal one, the
  // founder is still its only administrator.
  await db
    .update(users)
    .set({ defaultOrganizationId: crypto.randomUUID() })
    .where(eq(users.id, founder.userId));
  expect(
    (
      await putLeaveRequest(
        app,
        founder,
        organizationId,
        await signedRequest(founder, { organizationId }),
      )
    ).status,
  ).toBe(409);
});

test("removing the member clears their leave request", async () => {
  const app = createApp();
  const { founder, member, organizationId } = await organizationWithMember();
  expect(
    (
      await putLeaveRequest(
        app,
        member,
        organizationId,
        await signedRequest(member, { organizationId }),
      )
    ).status,
  ).toBe(200);

  await removeMemberGroupUser({
    actor: founder,
    memberUserId: member.userId,
    organizationId,
  });

  const [entry] = await db
    .select({
      leaveRequest: organizationRosterEntries.leaveRequest,
      status: organizationRosterEntries.status,
    })
    .from(organizationRosterEntries)
    .where(
      and(
        eq(organizationRosterEntries.organizationId, organizationId),
        eq(organizationRosterEntries.userId, member.userId),
      ),
    );
  expect(entry).toEqual({ leaveRequest: null, status: "disabled" });
});

/** A founder's organization with two non-admin Members. */
async function organizationWithMembers() {
  const founder = await registeredUser();
  const member = await registeredUser();
  const colleague = await registeredUser();
  const organizationId = await getDefaultOrganizationId(founder.userId);
  await addOrganizationMember({ actor: founder, member, organizationId });
  await addOrganizationMember({
    actor: founder,
    member: colleague,
    organizationId,
  });
  return { colleague, founder, member, organizationId };
}

async function readModel(
  app: ReturnType<typeof createApp>,
  viewer: TestUser,
  organizationId: string,
  cursor?: string,
) {
  const response = await app.request(
    `/organizations/${organizationId}/read-model${cursor ? `?cursor=${cursor}` : ""}`,
    { headers: { Authorization: `Bearer ${viewer.token}` } },
  );
  expect(response.status).toBe(200);
  const body: unknown = await response.json();
  invariant(
    isOrganizationReadModelResponse(body),
    "expected organization read model",
  );
  return body;
}

test("only administrators and the member see a pending leave request", async () => {
  const app = createApp();
  const { colleague, founder, member, organizationId } =
    await organizationWithMembers();
  const request = await signedRequest(member, { organizationId });
  expect(
    (await putLeaveRequest(app, member, organizationId, request)).status,
  ).toBe(200);

  expect(
    await directoryLeaveRequest(app, founder, organizationId, member.userId),
  ).toEqual(request);
  expect(
    await directoryLeaveRequest(app, member, organizationId, member.userId),
  ).toEqual(request);
  expect(
    await directoryLeaveRequest(app, colleague, organizationId, member.userId),
  ).toBeNull();
});

test("a new administrator's next directory delta carries pending leave requests", async () => {
  const app = createApp();
  const { colleague, founder, member, organizationId } =
    await organizationWithMembers();
  const request = await signedRequest(member, { organizationId });
  expect(
    (await putLeaveRequest(app, member, organizationId, request)).status,
  ).toBe(200);
  const before = await readModel(app, colleague, organizationId);
  invariant(before.mode === "snapshot", "expected a snapshot");
  expect(
    before.lanes.directory.users.find((user) => user.userId === member.userId)
      ?.leaveRequest,
  ).toBeNull();

  await addUserToAdminGroup({
    actor: founder,
    member: colleague,
    organizationId,
  });

  const delta = await readModel(
    app,
    colleague,
    organizationId,
    before.nextCursor,
  );
  invariant(delta.mode === "delta", "expected a delta");
  expect(
    delta.lanes.directory?.users.find((user) => user.userId === member.userId)
      ?.leaveRequest,
  ).toEqual(request);
});

test("a leave request cannot cite a Members head from before the member's removal", async () => {
  const app = createApp();
  const { founder, member, organizationId } = await organizationWithMember();
  const earlierMembership = await currentMembersHead(organizationId);

  await removeMemberGroupUser({
    actor: founder,
    memberUserId: member.userId,
    organizationId,
  });
  await addMemberGroupUser({
    actor: founder,
    memberUserId: member.userId,
    organizationId,
  });

  const replayed = await signedRequest(member, {
    membersHead: earlierMembership,
    organizationId,
  });
  expect(
    (await putLeaveRequest(app, member, organizationId, replayed)).status,
  ).toBe(409);
  const unknown = await signedRequest(member, {
    membersHead: {
      ...(await currentMembersHead(organizationId)),
      stateHash: "not-a-members-state",
    },
    organizationId,
  });
  expect(
    (await putLeaveRequest(app, member, organizationId, unknown)).status,
  ).toBe(409);
  expect(
    (
      await putLeaveRequest(
        app,
        member,
        organizationId,
        await signedRequest(member, { organizationId }),
      )
    ).status,
  ).toBe(200);
});

test("a leave request may cite an earlier head of the member's current membership", async () => {
  const app = createApp();
  const { founder, member, organizationId } = await organizationWithMember();
  const seen = await currentMembersHead(organizationId);
  const colleague = await registeredUser();
  await addMemberGroupUser({
    actor: founder,
    memberUserId: colleague.userId,
    organizationId,
  });

  const request = await signedRequest(member, {
    membersHead: seen,
    organizationId,
  });
  expect(
    (await putLeaveRequest(app, member, organizationId, request)).status,
  ).toBe(200);
  expect(
    await directoryLeaveRequest(app, founder, organizationId, member.userId),
  ).toEqual(request);
});
