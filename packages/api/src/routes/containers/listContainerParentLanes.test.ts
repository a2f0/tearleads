import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/test-utils";
import { isListContainerParentLanesResponse } from "@tearleads/validators/response";
import { authenticate } from "../../../test/helpers/authenticate";
import { requestContainerParentLanes } from "../../../test/helpers/containerParentLaneQuery";
import { loadRegisteredContainerRoots } from "../../../test/helpers/listContainerRoots";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

const PARENT_LANES_PATH = "/containers/parent-lanes/query";

test("parent-lanes/query rejects malformed whole requests", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);

  const response = await routeApp.request(PARENT_LANES_PATH, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${owner.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      lanes: [{ laneId: "root", parentId: null, watermark: null }],
      unexpected: true,
    }),
  });

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "Invalid request" });
});

test("parent-lanes/query lists 32 lanes in one request, in lane order", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const roots = await loadRegisteredContainerRoots(owner);
  const rootIds = roots.map((root) => root.id);
  // The root lane, then the child lane of each registered root, repeated to
  // fill a request. A batch this size must keep each lane's page small.
  const lanes = Array.from({ length: 32 }, (_, index) => ({
    laneId: `lane-${index}`,
    limit: 15,
    parentId: index === 0 ? null : (rootIds[index % rootIds.length] ?? null),
  }));

  const response = await requestContainerParentLanes(owner.token, lanes);

  expect(response.status).toBe(200);
  const body: unknown = await response.json();
  if (!isListContainerParentLanesResponse(body)) {
    throw new Error("Expected a container parent-lane response");
  }
  expect(body.results.map((result) => result.laneId)).toEqual(
    lanes.map((lane) => lane.laneId),
  );
  expect(body.results[0]?.page.items.map((item) => item.id)).toEqual(rootIds);
  // Lanes that name the same parent list the same children.
  const repeated = body.results.filter(
    (_, index) => index > 0 && lanes[index]?.parentId === lanes[1]?.parentId,
  );
  expect(repeated.length).toBeGreaterThan(1);
  expect(
    new Set(repeated.map((result) => JSON.stringify(result.page))).size,
  ).toBe(1);
});

test("parent-lanes/query rejects a 33rd lane and an oversized batch page", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const lanes = (count: number, limit?: number) =>
    Array.from({ length: count }, (_, index) => ({
      laneId: `lane-${index}`,
      ...(limit === undefined ? {} : { limit }),
      parentId: null,
    }));

  for (const batch of [lanes(33, 15), lanes(32), lanes(32, 16)]) {
    const response = await requestContainerParentLanes(owner.token, batch);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid request" });
  }
});
