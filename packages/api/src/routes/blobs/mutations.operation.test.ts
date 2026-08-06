import { expect, test } from "bun:test";
import {
  bindBlobAttachmentOperation,
  detachBlobAttachmentOperation,
  operationRoutePath,
} from "@tearleads/validators/operation";
import type { MiddlewareHandler } from "hono";
import type { SessionEnv } from "../../middleware/session";
import type { ApiServiceRuntime } from "../../services/runtime";
import { createBlobMutationsRoute } from "./mutations";

function createRoute(requireAuth: MiddlewareHandler<SessionEnv>) {
  return createBlobMutationsRoute({
    requireAuth,
    runtime: {} as ApiServiceRuntime,
  });
}

test("blob attachment routes register from shared operations", () => {
  const route = createRoute((_c, next) => next());

  for (const operation of [
    bindBlobAttachmentOperation,
    detachBlobAttachmentOperation,
  ]) {
    expect(route.routes).toContainEqual(
      expect.objectContaining({
        method: operation.method,
        path: operationRoutePath(operation),
      }),
    );
  }
});

test("blob attachment routes authenticate before body validation", async () => {
  const route = createRoute(async (c) =>
    c.json({ error: "Unauthorized" }, 401),
  );
  const response = await route.request("/blobs/blob-1/attachment-bindings", {
    body: "{}",
    headers: { "Content-Type": "application/json" },
    method: bindBlobAttachmentOperation.method,
  });

  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: "Unauthorized" });
});

test("blob attachment routes reject invalid bodies at the boundary", async () => {
  const route = createRoute((_c, next) => next());
  const requests = [
    route.request("/blobs/blob-1/attachment-bindings", {
      body: "{}",
      headers: { "Content-Type": "application/json" },
      method: bindBlobAttachmentOperation.method,
    }),
    route.request("/blobs/blob-1/attachment-bindings/binding-1/detach", {
      body: "{}",
      headers: { "Content-Type": "application/json" },
      method: detachBlobAttachmentOperation.method,
    }),
  ];

  for (const request of requests) {
    const response = await request;
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid request" });
  }
});

test("blob attachment routes preserve malformed JSON behavior", async () => {
  const route = createRoute((_c, next) => next());
  const response = await route.request("/blobs/blob-1/attachment-bindings", {
    body: "{",
    headers: { "Content-Type": "application/json" },
    method: bindBlobAttachmentOperation.method,
  });

  expect(response.status).toBe(400);
  expect(await response.text()).toBe("Malformed JSON in request body");
});
