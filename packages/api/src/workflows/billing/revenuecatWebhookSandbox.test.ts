import { expect, spyOn, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  organizationBilling,
  revenuecatWebhookEvents,
  users,
} from "@tearleads/api-shared/schema";
import { createTestUser, type TestUser } from "@tearleads/bob-and-alice";
import type { RevenueCatWebhookEvent } from "@tearleads/validators/request";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { registerUser } from "../../../test/helpers/registerUser";
import { runGetOrganizationBillingWorkflow } from "./organizationBilling";
import { runRevenueCatWebhookWorkflow } from "./revenuecatWebhook";

/** Covers the native-store sandbox lane used by mobile billing tests. */

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

async function registerOrganizationAdmin(): Promise<{
  organizationId: string;
  user: TestUser;
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

function appStorePurchase(input: {
  readonly appUserId: string;
  readonly environment?: string;
  readonly eventId: string;
  readonly organizationId: string;
  readonly store?: string;
}): RevenueCatWebhookEvent {
  const now = Date.now();
  return {
    app_user_id: input.appUserId,
    entitlement_ids: ["sync"],
    event_timestamp_ms: now,
    expiration_at_ms: now + THIRTY_DAYS_MS,
    id: input.eventId,
    original_transaction_id: input.eventId,
    product_id: "sync_solo_monthly",
    purchased_at_ms: now,
    store: input.store ?? "APP_STORE",
    // A native store purchase carries no transaction metadata, so the org is
    // bound through the subscriber attribute the client sets before buying.
    subscriber_attributes: { orgId: { value: input.organizationId } },
    type: "INITIAL_PURCHASE",
    ...(input.environment === undefined
      ? {}
      : { environment: input.environment }),
  };
}

async function readBillingStatus(organizationId: string) {
  const [billing] = await db
    .select({
      providerCustomerId: organizationBilling.providerCustomerId,
      providerProductId: organizationBilling.providerProductId,
      providerSubscriptionId: organizationBilling.providerSubscriptionId,
      seatCount: organizationBilling.seatCount,
      status: organizationBilling.status,
    })
    .from(organizationBilling)
    .where(eq(organizationBilling.organizationId, organizationId));
  invariant(billing, "expected organization billing");
  return billing;
}

async function readEventOutcome(eventId: string): Promise<string | undefined> {
  const [claimed] = await db
    .select({ outcome: revenuecatWebhookEvents.outcome })
    .from(revenuecatWebhookEvents)
    .where(eq(revenuecatWebhookEvents.eventId, eventId));
  return claimed?.outcome;
}

test("a sandbox store purchase does not activate sync on a production tier", async () => {
  const { organizationId, user } = await registerOrganizationAdmin();
  const eventId = crypto.randomUUID();

  const outcome = await runRevenueCatWebhookWorkflow(
    db,
    appStorePurchase({
      appUserId: user.userId,
      environment: "SANDBOX",
      eventId,
      organizationId,
    }),
    new Date(),
    { env: {} },
  );

  expect(outcome).toEqual({
    status: "ignored",
    reason: "Sandbox environment event ignored on a production-only tier",
  });
  expect(await readBillingStatus(organizationId)).toMatchObject({
    providerCustomerId: null,
  });
});

test("a sandbox event is still claimed so RevenueCat stops redelivering it", async () => {
  const { organizationId, user } = await registerOrganizationAdmin();
  const eventId = crypto.randomUUID();
  const event = appStorePurchase({
    appUserId: user.userId,
    environment: "SANDBOX",
    eventId,
    organizationId,
  });

  await runRevenueCatWebhookWorkflow(db, event, new Date(), { env: {} });

  // Recorded and acknowledged rather than dropped: an unclaimed event would be
  // retried by RevenueCat forever, and an unrecorded one leaves no audit trail
  // of a tester's purchase reaching production.
  expect(await readEventOutcome(eventId)).toBe("ignored");

  const redelivered = await runRevenueCatWebhookWorkflow(
    db,
    event,
    new Date(),
    { env: {} },
  );
  expect(redelivered).toEqual({ status: "duplicate" });
});

test("a sandbox store purchase activates sync on a tier that opts in", async () => {
  const { organizationId, user } = await registerOrganizationAdmin();

  const outcome = await runRevenueCatWebhookWorkflow(
    db,
    appStorePurchase({
      appUserId: user.userId,
      environment: "SANDBOX",
      eventId: crypto.randomUUID(),
      organizationId,
    }),
    new Date(),
    { env: { REVENUECAT_ALLOW_SANDBOX_EVENTS: "true" } },
  );

  expect(outcome).toEqual({
    billingStatus: "active",
    organizationId,
    status: "applied",
  });
  expect(await readBillingStatus(organizationId)).toMatchObject({
    providerCustomerId: user.userId,
    status: "active",
  });
});

test("a verified native binding accepts a delayed initial event outside the default organization", async () => {
  const { organizationId, user } = await registerOrganizationAdmin();
  const eventId = crypto.randomUUID();
  const replacement = await registerOrganizationAdmin();
  await db
    .update(users)
    .set({ defaultOrganizationId: replacement.organizationId })
    .where(eq(users.id, user.userId));
  await db
    .update(organizationBilling)
    .set({
      provider: "revenuecat",
      providerCustomerId: user.userId,
      providerProductId: "sync_solo_monthly",
      providerSubscriptionId: eventId,
      seatCount: 1,
      status: "active",
    })
    .where(eq(organizationBilling.organizationId, organizationId));
  await db.insert(revenuecatWebhookEvents).values({
    appUserId: user.userId,
    eventId: crypto.randomUUID(),
    eventTimestamp: new Date(0),
    eventType: "INITIAL_PURCHASE",
    organizationId,
    originalTransactionId: eventId,
    outcome: "applied",
    productId: "sync_solo_monthly",
    store: "TEST_STORE",
  });

  const outcome = await runRevenueCatWebhookWorkflow(
    db,
    appStorePurchase({
      appUserId: user.userId,
      environment: "SANDBOX",
      eventId,
      organizationId,
      store: "TEST_STORE",
    }),
    new Date(),
    { env: { REVENUECAT_ALLOW_SANDBOX_EVENTS: "true" } },
  );

  expect(outcome).toEqual({
    billingStatus: "active",
    organizationId,
    status: "applied",
  });
});

test("an unknown paid native product is retried with an operator alert", async () => {
  const { organizationId, user } = await registerOrganizationAdmin();
  const eventId = crypto.randomUUID();
  const errorSpy = spyOn(console, "error").mockImplementation(() => undefined);
  try {
    const outcome = await runRevenueCatWebhookWorkflow(db, {
      ...appStorePurchase({
        appUserId: user.userId,
        environment: "PRODUCTION",
        eventId,
        organizationId,
      }),
      product_id: "sync_unmapped_monthly",
    });

    expect(outcome).toEqual({
      status: "retry",
      reason: "Event product is not a configured sync billing tier",
    });
    expect(errorSpy).toHaveBeenCalledWith(
      `RevenueCat paid grant ${eventId} was not applied: Event product is not a configured sync billing tier`,
    );
  } finally {
    errorSpy.mockRestore();
  }
});

test("a production store purchase still activates sync", async () => {
  const { organizationId, user } = await registerOrganizationAdmin();

  const outcome = await runRevenueCatWebhookWorkflow(
    db,
    appStorePurchase({
      appUserId: user.userId,
      environment: "PRODUCTION",
      eventId: crypto.randomUUID(),
      organizationId,
    }),
    new Date(),
    { env: {} },
  );

  expect(outcome).toEqual({
    billingStatus: "active",
    organizationId,
    status: "applied",
  });
});

test("a bound native renewal survives a buyer default-organization change", async () => {
  const { organizationId, user } = await registerOrganizationAdmin();
  const initial = appStorePurchase({
    appUserId: user.userId,
    environment: "PRODUCTION",
    eventId: crypto.randomUUID(),
    organizationId,
  });
  expect(await runRevenueCatWebhookWorkflow(db, initial)).toMatchObject({
    organizationId,
    status: "applied",
  });
  const replacement = await registerOrganizationAdmin();
  await db
    .update(users)
    .set({ defaultOrganizationId: replacement.organizationId })
    .where(eq(users.id, user.userId));

  const outcome = await runRevenueCatWebhookWorkflow(db, {
    ...initial,
    event_timestamp_ms: initial.event_timestamp_ms + 1,
    expiration_at_ms: (initial.expiration_at_ms ?? 0) + THIRTY_DAYS_MS,
    id: crypto.randomUUID(),
    type: "RENEWAL",
  });

  expect(outcome).toMatchObject({ organizationId, status: "applied" });
  expect(await readBillingStatus(organizationId)).toMatchObject({
    providerCustomerId: user.userId,
    status: "active",
  });
});

test("a native product change stays pending until its effective event", async () => {
  const { organizationId, user } = await registerOrganizationAdmin();
  const initial = appStorePurchase({
    appUserId: user.userId,
    environment: "PRODUCTION",
    eventId: crypto.randomUUID(),
    organizationId,
  });
  expect(await runRevenueCatWebhookWorkflow(db, initial)).toMatchObject({
    organizationId,
    status: "applied",
  });

  const outcome = await runRevenueCatWebhookWorkflow(db, {
    ...initial,
    event_timestamp_ms: initial.event_timestamp_ms + 1,
    id: crypto.randomUUID(),
    new_product_id: "sync_team_5_monthly",
    type: "PRODUCT_CHANGE",
  });

  expect(outcome).toMatchObject({ organizationId, status: "applied" });
  expect(await readBillingStatus(organizationId)).toMatchObject({
    providerProductId: "sync_solo_monthly",
    seatCount: 1,
  });
  expect(
    (await runGetOrganizationBillingWorkflow(db, organizationId, user.userId))
      .pendingSeatCount,
  ).toBe(5);
});

test("bound lifecycle grants reuse the immutable native tier", async () => {
  const { organizationId, user } = await registerOrganizationAdmin();
  const initial = appStorePurchase({
    appUserId: user.userId,
    environment: "PRODUCTION",
    eventId: crypto.randomUUID(),
    organizationId,
  });
  await runRevenueCatWebhookWorkflow(db, initial);

  const types = [
    "UNCANCELLATION",
    "SUBSCRIPTION_EXTENDED",
    "TEMPORARY_ENTITLEMENT_GRANT",
  ];
  const lifecycleEvent = { ...initial };
  delete lifecycleEvent.original_transaction_id;
  delete lifecycleEvent.product_id;
  for (const [index, type] of types.entries()) {
    const outcome = await runRevenueCatWebhookWorkflow(db, {
      ...lifecycleEvent,
      event_timestamp_ms: initial.event_timestamp_ms + index + 1,
      id: crypto.randomUUID(),
      type,
    });
    expect(outcome).toMatchObject({ organizationId, status: "applied" });
    expect(await readBillingStatus(organizationId)).toMatchObject({
      providerProductId: "sync_solo_monthly",
      providerSubscriptionId: initial.original_transaction_id,
      seatCount: 1,
    });
  }
});

test("unknown and missing stores require the personal-organization policy", async () => {
  const { organizationId, user } = await registerOrganizationAdmin();
  const replacement = await registerOrganizationAdmin();
  await db
    .update(users)
    .set({ defaultOrganizationId: replacement.organizationId })
    .where(eq(users.id, user.userId));

  for (const store of ["UNKNOWN_STORE", undefined]) {
    const event = appStorePurchase({
      appUserId: user.userId,
      environment: "PRODUCTION",
      eventId: crypto.randomUUID(),
      organizationId,
      ...(store ? { store } : {}),
    });
    if (store === undefined) {
      delete event.store;
    }
    const outcome = await runRevenueCatWebhookWorkflow(db, event);

    expect(outcome).toEqual({
      reason:
        "Native purchases may only fund the buyer's personal organization",
      status: "ignored",
    });
  }
});

test("an anonymous native buyer id is claimed without reaching the UUID query", async () => {
  const { organizationId } = await registerOrganizationAdmin();
  const eventId = crypto.randomUUID();

  const outcome = await runRevenueCatWebhookWorkflow(
    db,
    appStorePurchase({
      appUserId: "$RCAnonymousID:anonymous-buyer",
      environment: "PRODUCTION",
      eventId,
      organizationId,
    }),
    new Date(),
    { env: {} },
  );

  expect(outcome).toEqual({
    status: "ignored",
    reason: "Native purchase buyer is not a Tearleads user",
  });
  expect(await readEventOutcome(eventId)).toBe("ignored");
});

test("a store purchase with no environment is treated as production", async () => {
  const { organizationId, user } = await registerOrganizationAdmin();

  const outcome = await runRevenueCatWebhookWorkflow(
    db,
    appStorePurchase({
      appUserId: user.userId,
      eventId: crypto.randomUUID(),
      organizationId,
    }),
    new Date(),
    { env: {} },
  );

  // RevenueCat has not always sent the field; a redelivered old event must keep
  // its original paid meaning rather than being discarded.
  expect(outcome).toEqual({
    billingStatus: "active",
    organizationId,
    status: "applied",
  });
});

test("an ordinary production ignore does not warn as a sandbox drop", async () => {
  const { organizationId, user } = await registerOrganizationAdmin();
  const warnings: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };

  try {
    // CANCELLATION only turns off auto-renew, so it is ignored — routine live
    // traffic that happens to carry an environment. Warning on every such event
    // would drown the signal the sandbox log exists to provide.
    const outcome = await runRevenueCatWebhookWorkflow(
      db,
      {
        ...appStorePurchase({
          appUserId: user.userId,
          environment: "PRODUCTION",
          eventId: crypto.randomUUID(),
          organizationId,
        }),
        type: "CANCELLATION",
      },
      new Date(),
      { env: {} },
    );
    expect(outcome.status).toBe("ignored");
    expect(warnings).toEqual([]);
  } finally {
    console.warn = originalWarn;
  }
});

test("an ignored sandbox event is logged so the drop is visible", async () => {
  const { organizationId, user } = await registerOrganizationAdmin();
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  };

  try {
    await runRevenueCatWebhookWorkflow(
      db,
      appStorePurchase({
        appUserId: user.userId,
        environment: "SANDBOX",
        eventId: crypto.randomUUID(),
        organizationId,
      }),
      new Date(),
      { env: {} },
    );
  } finally {
    console.warn = originalWarn;
  }

  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toContain("SANDBOX");
  expect(warnings[0]).toContain("APP_STORE");
});
