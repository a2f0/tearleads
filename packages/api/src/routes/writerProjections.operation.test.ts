import { expect, test } from "bun:test";
import {
  getContainerWriterProjectionOperation,
  getDocumentWriterProjectionOperation,
  operationRoutePath,
} from "@tearleads/validators/operation";
import type { MiddlewareHandler } from "hono";
import type { SessionEnv } from "../middleware/session";
import type { ApiServiceRuntime } from "../services/runtime";
import { createContainerWriterProjectionRoute } from "./containers/writerProjection";
import { createDocumentWriterProjectionRoute } from "./documents/writerProjection";

const runtime = {} as ApiServiceRuntime;

test("writer projection routes register from shared operations", () => {
  const requireAuth: MiddlewareHandler<SessionEnv> = (_c, next) => next();
  const routes = [
    {
      operation: getContainerWriterProjectionOperation,
      route: createContainerWriterProjectionRoute({ requireAuth, runtime }),
    },
    {
      operation: getDocumentWriterProjectionOperation,
      route: createDocumentWriterProjectionRoute({ requireAuth, runtime }),
    },
  ];

  for (const { operation, route } of routes) {
    expect(route.routes).toContainEqual(
      expect.objectContaining({
        method: operation.method,
        path: operationRoutePath(operation),
      }),
    );
  }
});

test("writer projection routes authenticate before boundary parsing", async () => {
  const requireAuth: MiddlewareHandler<SessionEnv> = async (c) =>
    c.json({ error: "Unauthorized" }, 401);
  const routes = [
    {
      path: "/containers/container-1/writer-projection",
      route: createContainerWriterProjectionRoute({ requireAuth, runtime }),
    },
    {
      path: "/documents/document-1/writer-projection",
      route: createDocumentWriterProjectionRoute({ requireAuth, runtime }),
    },
  ];

  for (const { path, route } of routes) {
    const response = await route.request(path, { method: "GET" });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  }
});
