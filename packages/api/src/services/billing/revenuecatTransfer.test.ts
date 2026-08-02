import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { organizationBilling, users } from "@tearleads/api-shared/schema";
import { createTestUser, type TestUser } from "@tearleads/bob-and-alice";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { registerUser } from "../../../test/helpers/registerUser";
import { getDefaultApiServiceRuntime } from "../runtime";
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

function providerFetch() {
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
          store_subscription_identifier: "GPA.transfer-webhook",
        },
      ],
    });
  }) as typeof fetch;
}

test("a RevenueCat transfer webhook moves native billing to its registered destination", async () => {
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

  expect(
    await processRevenueCatWebhook(getDefaultApiServiceRuntime(), event, {
      env: ENV,
      fetchImpl: providerFetch(),
    }),
  ).toEqual({
    billingStatus: "active",
    organizationId: destination.organizationId,
    status: "applied",
  });
  expect(
    await processRevenueCatWebhook(getDefaultApiServiceRuntime(), event, {
      env: ENV,
      fetchImpl: providerFetch(),
    }),
  ).toEqual({ status: "duplicate" });

  const [oldBilling] = await db
    .select({ status: organizationBilling.status })
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

  expect(
    await processRevenueCatWebhook(getDefaultApiServiceRuntime(), event, {
      env: ENV,
      fetchImpl,
    }),
  ).toEqual({
    billingStatus: "active",
    organizationId: destination.organizationId,
    status: "applied",
  });
});
