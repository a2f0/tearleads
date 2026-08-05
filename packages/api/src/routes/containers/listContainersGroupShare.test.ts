import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { containers, users } from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import {
  readContainerParentLanePage,
  requestContainerParentLanes,
} from "../../../test/helpers/containerParentLaneQuery";
import { addUserToAdminGroup } from "../../../test/helpers/organizationAdmin";
import { registerUser } from "../../../test/helpers/registerUser";

async function listRootContainerPage(
  token: string,
  watermark: { readonly id: string; readonly updatedAt: string } | null = null,
) {
  const response = await requestContainerParentLanes(token, [
    { laneId: "root", parentId: null, watermark },
  ]);
  expect(response.status).toBe(200);
  return readContainerParentLanePage(response, "root");
}

test("root parent lane surfaces the owner root after an admin-group add", async () => {
  const owner = createTestUser();
  const peer = createTestUser();

  await registerUser(owner);
  await authenticate(owner);
  await registerUser(peer);
  await authenticate(peer);

  const [ownerRow] = await db
    .select({ organizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, owner.userId))
    .limit(1);
  invariant(ownerRow, "expected owner user row");

  // Before joining: peer only sees their own root container.
  const beforeBody = await listRootContainerPage(peer.token);
  expect(
    beforeBody.items.map((container: { id: string }) => container.id),
  ).not.toContain(owner.rootContainerId);

  await addUserToAdminGroup({
    actor: owner,
    member: peer,
    organizationId: ownerRow.organizationId,
  });

  // After joining the admin group, the owner's root container (granted to the
  // admin group at registration) should be reachable for the peer.
  const afterBody = await listRootContainerPage(peer.token);
  expect(
    afterBody.items.map((container: { id: string }) => container.id),
  ).toContain(owner.rootContainerId);
});

test("root parent lane resume sees admin-group rematerialization", async () => {
  const owner = createTestUser();
  const peer = createTestUser();

  await registerUser(owner);
  await authenticate(owner);
  await registerUser(peer);
  await authenticate(peer);

  const [ownerRow] = await db
    .select({ organizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, owner.userId))
    .limit(1);
  invariant(ownerRow, "expected owner user row");

  // A warm-cache peer keeps a root-lane watermark from a prior sync. The
  // compound Admins rotation must advance the owner root container beyond it.
  const [ownerRootRow] = await db
    .select({ updatedAt: containers.updatedAt })
    .from(containers)
    .where(eq(containers.id, owner.rootContainerId))
    .limit(1);
  invariant(ownerRootRow, "expected owner root container row");
  const staleWatermarkUpdatedAt = new Date(
    new Date(ownerRootRow.updatedAt).getTime() + 1,
  ).toISOString();

  await addUserToAdminGroup({
    actor: owner,
    member: peer,
    organizationId: ownerRow.organizationId,
  });

  // Without a watermark, the peer sees the shared root (proven above).
  const freshBody = await listRootContainerPage(peer.token);
  expect(
    freshBody.items.map((container: { id: string }) => container.id),
  ).toContain(owner.rootContainerId);

  // Resuming from the stale watermark returns the rematerialized root, so the
  // peer does not need another user's later write to discover the grant.
  const resumeBody = await listRootContainerPage(peer.token, {
    id: crypto.randomUUID(),
    updatedAt: staleWatermarkUpdatedAt,
  });
  expect(
    resumeBody.items.map((container: { id: string }) => container.id),
  ).toContain(owner.rootContainerId);
});
