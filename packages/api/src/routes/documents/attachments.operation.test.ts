import { expect, test } from "bun:test";
import {
  listDocumentAttachmentsOperation,
  operationRoutePath,
} from "@symcrypt/validators/operation";
import type { MiddlewareHandler } from "hono";
import type { SessionEnv } from "../../middleware/session";
import type { ApiServiceRuntime } from "../../services/runtime";
import { createDocumentAttachmentsRoute } from "./attachments";

function createRoute(requireAuth: MiddlewareHandler<SessionEnv>) {
  return createDocumentAttachmentsRoute({
    requireAuth,
    runtime: {} as ApiServiceRuntime,
  });
}

test("document attachments route registers from its shared operation", () => {
  const route = createRoute((_c, next) => next());

  expect(route.routes).toContainEqual(
    expect.objectContaining({
      method: listDocumentAttachmentsOperation.method,
      path: operationRoutePath(listDocumentAttachmentsOperation),
    }),
  );
});

test("document attachments route authenticates before boundary parsing", async () => {
  const route = createRoute(async (c) =>
    c.json({ error: "Unauthorized" }, 401),
  );
  const response = await route.request("/documents/document-1/attachments", {
    method: listDocumentAttachmentsOperation.method,
  });

  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: "Unauthorized" });
});
