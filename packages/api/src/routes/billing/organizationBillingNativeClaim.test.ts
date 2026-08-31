import { expect, test } from "bun:test";
import { db } from "@symcrypt/api-shared/postgres";
import {
  organizationBilling,
  revenuecatWebhookEvents,
  users,
} from "@symcrypt/api-shared/schema";
import { createTestUser, type TestUser } from "@symcrypt/bob-and-alice";
import { and, eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import invariant from "invariant";
import * as api from "../../../test/helpers/api";
import { authenticate } from "../../../test/helpers/authenticate";
import { registerUser } from "../../../test/helpers/registerUser";
import type { SessionEnv } from "../../middleware/session";
import { getDefaultApiServiceRuntime } from "../../services/runtime";
import { createOrganizationBillingRoute } from "./organizationBilling";

async function registerAndAuthenticate(user: TestUser): Promise<string> {
  await registerUser(user);
  await authenticate(user);
  const [row] = await db
    .select({ organizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, user.userId));
  invariant(row, "expected registered user row");
  return row.organizationId;
}

async function registerNativeRestoreOrganization(
  user: TestUser,
): Promise<string> {
  await registerAndAuthenticate(user);
  const request = {
    ...(await api.createOrganizationRequestBody(user)),
    nativeSubscriptionRestore: true as const,
  };
  const response = await api.submitCreateOrganization(user, request);
  expect(response.status).toBe(200);
  return request.organizationId;
}

function nativeClaimRoute(
  userId: string,
  revenueCat: {
    readonly env: NodeJS.ProcessEnv;
    readonly fetchImpl?: typeof fetch;
  },
) {
  return createOrganizationBillingRoute({
    requireAuth: createMiddleware<SessionEnv>(async (c, next) => {
      c.set("session", {
        createdAt: Date.now(),
        fingerprint: "test-fingerprint",
        id: "test-session",
        ipAddresses: [],
        lastActiveAt: Date.now(),
        lastActiveIp: null,
        userId,
      });
      return next();
    }),
    revenueCat,
    runtime: getDefaultApiServiceRuntime(),
  });
}

function activeNativeSubscriptionFetch() {
  return (async (input: RequestInfo | URL) => {
    if (String(input).includes("/products/")) {
      return Response.json({ store_identifier: "sync_solo_monthly:monthly" });
    }
    return Response.json({
      items: [
        {
          current_period_ends_at: "2030-02-01T00:00:00Z",
          current_period_starts_at: "2030-01-01T00:00:00Z",
          environment: "production",
          gives_access: true,
          product_id: "prod_solo",
          status: "active",
          store: "play_store",
          store_subscription_identifier: "GPA.route-claim",
        },
      ],
    });
  }) as typeof fetch;
}

test("native claim moves verified billing and records both sides of the transfer", async () => {
  const previous = createTestUser();
  const previousOrganizationId = await registerAndAuthenticate(previous);
  const destination = createTestUser();
  const destinationOrganizationId =
    await registerNativeRestoreOrganization(destination);
  await db
    .update(organizationBilling)
    .set({
      provider: "revenuecat",
      providerCustomerId: previous.userId,
      providerProductId: "sync_solo_monthly:monthly",
      providerSubscriptionId: "GPA.route-claim",
      seatCount: 1,
      status: "active",
    })
    .where(eq(organizationBilling.organizationId, previousOrganizationId));
  const app = nativeClaimRoute(destination.userId, {
    env: {
      REVENUECAT_PROJECT_ID: "proj_1",
      REVENUECAT_V2_SECRET_KEY: "sk_test",
    },
    fetchImpl: activeNativeSubscriptionFetch(),
  });

  const claimUrl = `/organizations/${destinationOrganizationId}/billing/native/play_store/claim`;
  const response = await app.request(claimUrl, { method: "POST" });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    organizationId: destinationOrganizationId,
    status: "active",
  });
  expect((await app.request(claimUrl, { method: "POST" })).status).toBe(200);
  const audits = await db
    .select({
      organizationId: revenuecatWebhookEvents.organizationId,
      sourceOrganizationId: revenuecatWebhookEvents.sourceOrganizationId,
    })
    .from(revenuecatWebhookEvents)
    .where(
      and(
        eq(revenuecatWebhookEvents.eventType, "TRANSFER"),
        eq(revenuecatWebhookEvents.organizationId, destinationOrganizationId),
      ),
    );
  expect(audits).toEqual([
    {
      organizationId: destinationOrganizationId,
      sourceOrganizationId: previousOrganizationId,
    },
  ]);
  const [restoreIntent] = await db
    .select({ claimedAt: organizationBilling.nativeRestoreClaimedAt })
    .from(organizationBilling)
    .where(eq(organizationBilling.organizationId, destinationOrganizationId));
  expect(restoreIntent?.claimedAt).toBeInstanceOf(Date);
});

test("native claim rejects an ordinary organization administered by the buyer", async () => {
  const buyer = createTestUser();
  const organizationId = await registerAndAuthenticate(buyer);
  const app = nativeClaimRoute(buyer.userId, {
    env: {
      REVENUECAT_PROJECT_ID: "proj_1",
      REVENUECAT_V2_SECRET_KEY: "sk_test",
    },
    fetchImpl: activeNativeSubscriptionFetch(),
  });
  const response = await app.request(
    `/organizations/${organizationId}/billing/native/play_store/claim`,
    { method: "POST" },
  );
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error: "Native subscription restore requires a fresh restore organization",
  });
});

test("native claim maps provider outages to 503 and gates Test Store in production", async () => {
  const admin = createTestUser();
  const organizationId = await registerNativeRestoreOrganization(admin);
  const unavailable = nativeClaimRoute(admin.userId, {
    env: {} as NodeJS.ProcessEnv,
  });
  const playUrl = `/organizations/${organizationId}/billing/native/play_store/claim`;
  expect((await unavailable.request(playUrl, { method: "POST" })).status).toBe(
    503,
  );

  const production = nativeClaimRoute(admin.userId, {
    env: {
      REVENUECAT_PROJECT_ID: "proj_1",
      REVENUECAT_V2_SECRET_KEY: "sk_test",
    },
    fetchImpl: (async (_input: RequestInfo | URL): Promise<Response> => {
      throw new Error("production Test Store must not call RevenueCat");
    }) as typeof fetch,
  });
  const testUrl = `/organizations/${organizationId}/billing/native/test_store/claim`;
  expect((await production.request(testUrl, { method: "POST" })).status).toBe(
    404,
  );
});

test("native claim maps ambiguous receipts to 409", async () => {
  const admin = createTestUser();
  const organizationId = await registerNativeRestoreOrganization(admin);
  const active = (subscriptionId: string) => ({
    environment: "production",
    gives_access: true,
    product_id: "prod_1",
    store: "play_store",
    store_subscription_identifier: subscriptionId,
  });
  const ambiguous = nativeClaimRoute(admin.userId, {
    env: {
      REVENUECAT_PROJECT_ID: "proj_1",
      REVENUECAT_V2_SECRET_KEY: "sk_test",
    },
    fetchImpl: (async (_input: RequestInfo | URL) =>
      Response.json({
        items: [active("GPA.ambiguous-1"), active("GPA.ambiguous-2")],
      })) as typeof fetch,
  });
  const claimUrl = `/organizations/${organizationId}/billing/native/play_store/claim`;
  const response = await ambiguous.request(claimUrl, { method: "POST" });
  expect(response.status).toBe(409);
});
