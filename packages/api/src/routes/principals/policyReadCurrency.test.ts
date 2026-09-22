import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { organizationRosterEntries } from "@tearleads/api-shared/schema";
import { createTestUser, type TestUser } from "@tearleads/bob-and-alice";
import type { AccessManifestBundleWire } from "@tearleads/validators/request";
import { isContainerMutationResponse } from "@tearleads/validators/response";
import { and, eq } from "drizzle-orm";
import invariant from "invariant";
import {
  bootstrapRoot,
  buildRootGrantRequest,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { buildRootRevokeRequest } from "../../../test/helpers/keyingWriterProjectionRevoke";
import { getDefaultOrganizationId } from "../../../test/helpers/organizationMembership";
import {
  getPolicy,
  loadOrganizationGroups,
  registerAndAuthenticate,
  stripOrganizationMembership,
} from "../../../test/helpers/principalPolicyReadFixtures";
import { recoverRegisteredRootKek } from "../../../test/helpers/registeredRootKek";
import {
  grantRootThroughRotatedReadGroup,
  rotateRootGroupMembership,
} from "../../../test/helpers/rotatedReadGroupGrant";
import { routeApp } from "../../routeApp";

// The read authorization accepts only CURRENT evidence: an active roster
// entry, membership in the principal's current projection, or a grant on the
// container's current head. Each test here removes exactly one of those and
// shows the bundle is refused.

async function postAsOwner(
  owner: TestUser,
  path: string,
  body: unknown,
): Promise<Response> {
  return routeApp.request(path, {
    body: JSON.stringify(body),
    headers: {
      Authorization: `Bearer ${owner.token}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
}

test("a disabled roster entry does not authorize a principal policy read", async () => {
  const owner = createTestUser();
  const member = createTestUser();
  await registerAndAuthenticate(owner, member);
  const organizationId = await getDefaultOrganizationId(owner.userId);
  const { adminGroupId } = await loadOrganizationGroups(organizationId);
  // A bare roster row, with no projection membership and no grant, so the
  // roster status is the only thing that can authorize the read.
  await db.insert(organizationRosterEntries).values({
    organizationId,
    status: "active",
    userId: member.userId,
  });
  expect((await getPolicy(member, "group", adminGroupId)).status).toBe(200);
  expect((await getPolicy(member, "organization", organizationId)).status).toBe(
    200,
  );

  await db
    .update(organizationRosterEntries)
    .set({ status: "disabled" })
    .where(
      and(
        eq(organizationRosterEntries.organizationId, organizationId),
        eq(organizationRosterEntries.userId, member.userId),
      ),
    );

  expect((await getPolicy(member, "group", adminGroupId)).status).toBe(403);
  expect((await getPolicy(member, "organization", organizationId)).status).toBe(
    403,
  );
});

test("a user dropped from the group's current projection loses the read", async () => {
  const owner = createTestUser();
  const reader = createTestUser();
  await registerAndAuthenticate(owner, reader);
  const organizationId = await getDefaultOrganizationId(owner.userId);
  const { adminGroupId } = await loadOrganizationGroups(organizationId);
  const root = await recoverRegisteredRootKek({
    owner,
    root: await bootstrapRoot(owner),
  });
  const { groupId, root: grantedRoot } = await grantRootThroughRotatedReadGroup(
    { actor: owner, reader, root },
  );
  expect((await getPolicy(reader, "group", groupId)).status).toBe(200);
  expect((await getPolicy(reader, "group", adminGroupId)).status).toBe(200);

  // The superseded state still names the reader; only the current one counts.
  // The organization membership the fixture enrolled is stripped afterwards,
  // since the commit re-verifies the Members policy against its projection.
  await rotateRootGroupMembership({
    actor: owner,
    groupId,
    removedMemberUserId: reader.userId,
    root: grantedRoot,
  });
  await stripOrganizationMembership(organizationId, reader.userId);

  expect((await getPolicy(reader, "group", groupId)).status).toBe(403);
  expect((await getPolicy(reader, "group", adminGroupId)).status).toBe(403);
});

test("a grant revoked from the container's current head no longer authorizes", async () => {
  const owner = createTestUser();
  const peer = createTestUser();
  await registerAndAuthenticate(owner, peer);
  const organizationId = await getDefaultOrganizationId(owner.userId);
  const { adminGroupId } = await loadOrganizationGroups(organizationId);
  const root = await bootstrapRoot(owner);
  const shareResponse = await postAsOwner(
    owner,
    `/containers/${root.kekState.containerId}/share`,
    await buildRootGrantRequest({
      previous: root.bundle,
      previousKekState: root.kekState,
      recipient: peer,
      signer: owner,
    }),
  );
  expect(shareResponse.status, await shareResponse.clone().text()).toBe(200);
  const shared: unknown = await shareResponse.json();
  invariant(isContainerMutationResponse(shared), "expected a share response");
  await stripOrganizationMembership(organizationId, peer.userId);
  expect((await getPolicy(peer, "group", adminGroupId)).status).toBe(200);

  // The old head still grants the peer; the current one does not.
  const revokeResponse = await postAsOwner(
    owner,
    `/containers/${root.kekState.containerId}/revoke`,
    await buildRootRevokeRequest({
      previous: shared.accessManifest as unknown as AccessManifestBundleWire,
      previousKekState: root.kekState,
      revokedUser: peer,
      signer: owner,
    }),
  );
  expect(revokeResponse.status, await revokeResponse.clone().text()).toBe(200);

  expect((await getPolicy(peer, "group", adminGroupId)).status).toBe(403);
  expect((await getPolicy(peer, "organization", organizationId)).status).toBe(
    403,
  );
});
