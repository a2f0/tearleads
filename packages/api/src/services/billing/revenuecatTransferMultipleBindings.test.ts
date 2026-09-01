import { expect, test } from "bun:test";
import { db } from "@symcrypt/api-shared/postgres";
import {
  organizationBilling,
  revenuecatWebhookEvents,
  users,
} from "@symcrypt/api-shared/schema";
import { createTestUser } from "@symcrypt/bob-and-alice";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { createOrganizationRequestBody } from "../../../test/helpers/api";
import { registerUser } from "../../../test/helpers/registerUser";
import { runCreateOrganizationWorkflow } from "../../workflows/organizations/createOrganization";
import { getDefaultApiServiceRuntime } from "../runtime";
import { claimNativeOrganizationSubscription } from "./organizationBilling";
import { processRevenueCatWebhook } from "./revenuecatWebhook";

const ENV = {
  REVENUECAT_ALLOW_SANDBOX_EVENTS: "true",
  REVENUECAT_PROJECT_ID: "proj_1",
  REVENUECAT_V2_SECRET_KEY: "sk_test",
} as NodeJS.ProcessEnv;

function providerFetch(subscriptionId: string): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    if (String(input).includes("/products/")) {
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

test("a store-specific transfer selects its exact binding for a multi-store buyer", async () => {
  const user = createTestUser();
  const appleSubscriptionId = `apple-${crypto.randomUUID()}`;
  const playSubscriptionId = `GPA.play-${crypto.randomUUID()}`;
  await registerUser(user);
  const [registered] = await db
    .select({ organizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, user.userId));
  invariant(registered, "expected registered user");
  const request = await createOrganizationRequestBody(user);
  const restored = await runCreateOrganizationWorkflow(db, request);

  await db
    .update(organizationBilling)
    .set({
      provider: "revenuecat",
      providerCustomerId: user.userId,
      providerProductId: "com.symcrypt.sync.monthly",
      providerSubscriptionId: appleSubscriptionId,
      seatCount: 1,
      status: "active",
    })
    .where(eq(organizationBilling.organizationId, registered.organizationId));
  await db
    .update(organizationBilling)
    .set({
      provider: "revenuecat",
      providerCustomerId: user.userId,
      providerProductId: "sync_team_5_monthly:monthly",
      providerSubscriptionId: playSubscriptionId,
      seatCount: 5,
      status: "active",
    })
    .where(eq(organizationBilling.organizationId, restored.organizationId));

  const outcome = await processRevenueCatWebhook(
    getDefaultApiServiceRuntime(),
    {
      environment: "SANDBOX",
      event_timestamp_ms: Date.now(),
      id: crypto.randomUUID(),
      store: "PLAY_STORE",
      transferred_from: [crypto.randomUUID()],
      transferred_to: [user.userId],
      type: "TRANSFER",
    },
    {
      env: ENV,
      fetchImpl: providerFetch(playSubscriptionId),
    },
  );

  expect(outcome).toEqual({
    billingStatus: "active",
    organizationId: restored.organizationId,
    status: "applied",
  });
  const rows = await db
    .select({
      organizationId: organizationBilling.organizationId,
      subscriptionId: organizationBilling.providerSubscriptionId,
    })
    .from(organizationBilling)
    .where(eq(organizationBilling.providerCustomerId, user.userId));
  expect(rows).toEqual(
    expect.arrayContaining([
      {
        organizationId: registered.organizationId,
        subscriptionId: appleSubscriptionId,
      },
      {
        organizationId: restored.organizationId,
        subscriptionId: playSubscriptionId,
      },
    ]),
  );
});

test("a pre-claim transfer retries across multiple retained bindings", async () => {
  const user = createTestUser();
  const firstSubscriptionId = `apple-${crypto.randomUUID()}`;
  const secondSubscriptionId = `GPA.play-${crypto.randomUUID()}`;
  const transferredSubscriptionId = `GPA.transferred-${crypto.randomUUID()}`;
  await registerUser(user);
  const [registered] = await db
    .select({ organizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, user.userId));
  invariant(registered, "expected registered user");
  const secondOrganization = await runCreateOrganizationWorkflow(
    db,
    await createOrganizationRequestBody(user),
  );
  const restoreOrganization = await runCreateOrganizationWorkflow(
    db,
    await createOrganizationRequestBody(user),
  );
  await db
    .update(organizationBilling)
    .set({ nativeRestoreUserId: user.userId })
    .where(
      eq(
        organizationBilling.organizationId,
        restoreOrganization.organizationId,
      ),
    );
  await db
    .update(organizationBilling)
    .set({
      provider: "revenuecat",
      providerCustomerId: user.userId,
      providerProductId: "com.symcrypt.sync.monthly",
      providerSubscriptionId: firstSubscriptionId,
      seatCount: 1,
      status: "active",
    })
    .where(eq(organizationBilling.organizationId, registered.organizationId));
  await db
    .update(organizationBilling)
    .set({
      provider: "revenuecat",
      providerCustomerId: user.userId,
      providerProductId: "sync_team_5_monthly:monthly",
      providerSubscriptionId: secondSubscriptionId,
      seatCount: 5,
      status: "active",
    })
    .where(
      eq(organizationBilling.organizationId, secondOrganization.organizationId),
    );
  const event = {
    environment: "SANDBOX",
    event_timestamp_ms: Date.now(),
    id: crypto.randomUUID(),
    store: "PLAY_STORE",
    transferred_from: [crypto.randomUUID()],
    transferred_to: [user.userId],
    type: "TRANSFER" as const,
  };
  const runtime = getDefaultApiServiceRuntime();
  const deps = {
    env: ENV,
    fetchImpl: providerFetch(transferredSubscriptionId),
  };

  expect(await processRevenueCatWebhook(runtime, event, deps)).toEqual({
    reason: "Transfer subscription destination is ambiguous",
    status: "retry",
  });
  const [prematureAudit] = await db
    .select({ id: revenuecatWebhookEvents.id })
    .from(revenuecatWebhookEvents)
    .where(eq(revenuecatWebhookEvents.eventId, event.id));
  expect(prematureAudit).toBeUndefined();

  await claimNativeOrganizationSubscription(
    runtime,
    restoreOrganization.organizationId,
    user.userId,
    "play_store",
    deps,
  );
  expect(await processRevenueCatWebhook(runtime, event, deps)).toEqual({
    billingStatus: "active",
    organizationId: restoreOrganization.organizationId,
    status: "applied",
  });
});
