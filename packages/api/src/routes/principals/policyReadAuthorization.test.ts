import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { organizations } from "@tearleads/api-shared/schema";
import { createTestUser, type TestUser } from "@tearleads/bob-and-alice";
import {
  isContainerMutationResponse,
  isPrincipalPolicyBundleResponse,
} from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import {
  bootstrapRoot,
  buildRootGrantRequest,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { getDefaultOrganizationId } from "../../../test/helpers/organizationMembership";
import { stripOrganizationMembership } from "../../../test/helpers/principalPolicyReadFixtures";
import { recoverRegisteredRootKek } from "../../../test/helpers/registeredRootKek";
import { registerUser } from "../../../test/helpers/registerUser";
import { grantRootThroughRotatedReadGroup } from "../../../test/helpers/rotatedReadGroupGrant";
import { routeApp } from "../../routeApp";

async function registerAndAuthenticate(...users: TestUser[]): Promise<void> {
  for (const user of users) {
    await registerUser(user);
    await authenticate(user);
  }
}

async function getPolicy(
  actor: TestUser,
  principalType: "group" | "organization",
  principalId: string,
): Promise<Response> {
  return routeApp.request(
    `/principals/${principalType}/${principalId}/policy`,
    {
      headers: { Authorization: `Bearer ${actor.token}` },
    },
  );
}

async function expectBundle(response: Response): Promise<void> {
  expect(response.status, await response.clone().text()).toBe(200);
  expect(isPrincipalPolicyBundleResponse(await response.json())).toBe(true);
}

async function expectDenied(response: Response): Promise<void> {
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({
    error: "Principal policy access denied",
  });
}

async function loadOrganizationGroups(organizationId: string) {
  const [organization] = await db
    .select({
      adminGroupId: organizations.adminGroupId,
      memberGroupId: organizations.memberGroupId,
    })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  invariant(organization, "expected organization row");
  return organization;
}

test("GET principal policy refuses an account outside the organization", async () => {
  const owner = createTestUser();
  const outsider = createTestUser();
  await registerAndAuthenticate(owner, outsider);
  const organizationId = await getDefaultOrganizationId(owner.userId);
  const { adminGroupId, memberGroupId } =
    await loadOrganizationGroups(organizationId);

  await expectDenied(await getPolicy(outsider, "group", adminGroupId));
  await expectDenied(await getPolicy(outsider, "group", memberGroupId));
  await expectDenied(await getPolicy(outsider, "organization", organizationId));

  await expectBundle(await getPolicy(owner, "group", adminGroupId));
  await expectBundle(await getPolicy(owner, "group", memberGroupId));
  await expectBundle(await getPolicy(owner, "organization", organizationId));
});

test("GET principal policy serves a peer the owner shared a root with", async () => {
  const owner = createTestUser();
  const peer = createTestUser();
  await registerAndAuthenticate(owner, peer);
  const organizationId = await getDefaultOrganizationId(owner.userId);
  const { adminGroupId } = await loadOrganizationGroups(organizationId);
  await expectDenied(await getPolicy(peer, "group", adminGroupId));

  const root = await bootstrapRoot(owner);
  const shareResponse = await routeApp.request(
    `/containers/${root.kekState.containerId}/share`,
    {
      body: JSON.stringify(
        await buildRootGrantRequest({
          previous: root.bundle,
          previousKekState: root.kekState,
          recipient: peer,
          signer: owner,
        }),
      ),
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    },
  );
  expect(shareResponse.status, await shareResponse.clone().text()).toBe(200);
  expect(isContainerMutationResponse(await shareResponse.json())).toBe(true);

  // The shared root cites the owner's Admins head, which the peer must fetch
  // to verify the path it was just granted; the grant alone must serve it,
  // so the organization membership the share fixture enrolled is stripped.
  await stripOrganizationMembership(organizationId, peer.userId);
  await expectBundle(await getPolicy(peer, "group", adminGroupId));
  await expectBundle(await getPolicy(peer, "organization", organizationId));
});

test("GET principal policy serves a group-granted reader with no roster entry", async () => {
  const owner = createTestUser();
  const reader = createTestUser();
  await registerAndAuthenticate(owner, reader);
  const organizationId = await getDefaultOrganizationId(owner.userId);
  const { adminGroupId } = await loadOrganizationGroups(organizationId);
  const root = await recoverRegisteredRootKek({
    owner,
    root: await bootstrapRoot(owner),
  });
  const { groupId } = await grantRootThroughRotatedReadGroup({
    actor: owner,
    reader,
    root,
  });
  // An ordinary group may name a user who is on no roster; strip the
  // organization membership the fixture created so only the container grant
  // and the group projection can authorize.
  await stripOrganizationMembership(organizationId, reader.userId);

  // Projection membership serves the reader's own group ...
  await expectBundle(await getPolicy(reader, "group", groupId));
  // ... the root's Admins head is reachable only through the grant, and the
  // organization bundle the client loads before verifying any of its groups
  // follows from that same grant.
  await expectBundle(await getPolicy(reader, "group", adminGroupId));
  await expectBundle(await getPolicy(reader, "organization", organizationId));

  const outsider = createTestUser();
  await registerAndAuthenticate(outsider);
  await expectDenied(await getPolicy(outsider, "group", groupId));
});
