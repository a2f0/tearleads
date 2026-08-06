import { expect, test } from "bun:test";
import {
  getBlobBytesOperation,
  operationRoutePath,
} from "@tearleads/validators/operation";
import type { MiddlewareHandler } from "hono";
import type { SessionEnv } from "../../middleware/session";
import type { ApiServiceRuntime } from "../../services/runtime";
import { createGetBlobRoute } from "./getBlob";

function createRoute(requireAuth: MiddlewareHandler<SessionEnv>) {
  return createGetBlobRoute({
    requireAuth,
    runtime: {} as ApiServiceRuntime,
  });
}

test("blob bytes route registers from the shared operation", () => {
  const route = createRoute((_c, next) => next());

  expect(route.routes).toContainEqual(
    expect.objectContaining({
      method: getBlobBytesOperation.method,
      path: operationRoutePath(getBlobBytesOperation),
    }),
  );
});

test("blob bytes route authenticates before boundary parsing", async () => {
  const route = createRoute(async (c) =>
    c.json({ error: "Unauthorized" }, 401),
  );
  const response = await route.request("/blobs/invalid/bytes", {
    method: getBlobBytesOperation.method,
  });

  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: "Unauthorized" });
});

test("blob bytes route rejects invalid path parameters at the boundary", async () => {
  const route = createRoute((_c, next) => next());
  const response = await route.request("/blobs/invalid/bytes", {
    method: getBlobBytesOperation.method,
  });

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "Invalid request" });
});
