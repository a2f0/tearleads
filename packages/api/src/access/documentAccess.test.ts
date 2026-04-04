import { expect, test } from "bun:test";
import { and, eq, isNull } from "drizzle-orm";
import invariant from "invariant";
import { createDocument } from "../../test/helpers/api/createDocument";
import { authenticate } from "../../test/helpers/authenticate";
import { createTestUser } from "../../test/helpers/createTestUser";
import { registerUser } from "../../test/helpers/registerUser";
import { db } from "../adapters/postgres";
import { containers, documentContainerLinks, users } from "../schema";
import {
  grantContainerAccess,
  resolveContainerAccessState,
} from "./containerAccess";
import { resolveDocumentAccessState } from "./documentAccess";

test("document access includes recipients inherited from its linked root container", async () => {
  const alice = createTestUser();
  const bob = createTestUser();

  await registerUser(alice);
  await registerUser(bob);
  await authenticate(alice);

  const createDocumentResponse = await createDocument(alice.token, [
    alice.rootContainerId,
  ]);
  expect(createDocumentResponse.status).toBe(200);
  const createdDocument = await createDocumentResponse.json();
  const documentId = String(createdDocument.id ?? "");
  expect(createdDocument.currentAccessEpoch).toBe(1);

  const [aliceRow] = await db
    .select({
      defaultOrganizationId: users.defaultOrganizationId,
    })
    .from(users)
    .where(eq(users.id, alice.userId))
    .limit(1);
  invariant(aliceRow, "expected alice user row");

  const [rootContainer] = await db
    .select({
      id: containers.id,
    })
    .from(containers)
    .where(
      and(
        eq(containers.organizationId, aliceRow.defaultOrganizationId),
        isNull(containers.parentId),
      ),
    )
    .limit(1);
  invariant(rootContainer, "expected root container");

  const [link] = await db
    .select({
      containerId: documentContainerLinks.containerId,
    })
    .from(documentContainerLinks)
    .where(eq(documentContainerLinks.documentId, documentId))
    .limit(1);
  expect(link?.containerId).toBe(rootContainer.id);

  const beforeShare = await resolveDocumentAccessState(documentId);
  invariant(beforeShare, "expected document access state");
  expect(beforeShare.currentAccessEpoch).toBe(1);
  expect(
    beforeShare.effectiveRecipients.map((recipient) => recipient.userId),
  ).toEqual([alice.userId]);

  const containerEpoch = await grantContainerAccess({
    containerId: rootContainer.id,
    subjectType: "user",
    subjectId: bob.userId,
    accessLevel: "read",
  });
  expect(containerEpoch).toBeGreaterThan(1);

  const containerState = await resolveContainerAccessState(rootContainer.id);
  invariant(containerState, "expected root container access state");

  const afterShare = await resolveDocumentAccessState(documentId);
  invariant(afterShare, "expected document access state after share");
  expect(afterShare.currentAccessEpoch).toBe(containerState.currentAccessEpoch);
  const recipientUserIds = afterShare.effectiveRecipients
    .map((recipient) => recipient.userId)
    .sort((left, right) => left.localeCompare(right));
  expect(recipientUserIds).toEqual(
    [alice.userId, bob.userId].sort((left, right) => left.localeCompare(right)),
  );
});
