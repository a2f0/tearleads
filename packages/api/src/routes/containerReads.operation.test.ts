import { expect, test } from "bun:test";
import {
  getContainerKekLogOperation,
  listContainerDocumentsOperation,
  listContainerParentLanesOperation,
  operationRoutePath,
} from "@tearleads/validators/operation";
import type { MiddlewareHandler } from "hono";
import type { SessionEnv } from "../middleware/session";
import type { ApiServiceRuntime } from "../services/runtime";
import { createContainerKekLogRoute } from "./containers/kekLog";
import { createListContainerDocumentsRoute } from "./containers/listContainerDocuments";
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
      operation: listContainerDocumentsOperation,
      route: createListContainerDocumentsRoute({ requireAuth, runtime }),
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
      init: { method: "GET" },
      path: "/containers/container-1/documents?limit=invalid",
      route: createListContainerDocumentsRoute({ requireAuth, runtime }),
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
  const documentRoute = createListContainerDocumentsRoute({
    requireAuth,
    runtime,
  });
  const documentResponse = await documentRoute.request(
    "/containers/container-1/documents?limit=0",
  );
  expect(documentResponse.status).toBe(400);
  expect(await documentResponse.json()).toEqual({ error: "Invalid limit" });

  const watermarkResponse = await documentRoute.request(
    "/containers/container-1/documents?watermarkId=document-1",
  );
  expect(watermarkResponse.status).toBe(400);
  expect(await watermarkResponse.json()).toEqual({
    error: "Invalid watermark",
  });

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
