import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { createDocument } from "../../../test/helpers/api";
import { authenticate } from "../../../test/helpers/authenticate";
import { createTestUser } from "../../../test/helpers/createTestUser";
import { registerUser } from "../../../test/helpers/registerUser";
import { grantContainerAccess } from "../../access/containerAccess";
import { db } from "../../adapters/postgres";
import { app } from "../../index";
import { containers, users } from "../../schema";

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

test("GET /containers/:containerId/documents lists readable non-metadata documents for the container", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);

  const rootContainerId = await getRootContainerIdForUser(owner.userId);
  const createResponse = await createDocument(owner.token, [rootContainerId]);
  expect(createResponse.status).toBe(200);
  const createdDocument = await createResponse.json();

  const response = await app.request(
    `/containers/${rootContainerId}/documents`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${owner.token}`,
      },
    },
  );

  expect(response.status).toBe(200);
  const listedDocuments = await response.json();
  expect(listedDocuments).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: createdDocument.id,
        linkedContainerIds: [rootContainerId],
      }),
    ]),
  );
  expect(listedDocuments).toHaveLength(1);
});

test("GET /containers/:containerId/documents returns documents for directly shared containers", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);

  const recipient = createTestUser();
  await registerUser(recipient);
  await authenticate(recipient);

  const ownerRootId = await getRootContainerIdForUser(owner.userId);
  const sharedContainerId = crypto.randomUUID();

  const sharedContainerResponse = await app.request("/containers", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${owner.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: sharedContainerId,
      initialMetadataUpdates: [],
      parentId: ownerRootId,
    }),
  });

  expect(sharedContainerResponse.status).toBe(200);

  const createDocumentResponse = await createDocument(owner.token, [
    sharedContainerId,
  ]);
  expect(createDocumentResponse.status).toBe(200);
  const createdDocument = await createDocumentResponse.json();

  await grantContainerAccess({
    accessLevel: "read",
    containerId: sharedContainerId,
    subjectId: recipient.userId,
    subjectType: "user",
  });

  const response = await app.request(
    `/containers/${sharedContainerId}/documents`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${recipient.token}`,
      },
    },
  );

  expect(response.status).toBe(200);
  const listedDocuments = await response.json();
  expect(listedDocuments).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: createdDocument.id,
        linkedContainerIds: [sharedContainerId],
      }),
    ]),
  );
});
