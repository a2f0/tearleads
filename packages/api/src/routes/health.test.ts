import { expect, test } from "bun:test";
import { routeApp } from "../routeApp";

test("GET / returns health response", async () => {
  const res = await routeApp.request("/");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ message: "ok" });
});

test("GET / with body returns 413", async () => {
  const res = await routeApp.request("/", {
    method: "GET",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ unexpected: "payload" }),
  });
  expect(res.status).toBe(413);
});
