import { expect, test } from "bun:test";
import { routeApp } from "../routeApp";

test("GET / with body returns 413", async () => {
  const res = await routeApp.request("/", {
    method: "GET",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ unexpected: "payload" }),
  });
  expect(res.status).toBe(413);
});
