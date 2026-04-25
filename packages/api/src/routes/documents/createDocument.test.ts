import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/bob-and-alice";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { createDocument } from "../../../test/helpers/api";
import { authenticate } from "../../../test/helpers/authenticate";
import { registerUser } from "../../../test/helpers/registerUser";
import { db } from "../../adapters/postgres";
import { routeApp } from "../../routeApp";
import { containers, documentContainerLinks, users } from "../../schema";

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

test("POST /documents creates a document for the linked container", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);

  const rootContainerId = await getRootContainerIdForUser(owner.userId);
  const response = await createDocument(owner.token, [rootContainerId]);

  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body).toEqual(
    expect.objectContaining({
      createdAt: expect.any(String),
      currentAccessEpoch: 1,
      currentAccessStateHash: expect.any(String),
      documentRecipientEnvelopes: expect.any(Array),
      id: expect.any(String),
      recipientEncapsulationPublicKeys: expect.any(Array),
    }),
  );

  const links = await db
    .select({
      containerId: documentContainerLinks.containerId,
    })
    .from(documentContainerLinks)
    .where(eq(documentContainerLinks.documentId, body.id));

  expect(links).toEqual([{ containerId: rootContainerId }]);
});

test("POST /documents rejects stale linked container access state hashes", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);

  const rootContainerId = await getRootContainerIdForUser(owner.userId);
  const response = await routeApp.request("/documents", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${owner.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      expectedLinkedContainerAccessStateHashes: {
        [rootContainerId]: "stale-access-state-hash",
      },
      linkedContainerIds: [rootContainerId],
    }),
  });

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: "Stale access state hash" });
});
