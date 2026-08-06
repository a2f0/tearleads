import { expect, test } from "bun:test";
import {
  destroySessionOperation,
  listSessionsOperation,
  logoutOperation,
  operationRoutePath,
  userIdentityOperation,
  webSocketTicketOperation,
} from "@tearleads/validators/operation";
import type { MiddlewareHandler } from "hono";
import type { SessionEnv } from "../../middleware/session";
import type { ApiServiceRuntime } from "../../services/runtime";
import { createLogoutRoute } from "./logout";
import { createSessionsRoute } from "./sessions";
import { createUserIdentityRoute } from "./userIdentity";
import { createWsTicketRoute } from "./wsTicket";

const allowAuth: MiddlewareHandler<SessionEnv> = (_c, next) => next();

function hasOperationRoute(
  route: { readonly routes: readonly { method: string; path: string }[] },
  operation: { readonly method: string; readonly path: `/${string}` },
) {
  return route.routes.some(
    ({ method, path }) =>
      method === operation.method && path === operationRoutePath(operation),
  );
}

test("auth session and identity routes derive registration from operations", () => {
  const logoutRoute = createLogoutRoute({
    destroySession: async () => undefined,
    requireAuth: allowAuth,
  });
  const sessionsRoute = createSessionsRoute({
    destroyUserSession: async () => false,
    listUserSessions: async () => [],
    requireAuth: allowAuth,
  });
  const userIdentityRoute = createUserIdentityRoute({
    requireAuth: allowAuth,
    runtime: {} as ApiServiceRuntime,
  });
  const webSocketTicketRoute = createWsTicketRoute({
    issueTicket: async () => "ticket",
    requireAuth: allowAuth,
  });

  expect(hasOperationRoute(logoutRoute, logoutOperation)).toBe(true);
  expect(hasOperationRoute(sessionsRoute, listSessionsOperation)).toBe(true);
  expect(hasOperationRoute(sessionsRoute, destroySessionOperation)).toBe(true);
  expect(hasOperationRoute(userIdentityRoute, userIdentityOperation)).toBe(
    true,
  );
  expect(
    hasOperationRoute(webSocketTicketRoute, webSocketTicketOperation),
  ).toBe(true);
});

test("destroy-session authenticates before validating path parameters", async () => {
  const sessionsRoute = createSessionsRoute({
    destroyUserSession: async () => false,
    listUserSessions: async () => [],
    requireAuth: async (c) => c.json({ error: "Unauthorized" }, 401),
  });
  const response = await sessionsRoute.request("/auth/sessions/invalid", {
    method: destroySessionOperation.method,
  });

  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: "Unauthorized" });
});

test("destroy-session preserves its invalid-id response", async () => {
  const sessionsRoute = createSessionsRoute({
    destroyUserSession: async () => false,
    listUserSessions: async () => [],
    requireAuth: allowAuth,
  });
  const response = await sessionsRoute.request("/auth/sessions/invalid", {
    method: destroySessionOperation.method,
  });

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "Invalid session id" });
});
