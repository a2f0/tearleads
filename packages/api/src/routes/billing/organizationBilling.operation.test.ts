import { expect, test } from "bun:test";
import {
  claimNativeOrganizationSubscriptionOperation,
  getOrganizationBillingHistoryOperation,
  getOrganizationBillingManagementUrlOperation,
  getOrganizationBillingOperation,
  operationRoutePath,
  startOrganizationTrialOperation,
} from "@tearleads/validators/operation";
import type { MiddlewareHandler } from "hono";
import type { SessionEnv } from "../../middleware/session";
import type { ApiServiceRuntime } from "../../services/runtime";
import { createOrganizationBillingRoute } from "./organizationBilling";

const operations = [
  getOrganizationBillingOperation,
  getOrganizationBillingHistoryOperation,
  getOrganizationBillingManagementUrlOperation,
  claimNativeOrganizationSubscriptionOperation,
  startOrganizationTrialOperation,
] as const;

function createTestRoute(requireAuth: MiddlewareHandler<SessionEnv>) {
  return createOrganizationBillingRoute({
    requireAuth,
    runtime: {} as ApiServiceRuntime,
  });
}

test("organization billing routes register from shared operations", () => {
  const route = createTestRoute((_c, next) => next());

  for (const operation of operations) {
    expect(
      route.routes.some(
        ({ method, path }) =>
          method === operation.method && path === operationRoutePath(operation),
      ),
    ).toBe(true);
  }
});

test("organization billing routes authenticate before path validation", async () => {
  const route = createTestRoute(async (c) =>
    c.json({ error: "Unauthorized" }, 401),
  );
  const requests = [
    ["GET", "/organizations/invalid/billing"],
    ["GET", "/organizations/invalid/billing/history"],
    ["GET", "/organizations/invalid/billing/management-url"],
    ["POST", "/organizations/invalid/billing/native/invalid/claim"],
    ["POST", "/organizations/invalid/billing/trial"],
  ] as const;

  for (const [method, path] of requests) {
    const response = await route.request(path, { method });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  }
});

test("organization billing routes reject invalid organization ids at the boundary", async () => {
  const route = createTestRoute((_c, next) => next());
  const requests = [
    ["GET", "/organizations/invalid/billing"],
    ["GET", "/organizations/invalid/billing/history"],
    ["GET", "/organizations/invalid/billing/management-url"],
    ["POST", "/organizations/invalid/billing/native/play_store/claim"],
    ["POST", "/organizations/invalid/billing/trial"],
  ] as const;

  for (const [method, path] of requests) {
    const response = await route.request(path, { method });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid organizationId" });
  }
});

test("native claims preserve their store-specific validation response", async () => {
  const route = createTestRoute((_c, next) => next());
  const paths = [
    "/organizations/11111111-1111-4111-8111-111111111111/billing/native/stripe/claim",
    "/organizations/invalid/billing/native/stripe/claim",
  ];

  for (const path of paths) {
    const response = await route.request(path, { method: "POST" });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Invalid native subscription store",
    });
  }
});
