import { expect, test } from "bun:test";
import {
  documentSyncOperation,
  operationRoutePath,
} from "@tearleads/validators/operation";
import type { MiddlewareHandler } from "hono";
import type { SessionEnv } from "../../middleware/session";
import type { ApiServiceRuntime } from "../../services/runtime";
import { createDocumentMutationsRoute } from "./mutations";

function createTestRoute(requireAuth: MiddlewareHandler<SessionEnv>) {
  return createDocumentMutationsRoute({
    publish: async () => undefined,
    requireAuth,
    runtime: {} as ApiServiceRuntime,
  });
}

test("document sync route is registered from the shared operation", () => {
  const route = createTestRoute((_c, next) => next());

  expect(
    route.routes.some(
      ({ method, path }) =>
        method === documentSyncOperation.method &&
        path === operationRoutePath(documentSyncOperation),
    ),
  ).toBe(true);
});

test("document sync authenticates before validating the shared request body", async () => {
  const route = createTestRoute(async (c) =>
    c.json({ error: "Unauthorized" }, 401),
  );
  const response = await route.request("/documents/document-1/sync", {
    body: "{}",
    headers: { "Content-Type": "application/json" },
    method: documentSyncOperation.method,
  });

  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: "Unauthorized" });
});

test("document sync preserves the invalid-request response", async () => {
  const route = createTestRoute((_c, next) => next());
  const response = await route.request("/documents/document-1/sync", {
    body: "{}",
    headers: { "Content-Type": "application/json" },
    method: documentSyncOperation.method,
  });

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "Invalid request" });
});

test("document sync keeps malformed JSON as a status-only failure", async () => {
  const route = createTestRoute((_c, next) => next());
  const response = await route.request("/documents/document-1/sync", {
    body: "{",
    headers: { "Content-Type": "application/json" },
    method: documentSyncOperation.method,
  });

  expect(response.status).toBe(400);
  expect(await response.text()).toBe("Malformed JSON in request body");
});
