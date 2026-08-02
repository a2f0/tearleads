import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  organizationBilling,
  organizationBillingStripeSeats,
  revenuecatWebhookEvents,
  users,
} from "@tearleads/api-shared/schema";
import { createTestUser, type TestUser } from "@tearleads/bob-and-alice";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { registerUser } from "../../../test/helpers/registerUser";
import { getDefaultApiServiceRuntime } from "../runtime";
import { claimNativeOrganizationSubscription } from "./organizationBilling";
import { processRevenueCatWebhook } from "./revenuecatWebhook";

const ENV = {
  REVENUECAT_ALLOW_SANDBOX_EVENTS: "true",
  REVENUECAT_PROJECT_ID: "proj_1",
  REVENUECAT_V2_SECRET_KEY: "sk_test",
} as NodeJS.ProcessEnv;

async function registerPersonalOrganization(): Promise<{
  readonly organizationId: string;
  readonly user: TestUser;
}> {
  const user = createTestUser();
  await registerUser(user);
  const [registered] = await db
    .select({ organizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, user.userId));
  invariant(registered, "expected registered user");
  return { organizationId: registered.organizationId, user };
}

function providerFetch(subscriptionId = "GPA.transfer-webhook") {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/products/prod_team_5")) {
      return Response.json({
        store_identifier: "sync_team_5_monthly:monthly",
      });
    }
    return Response.json({
      items: [
        {
          current_period_ends_at: "2030-02-01T00:00:00Z",
          current_period_starts_at: "2030-01-01T00:00:00Z",
          environment: "sandbox",
          gives_access: true,
          product_id: "prod_team_5",
          status: "active",
          store: "play_store",
          store_subscription_identifier: subscriptionId,
        },
      ],
    });
  }) as typeof fetch;
}

test("only an authenticated claim can move billing before a transfer webhook", async () => {
  const previous = await registerPersonalOrganization();
  const destination = await registerPersonalOrganization();
  await db
    .update(organizationBilling)
    .set({
      provider: "revenuecat",
      providerCustomerId: previous.user.userId,
      providerProductId: "sync_team_5_monthly:monthly",
      providerSubscriptionId: "GPA.transfer-webhook",
      seatCount: 5,
      status: "active",
    })
    .where(eq(organizationBilling.organizationId, previous.organizationId));
  const event = {
    environment: "SANDBOX",
    event_timestamp_ms: Date.now(),
    id: crypto.randomUUID(),
    store: "PLAY_STORE",
    transferred_from: [previous.user.userId],
    transferred_to: [destination.user.userId],
    type: "TRANSFER" as const,
  };

  const runtime = getDefaultApiServiceRuntime();
  expect(
    await processRevenueCatWebhook(runtime, event, {
      env: ENV,
      fetchImpl: providerFetch(),
    }),
  ).toEqual({
    reason: "Transfer awaits an authenticated native subscription claim",
    status: "retry",
  });

  const [untouched] = await db
    .select({ status: organizationBilling.status })
    .from(organizationBilling)
    .where(eq(organizationBilling.organizationId, previous.organizationId));
  expect(untouched?.status).toBe("active");

  await claimNativeOrganizationSubscription(
    runtime,
    destination.organizationId,
    destination.user.userId,
    "play_store",
    { env: ENV, fetchImpl: providerFetch() },
  );
  expect(
    await processRevenueCatWebhook(runtime, event, {
      env: ENV,
      fetchImpl: providerFetch(),
    }),
  ).toEqual({
    billingStatus: "active",
    organizationId: destination.organizationId,
    status: "applied",
  });
  expect(
    await processRevenueCatWebhook(runtime, event, {
      env: ENV,
      fetchImpl: providerFetch(),
    }),
  ).toEqual({ status: "duplicate" });

  const [oldBilling] = await db
    .select({
      disabledAt: organizationBilling.disabledAt,
      purgeAfter: organizationBilling.purgeAfter,
      status: organizationBilling.status,
    })
    .from(organizationBilling)
    .where(eq(organizationBilling.organizationId, previous.organizationId));
  const [newBilling] = await db
    .select({
      providerCustomerId: organizationBilling.providerCustomerId,
      seatCount: organizationBilling.seatCount,
      status: organizationBilling.status,
    })
    .from(organizationBilling)
    .where(eq(organizationBilling.organizationId, destination.organizationId));
  expect(oldBilling?.status).toBe("disabled");
  expect(oldBilling?.disabledAt).toBeInstanceOf(Date);
  expect(oldBilling?.purgeAfter).toBeInstanceOf(Date);
  expect(newBilling).toEqual({
    providerCustomerId: destination.user.userId,
    seatCount: 5,
    status: "active",
  });
});

test("a transfer without its optional store resolves the sole native subscription", async () => {
  const destination = await registerPersonalOrganization();
  const event = {
    environment: "SANDBOX",
    event_timestamp_ms: Date.now(),
    id: crypto.randomUUID(),
    transferred_from: [crypto.randomUUID()],
    transferred_to: [destination.user.userId],
    type: "TRANSFER" as const,
  };
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/products/")) {
      return Response.json({
        store_identifier: "sync_team_5_monthly:monthly",
      });
    }
    return Response.json({
      items: [
        {
          current_period_ends_at: "2030-02-01T00:00:00Z",
          current_period_starts_at: "2030-01-01T00:00:00Z",
          environment: "sandbox",
          gives_access: true,
          product_id: "prod_team_5",
          store: "play_store",
          store_subscription_identifier: "GPA.store-optional",
        },
      ],
    });
  }) as typeof fetch;

  const runtime = getDefaultApiServiceRuntime();
  await claimNativeOrganizationSubscription(
    runtime,
    destination.organizationId,
    destination.user.userId,
    "play_store",
    { env: ENV, fetchImpl },
  );

  expect(
    await processRevenueCatWebhook(runtime, event, {
      env: ENV,
      fetchImpl,
    }),
  ).toEqual({
    billingStatus: "active",
    organizationId: destination.organizationId,
    status: "applied",
  });
});

test("permanent transfer claim rejections are acknowledged without redelivery", async () => {
  const destination = await registerPersonalOrganization();
  const eventId = crypto.randomUUID();
  const subscriptionId = `GPA.transfer-permanent-${eventId}`;
  await db
    .update(organizationBilling)
    .set({
      provider: "revenuecat",
      providerCustomerId: destination.user.userId,
      providerProductId: "sync_team_5_monthly:monthly",
      providerSubscriptionId: subscriptionId,
      seatCount: 5,
      status: "active",
    })
    .where(eq(organizationBilling.organizationId, destination.organizationId));
  await db
    .update(organizationBillingStripeSeats)
    .set({ subscriptionId: `sub_${crypto.randomUUID()}` })
    .where(
      eq(
        organizationBillingStripeSeats.organizationId,
        destination.organizationId,
      ),
    );
  const event = {
    environment: "SANDBOX",
    event_timestamp_ms: Date.now(),
    id: eventId,
    store: "PLAY_STORE",
    transferred_from: [crypto.randomUUID()],
    transferred_to: [destination.user.userId],
    type: "TRANSFER" as const,
  };

  expect(
    await processRevenueCatWebhook(getDefaultApiServiceRuntime(), event, {
      env: ENV,
      fetchImpl: providerFetch(subscriptionId),
    }),
  ).toEqual({
    reason:
      "Cancel the organization's web subscription before moving a native subscription",
    status: "ignored",
  });
  const [audit] = await db
    .select({ outcome: revenuecatWebhookEvents.outcome })
    .from(revenuecatWebhookEvents)
    .where(eq(revenuecatWebhookEvents.eventId, eventId));
  expect(audit?.outcome).toBe("ignored");
  expect(
    await processRevenueCatWebhook(getDefaultApiServiceRuntime(), event, {
      env: ENV,
      fetchImpl: providerFetch(subscriptionId),
    }),
  ).toEqual({ status: "duplicate" });
});

test("missing receipts and ambiguous transfer ownership are permanent", async () => {
  const destination = await registerPersonalOrganization();
  const event = {
    environment: "SANDBOX",
    event_timestamp_ms: Date.now(),
    id: crypto.randomUUID(),
    transferred_from: [crypto.randomUUID()],
    transferred_to: [destination.user.userId],
    type: "TRANSFER" as const,
  };
  expect(
    await processRevenueCatWebhook(getDefaultApiServiceRuntime(), event, {
      env: ENV,
      fetchImpl: (async (_input: RequestInfo | URL) =>
        Response.json({ items: [] })) as typeof fetch,
    }),
  ).toEqual({
    reason: "Transferred subscription is not active",
    status: "ignored",
  });
  const [missingAudit] = await db
    .select({ outcome: revenuecatWebhookEvents.outcome })
    .from(revenuecatWebhookEvents)
    .where(eq(revenuecatWebhookEvents.eventId, event.id));
  expect(missingAudit?.outcome).toBe("ignored");

  expect(
    await processRevenueCatWebhook(
      getDefaultApiServiceRuntime(),
      { ...event, id: crypto.randomUUID(), store: "PLAY_STORE" },
      {
        env: ENV,
        fetchImpl: (async (_input: RequestInfo | URL) =>
          Response.json({
            items: [
              {
                environment: "sandbox",
                gives_access: true,
                product_id: "prod_team_5",
                store: "play_store",
                store_subscription_identifier: "GPA.ambiguous-1",
              },
              {
                environment: "sandbox",
                gives_access: true,
                product_id: "prod_team_5",
                store: "play_store",
                store_subscription_identifier: "GPA.ambiguous-2",
              },
            ],
          })) as typeof fetch,
      },
    ),
  ).toEqual({
    reason: "Transferred subscription verification is ambiguous",
    status: "ignored",
  });

  const secondDestination = await registerPersonalOrganization();
  expect(
    await processRevenueCatWebhook(
      getDefaultApiServiceRuntime(),
      {
        ...event,
        id: crypto.randomUUID(),
        transferred_to: [
          destination.user.userId,
          secondDestination.user.userId,
        ],
      },
      { env: ENV, fetchImpl: providerFetch() },
    ),
  ).toEqual({
    reason: "Transfer has more than one registered destination",
    status: "ignored",
  });
});

test("a missing RevenueCat customer retries while transfer data propagates", async () => {
  const destination = await registerPersonalOrganization();
  const event = {
    environment: "SANDBOX",
    event_timestamp_ms: Date.now(),
    id: crypto.randomUUID(),
    store: "PLAY_STORE",
    transferred_from: [crypto.randomUUID()],
    transferred_to: [destination.user.userId],
    type: "TRANSFER" as const,
  };
  expect(
    await processRevenueCatWebhook(getDefaultApiServiceRuntime(), event, {
      env: ENV,
      fetchImpl: (async (_input: RequestInfo | URL) =>
        new Response(null, { status: 404 })) as typeof fetch,
    }),
  ).toEqual({
    reason: "Transferred subscription has not propagated to RevenueCat",
    status: "retry",
  });
  const [audit] = await db
    .select({ id: revenuecatWebhookEvents.id })
    .from(revenuecatWebhookEvents)
    .where(eq(revenuecatWebhookEvents.eventId, event.id));
  expect(audit).toBeUndefined();
});

test("an unconfirmed transfer expires into an audited permanent outcome", async () => {
  const destination = await registerPersonalOrganization();
  const event = {
    environment: "SANDBOX",
    event_timestamp_ms: Date.now() - 2 * 24 * 60 * 60 * 1000,
    id: crypto.randomUUID(),
    store: "PLAY_STORE",
    transferred_from: [crypto.randomUUID()],
    transferred_to: [destination.user.userId],
    type: "TRANSFER" as const,
  };
  expect(
    await processRevenueCatWebhook(getDefaultApiServiceRuntime(), event, {
      env: ENV,
      fetchImpl: providerFetch(`GPA.expired-${event.id}`),
    }),
  ).toEqual({
    reason: "Transfer was not confirmed by an authenticated native claim",
    status: "ignored",
  });
  const [audit] = await db
    .select({ outcome: revenuecatWebhookEvents.outcome })
    .from(revenuecatWebhookEvents)
    .where(eq(revenuecatWebhookEvents.eventId, event.id));
  expect(audit?.outcome).toBe("ignored");
});

test("production ignores Test Store transfers even without a sandbox marker", async () => {
  const destination = await registerPersonalOrganization();
  expect(
    await processRevenueCatWebhook(
      getDefaultApiServiceRuntime(),
      {
        event_timestamp_ms: Date.now(),
        id: crypto.randomUUID(),
        store: "TEST_STORE",
        transferred_from: [crypto.randomUUID()],
        transferred_to: [destination.user.userId],
        type: "TRANSFER",
      },
      {
        env: {
          REVENUECAT_PROJECT_ID: "proj_1",
          REVENUECAT_V2_SECRET_KEY: "sk_test",
        },
        fetchImpl: (async (_input: RequestInfo | URL): Promise<Response> => {
          throw new Error("production Test Store must not reach RevenueCat");
        }) as typeof fetch,
      },
    ),
  ).toEqual({ reason: "Test Store transfer ignored", status: "ignored" });
});
