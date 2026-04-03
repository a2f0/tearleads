import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { createTestUser } from "../../test/helpers/createTestUser";
import { registerUser } from "../../test/helpers/registerUser";
import { db } from "../adapters/postgres";
import {
  containers,
  objectAccessEpochs,
  objectAccessGrants,
  users,
} from "../schema";
import {
  canReadContainerAccess,
  canWriteContainerAccess,
  resolveContainerAccessState,
} from "./containerAccess";

const CONTAINER_OBJECT_TYPE = "container";

test("container access inherits ancestor grants and merges child grants", async () => {
  const alice = createTestUser();
  const bob = createTestUser();

  await registerUser(alice);
  await registerUser(bob);

  const [aliceRow] = await db
    .select({
      id: users.id,
      defaultOrganizationId: users.defaultOrganizationId,
    })
    .from(users)
    .where(eq(users.id, alice.userId))
    .limit(1);

  invariant(aliceRow, "expected alice user row");

  const organizationContainers = await db
    .select({
      id: containers.id,
      parentId: containers.parentId,
    })
    .from(containers)
    .where(eq(containers.organizationId, aliceRow.defaultOrganizationId));

  const rootContainer = organizationContainers.find(
    (container) => container.parentId === null,
  );
  invariant(rootContainer, "expected root container");

  const [childContainer] = await db
    .insert(containers)
    .values({
      organizationId: aliceRow.defaultOrganizationId,
      parentId: rootContainer.id,
      name: "Shared Child",
    })
    .returning({ id: containers.id });

  invariant(childContainer, "expected child container");

  await db.insert(objectAccessGrants).values({
    objectType: CONTAINER_OBJECT_TYPE,
    objectId: childContainer.id,
    subjectType: "user",
    subjectId: bob.userId,
    accessLevel: "read",
  });

  await db.insert(objectAccessEpochs).values({
    objectType: CONTAINER_OBJECT_TYPE,
    objectId: childContainer.id,
    epoch: 1,
    accessFingerprint: "seed",
    updatedAt: new Date(),
  });

  const state = await resolveContainerAccessState(childContainer.id);
  invariant(state, "expected container access state");

  expect(state.ancestorContainerIds).toEqual([
    rootContainer.id,
    childContainer.id,
  ]);
  const userIds = state.effectiveRecipients
    .map((recipient) => recipient.userId)
    .sort((left, right) => left.localeCompare(right));
  expect(userIds).toEqual(
    [alice.userId, bob.userId].sort((left, right) => left.localeCompare(right)),
  );
  expect(canReadContainerAccess(state, alice.userId)).toBe(true);
  expect(canReadContainerAccess(state, bob.userId)).toBe(true);
  expect(canWriteContainerAccess(state, alice.userId)).toBe(true);
  expect(canWriteContainerAccess(state, bob.userId)).toBe(false);
});
