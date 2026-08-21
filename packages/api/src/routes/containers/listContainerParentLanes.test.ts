import { expect, test } from "bun:test";
import { createTestUser } from "@symcrypt/bob-and-alice";
import { authenticate } from "../../../test/helpers/authenticate";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

const PARENT_LANES_PATH = "/containers/parent-lanes/query";

test("the removed singular GET /containers route returns 404", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);

  const response = await routeApp.request("/containers", {
    method: "GET",
    headers: { Authorization: `Bearer ${owner.token}` },
  });

  expect(response.status).toBe(404);
});

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
