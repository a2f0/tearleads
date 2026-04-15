import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/bob-and-alice";
import { and, eq, isNull } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import { registerUser } from "../../../test/helpers/registerUser";
import {
  canWriteContainerAccess,
  resolveContainerAccessState,
} from "../../access/containerAccess";
import { db } from "../../adapters/postgres";
import { routeApp } from "../../routeApp";
import { containerMetadataDocuments, containers, users } from "../../schema";

async function getRootContainerForUser(userId: string) {
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
      organizationId: containers.organizationId,
    })
    .from(containers)
    .where(
      and(
        eq(containers.organizationId, user.defaultOrganizationId),
        isNull(containers.parentId),
      ),
    )
    .limit(1);

  invariant(rootContainer, "expected root container row");
  return rootContainer;
}

test("POST /containers creates a child container under a writable parent", async () => {
  const user = createTestUser();
  await registerUser(user);
  await authenticate(user);

  const rootContainer = await getRootContainerForUser(user.userId);
  const childId = crypto.randomUUID();

  const response = await routeApp.request("/containers", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${user.token}`,
    },
    body: JSON.stringify({
      id: childId,
      initialMetadataUpdates: [],
      parentId: rootContainer.id,
    }),
  });

  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.id).toBe(childId);
  expect(body.organizationId).toBe(rootContainer.organizationId);
  expect(body.parentId).toBe(rootContainer.id);
  expect(typeof body.metadataDocumentId).toBe("string");
  expect(body.metadataAccessEpoch).toBe(1);
  expect(body.metadataRecipientEncapsulationPublicKeys).toHaveLength(1);

  const [createdContainer] = await db
    .select()
    .from(containers)
    .where(eq(containers.id, childId))
    .limit(1);

  invariant(createdContainer, "expected created child container");
  expect(createdContainer.parentId).toBe(rootContainer.id);
  expect(createdContainer.organizationId).toBe(rootContainer.organizationId);

  const [metadataBinding] = await db
    .select({
      containerId: containerMetadataDocuments.containerId,
      documentId: containerMetadataDocuments.documentId,
    })
    .from(containerMetadataDocuments)
    .where(eq(containerMetadataDocuments.containerId, childId))
    .limit(1);

  expect(metadataBinding?.containerId).toBe(childId);
  expect(metadataBinding?.documentId).toBe(body.metadataDocumentId);

  const accessState = await resolveContainerAccessState(childId);
  invariant(accessState, "expected initialized child access state");
  expect(canWriteContainerAccess(accessState, user.userId)).toBe(true);
});

test("POST /containers rejects creating a child container under a parent without write access", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);

  const intruder = createTestUser();
  await registerUser(intruder);
  await authenticate(intruder);

  const ownerRootContainer = await getRootContainerForUser(owner.userId);

  const response = await routeApp.request("/containers", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${intruder.token}`,
    },
    body: JSON.stringify({
      id: crypto.randomUUID(),
      initialMetadataUpdates: [],
      parentId: ownerRootContainer.id,
    }),
  });

  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: "Forbidden" });
});
