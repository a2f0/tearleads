import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/bob-and-alice";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import { registerUser } from "../../../test/helpers/registerUser";
import { db } from "../../adapters/postgres";
import { routeApp } from "../../routeApp";
import { containers, groups, users } from "../../schema";

async function getRootContainerIdForUser(userId: string): Promise<string> {
  const [user] = await db
    .select({
      defaultOrganizationId: users.defaultOrganizationId,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  invariant(user, "expected user row");

  const [rootContainer] = await db
    .select({
      id: containers.id,
    })
    .from(containers)
    .where(eq(containers.organizationId, user.defaultOrganizationId))
    .limit(1);

  invariant(rootContainer, "expected root container row");
  return rootContainer.id;
}

test("POST /containers/:containerId/share grants direct user access and bumps descendant metadata epochs", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);

  const recipient = createTestUser();
  await registerUser(recipient);
  await authenticate(recipient);

  const ownerRootId = await getRootContainerIdForUser(owner.userId);
  const sharedContainerId = crypto.randomUUID();
  const descendantContainerId = crypto.randomUUID();

  const sharedCreateResponse = await routeApp.request("/containers", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${owner.token}`,
    },
    body: JSON.stringify({
      id: sharedContainerId,
      initialMetadataUpdates: [],
      parentId: ownerRootId,
    }),
  });

  expect(sharedCreateResponse.status).toBe(200);

  const descendantCreateResponse = await routeApp.request("/containers", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${owner.token}`,
    },
    body: JSON.stringify({
      id: descendantContainerId,
      initialMetadataUpdates: [],
      parentId: sharedContainerId,
    }),
  });

  expect(descendantCreateResponse.status).toBe(200);

  const shareResponse = await routeApp.request(
    `/containers/${sharedContainerId}/share`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${owner.token}`,
      },
      body: JSON.stringify({
        accessLevel: "write",
        subjectId: recipient.userId,
        subjectType: "user",
      }),
    },
  );

  expect(shareResponse.status).toBe(200);
  const shared = await shareResponse.json();
  expect(shared.id).toBe(sharedContainerId);
  expect(shared.metadataAccessEpoch).toBe(2);
  expect(shared.metadataRecipientEncapsulationPublicKeys).toHaveLength(2);

  const listResponse = await routeApp.request("/containers", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${recipient.token}`,
    },
  });

  expect(listResponse.status).toBe(200);
  const listedContainers = await listResponse.json();
  expect(listedContainers).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: sharedContainerId,
        metadataAccessEpoch: 2,
        parentId: ownerRootId,
      }),
      expect.objectContaining({
        id: descendantContainerId,
        metadataAccessEpoch: 2,
        parentId: sharedContainerId,
      }),
    ]),
  );
});

test("POST /containers/:containerId/share rejects callers without admin access", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);

  const recipient = createTestUser();
  await registerUser(recipient);
  await authenticate(recipient);

  const intruder = createTestUser();
  await registerUser(intruder);
  await authenticate(intruder);

  const ownerRootId = await getRootContainerIdForUser(owner.userId);
  const sharedContainerId = crypto.randomUUID();

  const createResponse = await routeApp.request("/containers", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${owner.token}`,
    },
    body: JSON.stringify({
      id: sharedContainerId,
      initialMetadataUpdates: [],
      parentId: ownerRootId,
    }),
  });

  expect(createResponse.status).toBe(200);

  const shareResponse = await routeApp.request(
    `/containers/${sharedContainerId}/share`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${intruder.token}`,
      },
      body: JSON.stringify({
        accessLevel: "write",
        subjectId: recipient.userId,
        subjectType: "user",
      }),
    },
  );

  expect(shareResponse.status).toBe(403);
  expect(await shareResponse.json()).toEqual({ error: "Forbidden" });
});

test("POST /containers/:containerId/share rejects managed grants without current principal policy state", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);

  const ownerRootId = await getRootContainerIdForUser(owner.userId);
  const sharedContainerId = crypto.randomUUID();

  const createResponse = await routeApp.request("/containers", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${owner.token}`,
    },
    body: JSON.stringify({
      id: sharedContainerId,
      initialMetadataUpdates: [],
      parentId: ownerRootId,
    }),
  });

  expect(createResponse.status).toBe(200);

  const [ownerRow] = await db
    .select({
      defaultOrganizationId: users.defaultOrganizationId,
    })
    .from(users)
    .where(eq(users.id, owner.userId))
    .limit(1);
  invariant(ownerRow, "expected owner row");

  const [group] = await db
    .insert(groups)
    .values({
      organizationId: ownerRow.defaultOrganizationId,
      name: "Unmanaged reviewers",
    })
    .returning({ id: groups.id });
  invariant(group, "expected group");

  const shareResponse = await routeApp.request(
    `/containers/${sharedContainerId}/share`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${owner.token}`,
      },
      body: JSON.stringify({
        accessLevel: "read",
        subjectId: group.id,
        subjectType: "group",
      }),
    },
  );

  expect(shareResponse.status).toBe(409);
  expect(await shareResponse.json()).toEqual({
    error: `Missing current principal policy state for group:${group.id}`,
  });
});
