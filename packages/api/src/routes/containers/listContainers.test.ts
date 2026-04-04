import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import { createTestUser } from "../../../test/helpers/createTestUser";
import { registerUser } from "../../../test/helpers/registerUser";
import { db } from "../../adapters/postgres";
import { app } from "../../index";
import { containerMetadataDocuments, containers, users } from "../../schema";

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

test("GET /containers returns the readable structural forest for the authenticated user", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);

  const otherUser = createTestUser();
  await registerUser(otherUser);
  await authenticate(otherUser);

  const ownerRootId = await getRootContainerIdForUser(owner.userId);
  const childId = crypto.randomUUID();

  const createResponse = await app.request("/containers", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${owner.token}`,
    },
    body: JSON.stringify({
      id: childId,
      initialMetadataUpdates: [],
      parentId: ownerRootId,
    }),
  });

  expect(createResponse.status).toBe(200);
  const createdChild = await createResponse.json();

  const listResponse = await app.request("/containers", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${owner.token}`,
    },
  });

  expect(listResponse.status).toBe(200);
  const listedContainers = await listResponse.json();
  expect(Array.isArray(listedContainers)).toBe(true);
  expect(listedContainers).toHaveLength(2);

  expect(listedContainers).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: ownerRootId,
        parentId: null,
      }),
      expect.objectContaining({
        id: childId,
        metadataDocumentId: createdChild.metadataDocumentId,
        organizationId: createdChild.organizationId,
        parentId: ownerRootId,
      }),
    ]),
  );

  const [binding] = await db
    .select({
      documentId: containerMetadataDocuments.documentId,
    })
    .from(containerMetadataDocuments)
    .where(eq(containerMetadataDocuments.containerId, ownerRootId))
    .limit(1);

  expect(binding?.documentId).toBeDefined();

  const otherListResponse = await app.request("/containers", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${otherUser.token}`,
    },
  });

  expect(otherListResponse.status).toBe(200);
  const otherListedContainers = await otherListResponse.json();
  expect(otherListedContainers).toHaveLength(1);
  expect(otherListedContainers[0]?.id).not.toBe(ownerRootId);
  expect(otherListedContainers[0]?.id).not.toBe(childId);
});
