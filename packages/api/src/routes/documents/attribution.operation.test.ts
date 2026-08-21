import { expect, test } from "bun:test";
import {
  getDocumentAttributionOperation,
  listDocumentAttributionRangesOperation,
  operationRoutePath,
} from "@symcrypt/validators/operation";
import type { MiddlewareHandler } from "hono";
import type { SessionEnv } from "../../middleware/session";
import type { ApiServiceRuntime } from "../../services/runtime";
import { createDocumentAttributionRoute } from "./attribution";

function createRoute(requireAuth: MiddlewareHandler<SessionEnv>) {
  return createDocumentAttributionRoute({
    requireAuth,
    runtime: {} as ApiServiceRuntime,
  });
}

test("document attribution routes register from shared operations", () => {
  const route = createRoute((_c, next) => next());

  for (const operation of [
    getDocumentAttributionOperation,
    listDocumentAttributionRangesOperation,
  ]) {
    expect(route.routes).toContainEqual(
      expect.objectContaining({
        method: operation.method,
        path: operationRoutePath(operation),
      }),
    );
  }
});

test("document attribution authenticates before boundary parsing", async () => {
  const route = createRoute(async (c) =>
    c.json({ error: "Unauthorized" }, 401),
  );
  const response = await route.request(
    "/documents/document-1/attribution/ranges?limit=invalid",
    { method: listDocumentAttributionRangesOperation.method },
  );

  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: "Unauthorized" });
});
