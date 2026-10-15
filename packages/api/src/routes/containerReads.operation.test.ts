import { expect, test } from "bun:test";
import {
  getContainerKekLogOperation,
  listContainerDocumentLanesOperation,
  listContainerParentLanesOperation,
  operationRoutePath,
} from "@tearleads/validators/operation";
import type { MiddlewareHandler } from "hono";
import type { SessionEnv } from "../middleware/session";
import type { ApiServiceRuntime } from "../services/runtime";
import { createContainerKekLogRoute } from "./containers/kekLog";
import { createListContainerDocumentLanesRoute } from "./containers/listContainerDocumentLanes";
import { createListContainerParentLanesRoute } from "./containers/listContainerParentLanes";

const runtime = {} as ApiServiceRuntime;

test("container read routes register from shared operations", () => {
  const requireAuth: MiddlewareHandler<SessionEnv> = (_c, next) => next();
  const routes = [
    {
      operation: getContainerKekLogOperation,
      route: createContainerKekLogRoute({ requireAuth, runtime }),
    },
    {
      operation: listContainerDocumentLanesOperation,
      route: createListContainerDocumentLanesRoute({ requireAuth, runtime }),
    },
    {
      operation: listContainerParentLanesOperation,
      route: createListContainerParentLanesRoute({ requireAuth, runtime }),
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

test("container read routes authenticate before boundary parsing", async () => {
  const requireAuth: MiddlewareHandler<SessionEnv> = async (c) =>
    c.json({ error: "Unauthorized" }, 401);
  const requests = [
    {
      init: { method: "GET" },
      path: "/containers/container-1/kek-log?afterKeyEpoch=malformed",
      route: createContainerKekLogRoute({ requireAuth, runtime }),
    },
    {
      init: { method: "POST" },
      path: "/containers/documents/query",
      route: createListContainerDocumentLanesRoute({ requireAuth, runtime }),
    },
    {
      init: { method: "POST" },
      path: "/containers/parent-lanes/query",
      route: createListContainerParentLanesRoute({ requireAuth, runtime }),
    },
  ];

  for (const request of requests) {
    const response = await request.route.request(request.path, request.init);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  }
});

test("container list inputs reject invalid values at the HTTP boundary", async () => {
  const requireAuth: MiddlewareHandler<SessionEnv> = (_c, next) => next();
  const documentRoute = createListContainerDocumentLanesRoute({
    requireAuth,
    runtime,
  });
  const lane = {
    containerId: "6f9619ff-8b86-4d01-b42d-00cf4fc964ff",
    laneId: "lane-0",
    watermark: null,
  };
  for (const lanes of [
    [],
    [{ ...lane, limit: 0 }],
    [{ ...lane, watermark: { id: "document-1" } }],
    [{ ...lane, containerId: "container-1" }],
    Array.from({ length: 33 }, (_, index) => ({
      ...lane,
      laneId: `lane-${index}`,
      limit: 1,
    })),
  ]) {
    const documentResponse = await documentRoute.request(
      "/containers/documents/query",
      {
        body: JSON.stringify({ lanes }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(documentResponse.status).toBe(400);
    expect(await documentResponse.json()).toEqual({ error: "Invalid request" });
  }

  const parentRoute = createListContainerParentLanesRoute({
    requireAuth,
    runtime,
  });
  const parentResponse = await parentRoute.request(
    "/containers/parent-lanes/query",
    {
      body: JSON.stringify({ lanes: [] }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  expect(parentResponse.status).toBe(400);
  expect(await parentResponse.json()).toEqual({ error: "Invalid request" });
});
