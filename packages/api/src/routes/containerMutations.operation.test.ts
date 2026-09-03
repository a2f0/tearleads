import { expect, test } from "bun:test";
import {
  createContainerOperation,
  createContainerWithMetadataDocumentOperation,
  deleteContainerOperation,
  moveContainerOperation,
  operationRoutePath,
  rekeyContainerOperation,
  revokeContainerOperation,
  shareContainerOperation,
} from "@tearleads/validators/operation";
import type { MiddlewareHandler } from "hono";
import type { SessionEnv } from "../middleware/session";
import type { ApiServiceRuntime } from "../services/runtime";
import { createContainerMutationsRoute } from "./containers/mutations";

const containerOperations = [
  createContainerOperation,
  createContainerWithMetadataDocumentOperation,
  deleteContainerOperation,
  moveContainerOperation,
  rekeyContainerOperation,
  revokeContainerOperation,
  shareContainerOperation,
] as const;

function createRoute(requireAuth: MiddlewareHandler<SessionEnv>) {
  return createContainerMutationsRoute({
    publish: async () => {},
    requireAuth,
    runtime: {} as ApiServiceRuntime,
  });
}

test("container mutation routes register from shared operations", () => {
  const route = createRoute((_c, next) => next());

  for (const operation of containerOperations) {
    expect(
      route.routes.some(
        ({ method, path }) =>
          method === operation.method && path === operationRoutePath(operation),
      ),
    ).toBe(true);
  }
});

test("container mutations authenticate before boundary parsing", async () => {
  const route = createRoute(async (c) =>
    c.json({ error: "Unauthorized" }, 401),
  );
  const response = await route.request("/containers/not-a-container/share", {
    body: "{}",
    headers: { "Content-Type": "application/json" },
    method: shareContainerOperation.method,
  });

  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: "Unauthorized" });
});

test("container mutations reject invalid bodies at the HTTP boundary", async () => {
  const route = createRoute((_c, next) => next());
  const requests = [
    route.request("/containers", {
      body: "{}",
      headers: { "Content-Type": "application/json" },
      method: createContainerOperation.method,
    }),
    route.request("/containers/with-metadata-document", {
      body: "{}",
      headers: { "Content-Type": "application/json" },
      method: createContainerWithMetadataDocumentOperation.method,
    }),
    route.request("/containers/container-1/share", {
      body: "{}",
      headers: { "Content-Type": "application/json" },
      method: shareContainerOperation.method,
    }),
  ];

  for (const request of requests) {
    const response = await request;
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid request" });
  }
});

test("container mutations return JSON for malformed request bodies", async () => {
  const route = createRoute((_c, next) => next());
  const response = await route.request("/containers", {
    body: "{",
    headers: { "Content-Type": "application/json" },
    method: createContainerOperation.method,
  });

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "Invalid request" });
});
