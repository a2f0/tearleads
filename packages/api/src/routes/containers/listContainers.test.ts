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
  expect(listedContainers).toEqual([
    expect.objectContaining({
      id: owner.rootContainerId,
      parentId: null,
      metadataAccessEpoch: 1,
    }),
  ]);
  expect(listedContainers[0]?.metadataAccessStateHash).toEqual(
    expect.any(String),
  );
  expect(listedContainers[0]?.metadataDocumentId).toEqual(expect.any(String));
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
    listedContainers.map((container: { id: string }) => container.id),
  ).toEqual([otherUser.rootContainerId]);
  expect(
    listedContainers.map((container: { id: string }) => container.id),
  ).not.toContain(owner.rootContainerId);
});
