import { expect, test } from "bun:test";
import { and, eq, isNull } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import { createTestUser } from "../../../test/helpers/createTestUser";
import { registerUser } from "../../../test/helpers/registerUser";
import {
  canWriteContainerAccess,
  resolveContainerAccessState,
} from "../../access/containerAccess";
import { db } from "../../adapters/postgres";
import { app } from "../../index";
import { containers, users } from "../../schema";

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

  const response = await app.request("/containers", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${user.token}`,
    },
    body: JSON.stringify({
      id: childId,
      parentId: rootContainer.id,
      name: "Docs",
    }),
  });

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    id: childId,
    organizationId: rootContainer.organizationId,
    parentId: rootContainer.id,
    name: "Docs",
  });

  const [createdContainer] = await db
    .select()
    .from(containers)
    .where(eq(containers.id, childId))
    .limit(1);

  invariant(createdContainer, "expected created child container");
  expect(createdContainer.parentId).toBe(rootContainer.id);
  expect(createdContainer.organizationId).toBe(rootContainer.organizationId);

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

  const response = await app.request("/containers", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${intruder.token}`,
    },
    body: JSON.stringify({
      id: crypto.randomUUID(),
      parentId: ownerRootContainer.id,
      name: "Nope",
    }),
  });

  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: "Forbidden" });
});
