import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/bob-and-alice";
import { authenticate } from "../../../test/helpers/authenticate";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

test("GET /containers returns the manifest-backed root container for the authenticated user", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);

  const response = await routeApp.request("/containers", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${owner.token}`,
    },
  });

  expect(response.status).toBe(200);
  const listedContainers = await response.json();
  expect(listedContainers).toEqual({
    hasMore: false,
    items: [
      expect.objectContaining({
        depth: 0,
        id: owner.rootContainerId,
        parentId: null,
        metadataAccessEpoch: 1,
      }),
    ],
    nextCursor: expect.any(String),
    tombstones: [],
  });
  expect(listedContainers.items).toEqual([
    expect.objectContaining({
      id: owner.rootContainerId,
    }),
  ]);
  expect(listedContainers.items[0]?.metadataAccessStateHash).toEqual(
    expect.any(String),
  );
  expect(listedContainers.items[0]?.metadataDocumentId).toEqual(
    expect.any(String),
  );
});

test("GET /containers only returns containers readable through current manifests", async () => {
  const owner = createTestUser();
  const otherUser = createTestUser();

  await registerUser(owner);
  await authenticate(owner);
  await registerUser(otherUser);
  await authenticate(otherUser);

  const response = await routeApp.request("/containers", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${otherUser.token}`,
    },
  });

  expect(response.status).toBe(200);
  const listedContainers = await response.json();
  expect(
    listedContainers.items.map((container: { id: string }) => container.id),
  ).toEqual([otherUser.rootContainerId]);
  expect(
    listedContainers.items.map((container: { id: string }) => container.id),
  ).not.toContain(owner.rootContainerId);
});

test("GET /containers supports opaque cursor resume and rejects tampering", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);

  const firstResponse = await routeApp.request("/containers?depth=0&limit=1", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${owner.token}`,
    },
  });
  expect(firstResponse.status).toBe(200);
  const firstBody = await firstResponse.json();
  expect(firstBody.items).toHaveLength(1);
  expect(firstBody.nextCursor).toEqual(expect.any(String));

  const secondResponse = await routeApp.request(
    `/containers?depth=0&cursor=${encodeURIComponent(firstBody.nextCursor)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${owner.token}`,
      },
    },
  );
  expect(secondResponse.status).toBe(200);
  expect(await secondResponse.json()).toEqual({
    hasMore: false,
    items: [],
    nextCursor: expect.any(String),
    tombstones: [],
  });

  const tamperedResponse = await routeApp.request(
    `/containers?depth=0&cursor=${encodeURIComponent(`${firstBody.nextCursor}x`)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${owner.token}`,
      },
    },
  );
  expect(tamperedResponse.status).toBe(400);
});
