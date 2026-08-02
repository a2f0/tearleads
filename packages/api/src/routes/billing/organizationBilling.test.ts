import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  organizationBilling,
  organizationBillingStripeSeats,
  revenuecatWebhookEvents,
  users,
} from "@tearleads/api-shared/schema";
import { createTestUser, type TestUser } from "@tearleads/bob-and-alice";
import { isOrganizationBillingResponse } from "@tearleads/validators/response";
import { and, eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import {
  setTestOrganizationBillingExpiredTrial,
  setTestOrganizationBillingLocal,
} from "../../../test/helpers/organizationBilling";
import { registerUser } from "../../../test/helpers/registerUser";
import { addEffectiveOrganizationMember } from "../../../test/helpers/revenuecatWebhook";
import type { SessionEnv } from "../../middleware/session";
import { routeApp } from "../../routeApp";
import { getOrganizationBillingManagementUrl } from "../../services/billing/organizationBilling";
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

function authHeader(user: TestUser): { Authorization: string } {
  return { Authorization: `Bearer ${user.token}` };
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

test("an org admin reads local billing and starts a trial", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  // Test registration enables sync by default; this test exercises the
  // local -> trial transition, so start from the provisioned `local` state.
  await setTestOrganizationBillingLocal(organizationId);

  const readResponse = await routeApp.request(
    `/organizations/${organizationId}/billing`,
    { headers: authHeader(admin) },
  );
  expect(readResponse.status).toBe(200);
  const billing = await readResponse.json();
  invariant(
    isOrganizationBillingResponse(billing),
    "expected billing response",
  );
  expect(billing.status).toBe("local");
  expect(billing.activeMemberCount).toBe(1);
  expect(billing.trialEndsAt).toBeNull();

  const trialResponse = await routeApp.request(
    `/organizations/${organizationId}/billing/trial`,
    { headers: authHeader(admin), method: "POST" },
  );
  expect(trialResponse.status).toBe(200);
  const trialing = await trialResponse.json();
  invariant(
    isOrganizationBillingResponse(trialing),
    "expected billing response",
  );
  expect(trialing.status).toBe("trialing");
  expect(trialing.trialEndsAt).not.toBeNull();
  expect(trialing.seatCount).toBe(1);

  // Starting the trial again is idempotent, not an error.
  const trialAgain = await routeApp.request(
    `/organizations/${organizationId}/billing/trial`,
    { headers: authHeader(admin), method: "POST" },
  );
  expect(trialAgain.status).toBe(200);
  const stillTrialing = await trialAgain.json();
  invariant(
    isOrganizationBillingResponse(stillTrialing),
    "expected billing response",
  );
  expect(stillTrialing.status).toBe("trialing");
});

test("a free trial cannot start above the largest fixed tier", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  await setTestOrganizationBillingLocal(organizationId);
  for (let index = 0; index < 10; index += 1) {
    await addEffectiveOrganizationMember(organizationId, crypto.randomUUID());
  }

  const response = await routeApp.request(
    `/organizations/${organizationId}/billing/trial`,
    { headers: authHeader(admin), method: "POST" },
  );

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    code: "billing_roster_over_capacity",
    error:
      "The organization exceeds the maximum subscription tier of 10 members",
  });
});

test("reading an expired trial reports disabled without writing on the read path", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  // A `trialing` row whose trial has already lapsed, not yet flipped in the db.
  await setTestOrganizationBillingExpiredTrial(organizationId);

  const readResponse = await routeApp.request(
    `/organizations/${organizationId}/billing`,
    { headers: authHeader(admin) },
  );
  expect(readResponse.status).toBe(200);
  const billing = await readResponse.json();
  invariant(
    isOrganizationBillingResponse(billing),
    "expected billing response",
  );
  // The read surfaces the effective, in-memory expired state...
  expect(billing.status).toBe("disabled");

  // ...but must NOT persist it: reads run inside read transactions and a
  // write-on-read would poison a pg transaction on a read replica. The stored
  // row is still `trialing`; persisting the transition is the background sweep's
  // job.
  const [stored] = await db
    .select({ status: organizationBilling.status })
    .from(organizationBilling)
    .where(eq(organizationBilling.organizationId, organizationId));
  invariant(stored, "expected stored billing row");
  expect(stored.status).toBe("trialing");
});

test("management identifies Stripe and native subscription ownership", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  await db
    .update(organizationBilling)
    .set({
      provider: "revenuecat",
      providerProductId: "price_solo_test",
      status: "active",
    })
    .where(eq(organizationBilling.organizationId, organizationId));

  const stripeManagement = await getOrganizationBillingManagementUrl(
    getDefaultApiServiceRuntime(),
    organizationId,
    admin.userId,
    { stripe: { env: { STRIPE_SYNC_SOLO_PRICE_ID: "price_solo_test" } } },
  );
  expect(stripeManagement).toEqual({
    canCancelDirectly: true,
    managementUrl: null,
    subscriptionSource: "stripe",
  });

  await db
    .update(organizationBilling)
    .set({ status: "past_due" })
    .where(eq(organizationBilling.organizationId, organizationId));
  expect(
    await getOrganizationBillingManagementUrl(
      getDefaultApiServiceRuntime(),
      organizationId,
      admin.userId,
      { stripe: { env: { STRIPE_SYNC_SOLO_PRICE_ID: "price_solo_test" } } },
    ),
  ).toEqual({
    canCancelDirectly: true,
    managementUrl: null,
    subscriptionSource: "stripe",
  });

  await db
    .update(organizationBilling)
    .set({
      providerCustomerId: admin.userId,
      providerProductId: "sync_team_5_monthly",
      providerSubscriptionId: "native-sub-1",
      status: "active",
    })
    .where(eq(organizationBilling.organizationId, organizationId));
  await db
    .delete(organizationBillingStripeSeats)
    .where(eq(organizationBillingStripeSeats.organizationId, organizationId));
  await db.insert(organizationBillingStripeSeats).values({
    organizationId,
    priceId: null,
    subscriptionId: "sub_quarantined_native_takeover",
    subscriptionItemId: "si_quarantined_native_takeover",
  });
  const revenueCat = {
    env: {
      REVENUECAT_PROJECT_ID: "proj_test",
      REVENUECAT_V2_SECRET_KEY: "sk_test",
    },
    fetchImpl: (async () =>
      new Response(
        JSON.stringify({
          items: [
            {
              gives_access: true,
              management_url: "https://apps.apple.com/account/subscriptions",
              store_subscription_identifier: "native-sub-1",
            },
          ],
        }),
      )) as unknown as typeof fetch,
  };
  const nativeManagement = await getOrganizationBillingManagementUrl(
    getDefaultApiServiceRuntime(),
    organizationId,
    admin.userId,
    { revenueCat },
  );
  expect(nativeManagement).toEqual({
    canCancelDirectly: true,
    managementUrl: "https://apps.apple.com/account/subscriptions",
    subscriptionSource: "native",
  });

  await db
    .update(organizationBilling)
    .set({ status: "disabled" })
    .where(eq(organizationBilling.organizationId, organizationId));
  const lapsedNativeManagement = await getOrganizationBillingManagementUrl(
    getDefaultApiServiceRuntime(),
    organizationId,
    admin.userId,
    { revenueCat },
  );
  expect(lapsedNativeManagement).toEqual({
    canCancelDirectly: false,
    managementUrl: "https://apps.apple.com/account/subscriptions",
    subscriptionSource: "native",
  });

  await db
    .update(organizationBilling)
    .set({ providerProductId: "price_solo_test", status: "disabled" })
    .where(eq(organizationBilling.organizationId, organizationId));
  const staleStripeManagement = await getOrganizationBillingManagementUrl(
    getDefaultApiServiceRuntime(),
    organizationId,
    admin.userId,
    { stripe: { env: { STRIPE_SYNC_SOLO_PRICE_ID: "price_solo_test" } } },
  );
  expect(staleStripeManagement).toEqual({
    canCancelDirectly: false,
    managementUrl: null,
    subscriptionSource: null,
  });

  await db
    .update(organizationBilling)
    .set({ providerProductId: "price_rotated", status: "active" })
    .where(eq(organizationBilling.organizationId, organizationId));
  await db
    .delete(organizationBillingStripeSeats)
    .where(eq(organizationBillingStripeSeats.organizationId, organizationId));
  await db.insert(organizationBillingStripeSeats).values({
    organizationId,
    priceId: "price_rotated",
    subscriptionId: null,
    subscriptionItemId: "si_rotated",
  });
  const rotatedStripeManagement = await getOrganizationBillingManagementUrl(
    getDefaultApiServiceRuntime(),
    organizationId,
    admin.userId,
  );
  expect(rotatedStripeManagement).toEqual({
    canCancelDirectly: true,
    managementUrl: null,
    subscriptionSource: "stripe",
  });
});

test("a non-member cannot read or change another org's billing", async () => {
  const owner = createTestUser();
  const organizationId = await registerAndAuthenticate(owner);
  const intruder = createTestUser();
  await registerAndAuthenticate(intruder);

  const readResponse = await routeApp.request(
    `/organizations/${organizationId}/billing`,
    { headers: authHeader(intruder) },
  );
  expect(readResponse.status).toBe(403);

  const trialResponse = await routeApp.request(
    `/organizations/${organizationId}/billing/trial`,
    { headers: authHeader(intruder), method: "POST" },
  );
  expect(trialResponse.status).toBe(403);

  const claimResponse = await routeApp.request(
    `/organizations/${organizationId}/billing/native/play_store/claim`,
    { headers: authHeader(intruder), method: "POST" },
  );
  expect(claimResponse.status).toBe(403);

  const invalidStoreResponse = await routeApp.request(
    `/organizations/${organizationId}/billing/native/stripe/claim`,
    { headers: authHeader(owner), method: "POST" },
  );
  expect(invalidStoreResponse.status).toBe(400);
});

test("native claim moves verified billing and records both sides of the transfer", async () => {
  const previous = createTestUser();
  const previousOrganizationId = await registerAndAuthenticate(previous);
  const destination = createTestUser();
  const destinationOrganizationId = await registerAndAuthenticate(destination);
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

  const response = await app.request(
    `/organizations/${destinationOrganizationId}/billing/native/play_store/claim`,
    { method: "POST" },
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    organizationId: destinationOrganizationId,
    status: "active",
  });
  const [audit] = await db
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
  expect(audit).toEqual({
    organizationId: destinationOrganizationId,
    sourceOrganizationId: previousOrganizationId,
  });
});

test("native claim maps provider outages to 503 and gates Test Store in production", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  const unavailable = nativeClaimRoute(admin.userId, {
    env: {} as NodeJS.ProcessEnv,
  });
  expect(
    (
      await unavailable.request(
        `/organizations/${organizationId}/billing/native/play_store/claim`,
        { method: "POST" },
      )
    ).status,
  ).toBe(503);

  const production = nativeClaimRoute(admin.userId, {
    env: {
      REVENUECAT_PROJECT_ID: "proj_1",
      REVENUECAT_V2_SECRET_KEY: "sk_test",
    },
    fetchImpl: (async (_input: RequestInfo | URL): Promise<Response> => {
      throw new Error("production Test Store must not call RevenueCat");
    }) as typeof fetch,
  });
  expect(
    (
      await production.request(
        `/organizations/${organizationId}/billing/native/test_store/claim`,
        { method: "POST" },
      )
    ).status,
  ).toBe(404);
});
