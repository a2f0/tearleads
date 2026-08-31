import { expect, test } from "bun:test";
import {
  claimNativeOrganizationSubscriptionOperation,
  getOrganizationBillingHistoryOperation,
  getOrganizationBillingManagementUrlOperation,
  getOrganizationBillingOperation,
  getOrganizationNativePurchaseEligibilityOperation,
  operationRoutePath,
  startOrganizationTrialOperation,
} from "@symcrypt/validators/operation";
import type { MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";
import type { SessionEnv } from "../../middleware/session";
import type { ApiServiceRuntime } from "../../services/runtime";
import { OrganizationManagerError } from "../../workflows/organizations/errors";
import { createOrganizationBillingRoute } from "./organizationBilling";

const operations = [
  getOrganizationBillingOperation,
  getOrganizationBillingHistoryOperation,
  getOrganizationBillingManagementUrlOperation,
  getOrganizationNativePurchaseEligibilityOperation,
  claimNativeOrganizationSubscriptionOperation,
  startOrganizationTrialOperation,
] as const;

function createTestRoute(
  requireAuth: MiddlewareHandler<SessionEnv>,
  runtime: ApiServiceRuntime = {} as ApiServiceRuntime,
) {
  return createOrganizationBillingRoute({
    requireAuth,
    runtime,
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

test("native purchase eligibility responses are never cacheable", async () => {
  const requireAuth = createMiddleware<SessionEnv>(async (c, next) => {
    c.set("session", {
      createdAt: 0,
      fingerprint: "test-fingerprint",
      id: "test-session",
      ipAddresses: [],
      lastActiveAt: 0,
      lastActiveIp: null,
      userId: "user-1",
    });
    return next();
  });
  const runtime = {
    db: {
      transaction: () =>
        Promise.reject(new OrganizationManagerError("Conflict", 409)),
    },
  } as unknown as ApiServiceRuntime;
  const response = await createTestRoute(requireAuth, runtime).request(
    "/organizations/11111111-1111-4111-8111-111111111111/billing/native/eligibility",
  );

  expect(response.status).toBe(409);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
});

test("organization billing routes authenticate before path validation", async () => {
  const route = createTestRoute(async (c) =>
    c.json({ error: "Unauthorized" }, 401),
  );
  const requests = [
    ["GET", "/organizations/invalid/billing"],
    ["GET", "/organizations/invalid/billing/history"],
    ["GET", "/organizations/invalid/billing/management-url"],
    ["GET", "/organizations/invalid/billing/native/eligibility"],
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
    ["GET", "/organizations/invalid/billing/native/eligibility"],
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
