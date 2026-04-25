import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/bob-and-alice";
import { and, eq, isNull } from "drizzle-orm";
import invariant from "invariant";
import { createContainer as createContainerRequest } from "../../../test/helpers/api/createContainer";
import { authenticate } from "../../../test/helpers/authenticate";
import { registerUser } from "../../../test/helpers/registerUser";
import { db } from "../../adapters/postgres";
import { routeApp } from "../../routeApp";
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
    .where(
      and(
        eq(containers.organizationId, user.defaultOrganizationId),
        isNull(containers.parentId),
      ),
    )
    .limit(1);

  invariant(rootContainer, "expected root container row");
  return rootContainer.id;
}

async function createContainerForUser(input: {
  id: string;
  parentId: string;
  token: string;
}): Promise<{ metadataAccessStateHash: string }> {
  const response = await createContainerRequest(
    {
      id: input.id,
      parentId: input.parentId,
    },
    input.token,
  );

  expect(response.status).toBe(200);
  return response.json();
}

test("POST /containers/:containerId/move reparents the subtree and bumps descendant metadata epochs", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);

  const rootContainerId = await getRootContainerIdForUser(owner.userId);
  const sourceContainerId = crypto.randomUUID();
  const grandchildContainerId = crypto.randomUUID();
  const targetParentId = crypto.randomUUID();

  const createdSourceContainer = await createContainerForUser({
    id: sourceContainerId,
    parentId: rootContainerId,
    token: owner.token,
  });
  await createContainerForUser({
    id: grandchildContainerId,
    parentId: sourceContainerId,
    token: owner.token,
  });
  await createContainerForUser({
    id: targetParentId,
    parentId: rootContainerId,
    token: owner.token,
  });

  const moveResponse = await routeApp.request(
    `/containers/${sourceContainerId}/move`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        expectedAccessStateHash: createdSourceContainer.metadataAccessStateHash,
        parentId: targetParentId,
      }),
    },
  );

  expect(moveResponse.status).toBe(200);
  expect(await moveResponse.json()).toEqual(
    expect.objectContaining({
      id: sourceContainerId,
      metadataAccessEpoch: 2,
      parentId: targetParentId,
    }),
  );

  const listResponse = await routeApp.request("/containers", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${owner.token}`,
    },
  });

  expect(listResponse.status).toBe(200);
  expect(await listResponse.json()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: sourceContainerId,
        metadataAccessEpoch: 2,
        parentId: targetParentId,
      }),
      expect.objectContaining({
        id: grandchildContainerId,
        metadataAccessEpoch: 2,
        parentId: sourceContainerId,
      }),
    ]),
  );
});

test("POST /containers/:containerId/move rejects moving a container under its descendant", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);

  const rootContainerId = await getRootContainerIdForUser(owner.userId);
  const sourceContainerId = crypto.randomUUID();
  const grandchildContainerId = crypto.randomUUID();

  const createdSourceContainer = await createContainerForUser({
    id: sourceContainerId,
    parentId: rootContainerId,
    token: owner.token,
  });
  await createContainerForUser({
    id: grandchildContainerId,
    parentId: sourceContainerId,
    token: owner.token,
  });

  const moveResponse = await routeApp.request(
    `/containers/${sourceContainerId}/move`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        expectedAccessStateHash: createdSourceContainer.metadataAccessStateHash,
        parentId: grandchildContainerId,
      }),
    },
  );

  expect(moveResponse.status).toBe(400);
  expect(await moveResponse.json()).toEqual({
    error: "Container cannot be moved under its descendant",
  });
});

test("POST /containers/:containerId/move rejects stale access state hashes", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);

  const rootContainerId = await getRootContainerIdForUser(owner.userId);
  const sourceContainerId = crypto.randomUUID();
  const targetParentId = crypto.randomUUID();

  await createContainerForUser({
    id: sourceContainerId,
    parentId: rootContainerId,
    token: owner.token,
  });
  await createContainerForUser({
    id: targetParentId,
    parentId: rootContainerId,
    token: owner.token,
  });

  const moveResponse = await routeApp.request(
    `/containers/${sourceContainerId}/move`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        expectedAccessStateHash: "stale-access-state-hash",
        parentId: targetParentId,
      }),
    },
  );

  expect(moveResponse.status).toBe(409);
  expect(await moveResponse.json()).toEqual({
    error: "Stale access state hash",
  });
});
