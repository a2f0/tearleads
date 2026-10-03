import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  accessManifestHeads,
  containers,
  users,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import { storeChildContainerAccessManifest } from "../../../test/helpers/containerManifests";
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

/** An owner child of the owner's root, granted to nobody directly. */
async function addOwnerRootChild(owner: ReturnType<typeof createTestUser>) {
  const [root] = await db
    .select({ organizationId: containers.organizationId })
    .from(containers)
    .where(eq(containers.id, owner.rootContainerId))
    .limit(1);
  const [rootHead] = await db
    .select({ manifestHash: accessManifestHeads.manifestHash })
    .from(accessManifestHeads)
    .where(eq(accessManifestHeads.objectId, owner.rootContainerId))
    .limit(1);
  invariant(root && rootHead, "expected the owner's registered root");
  const childContainerId = crypto.randomUUID();
  await db.insert(containers).values({
    depth: 1,
    id: childContainerId,
    organizationId: root.organizationId,
    parentId: owner.rootContainerId,
  });
  await storeChildContainerAccessManifest({
    childContainerId,
    dependencyManifestHashes: [rootHead.manifestHash],
    metadataDocumentId: crypto.randomUUID(),
    organizationId: root.organizationId,
    owner,
    parentContainerId: owner.rootContainerId,
    parentManifestHash: rootHead.manifestHash,
  });
  return { childContainerId, organizationId: root.organizationId };
}

async function listChildIds(token: string, parentId: string) {
  const response = await requestContainerParentLanes(token, [
    { laneId: "children", parentId },
  ]);
  expect(response.status).toBe(200);
  const page = await readContainerParentLanePage(response, "children");
  return page.items.map((container: { id: string }) => container.id);
}

// The child lane authorizes its parent through every grant subject of the
// caller, so a group grant on an ancestor is enough (#2415's grant_subjects).
test("a child lane opens to a member whose only grant is through a group", async () => {
  const owner = createTestUser();
  const peer = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  await registerUser(peer);
  await authenticate(peer);
  const { childContainerId, organizationId } = await addOwnerRootChild(owner);

  expect(await listChildIds(peer.token, owner.rootContainerId)).toEqual([]);

  await addUserToAdminGroup({ actor: owner, member: peer, organizationId });

  expect(await listChildIds(peer.token, owner.rootContainerId)).toContain(
    childContainerId,
  );
});
