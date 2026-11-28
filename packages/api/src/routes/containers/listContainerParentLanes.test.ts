import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { containers } from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/test-utils";
import { isListContainerParentLanesResponse } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import { authenticate } from "../../../test/helpers/authenticate";
import {
  readContainerParentLaneResults,
  requestContainerParentLanes,
} from "../../../test/helpers/containerParentLaneQuery";
import { loadRegisteredContainerRoots } from "../../../test/helpers/listContainerRoots";
import { createOwnedTree } from "../../../test/helpers/ownedContainerTree";
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
  const firstResult = body.results[0];
  if (!firstResult || !("page" in firstResult)) {
    throw new Error("Expected a full root page");
  }
  expect(firstResult.page.items.map((item) => item.id)).toEqual(rootIds);
  // Lanes that name the same parent list the same children.
  const repeated = body.results.filter(
    (_, index) => index > 0 && lanes[index]?.parentId === lanes[1]?.parentId,
  );
  expect(repeated.length).toBeGreaterThan(1);
  expect(
    new Set(
      repeated.map((result) =>
        JSON.stringify("page" in result ? result.page : null),
      ),
    ).size,
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

test("parent-lanes/query serves idsOnly root membership pages and rejects non-root idsOnly", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const roots = await loadRegisteredContainerRoots(owner);

  const response = await requestContainerParentLanes(owner.token, [
    { idsOnly: true, laneId: "root-ids", parentId: null },
  ]);
  expect(response.status).toBe(200);
  const [idsResult] = await readContainerParentLaneResults(response);
  if (!idsResult || !("idsPage" in idsResult)) {
    throw new Error("Expected an idsPage result");
  }
  expect(idsResult.idsPage.hasMore).toBe(false);
  expect(idsResult.idsPage.items.map((item) => item.id)).toEqual(
    roots.map((root) => root.id),
  );
  expect(
    idsResult.idsPage.items.every(
      (item) => item.directAccessLevel === "admin" && item.parentId === null,
    ),
  ).toBe(true);

  const nonRoot = await requestContainerParentLanes(owner.token, [
    { idsOnly: true, laneId: "child-ids", parentId: owner.rootContainerId },
  ]);
  expect(nonRoot.status).toBe(400);
});

test("parent-lanes/query isolates a corrupted child lane without failing sibling lanes", async () => {
  const tree = await createOwnedTree(0);
  try {
    const healthyParent = await tree.createChild(tree.rootId);
    const healthyLeaf = await tree.createChild(healthyParent);
    const brokenParent = await tree.createChild(tree.rootId);
    const brokenLeaf = await tree.createChild(brokenParent);

    await db
      .update(containers)
      .set({ organizationId: crypto.randomUUID() })
      .where(eq(containers.id, brokenLeaf));

    const response = await requestContainerParentLanes(tree.owner.token, [
      { laneId: "healthy", parentId: healthyParent },
      { laneId: "broken", parentId: brokenParent },
    ]);
    expect(response.status).toBe(200);
    const [healthyResult, brokenResult] =
      await readContainerParentLaneResults(response);
    if (!healthyResult || !("page" in healthyResult)) {
      throw new Error("Expected healthy parent lane to return a page");
    }
    expect(healthyResult.page.items.map((item) => item.id)).toEqual([
      healthyLeaf,
    ]);
    expect(brokenResult).toEqual({
      failure: {
        error: "Container row does not match signed manifest state",
        status: 409,
      },
      laneId: "broken",
    });
  } finally {
    tree.close();
  }
});
