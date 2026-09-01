import { expect, spyOn, test } from "bun:test";
import { db } from "@symcrypt/api-shared/postgres";
import {
  organizationBilling,
  revenuecatWebhookEvents,
} from "@symcrypt/api-shared/schema";
import { createTestUser } from "@symcrypt/bob-and-alice";
import type { RevenueCatWebhookEvent } from "@symcrypt/validators/request";
import { eq } from "drizzle-orm";
import { playReplacementApiDeps } from "../../../test/helpers/revenuecatPlayReplacement";
import { registerAndAuthenticate } from "../../../test/helpers/revenuecatWebhook";
import { runRevenueCatWebhookWorkflow } from "./revenuecatWebhook";

const PERIOD_MS = 30 * 24 * 60 * 60 * 1_000;
const NATIVE_BINDING_CONFLICT_REASON =
  "Native event conflicts with an existing native subscription";

function nativeEvent(input: {
  readonly appUserId: string;
  readonly eventTimestamp: number;
  readonly organizationId: string;
  readonly productId?: string;
  readonly subscriptionId: string;
  readonly type?: RevenueCatWebhookEvent["type"];
}): RevenueCatWebhookEvent {
  return {
    app_user_id: input.appUserId,
    entitlement_ids: ["sync"],
    event_timestamp_ms: input.eventTimestamp,
    expiration_at_ms: input.eventTimestamp + PERIOD_MS,
    id: crypto.randomUUID(),
    original_transaction_id: input.subscriptionId,
    product_id: input.productId ?? "sync_solo_monthly",
    purchased_at_ms: input.eventTimestamp,
    store: "PLAY_STORE",
    subscriber_attributes: { orgId: { value: input.organizationId } },
    type: input.type ?? "INITIAL_PURCHASE",
  };
}

test.each([
  "RENEWAL",
  "EXPIRATION",
] as const)("a stale Play replacement-token %s cannot mutate a newer binding", async (type) => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  const now = Date.now();
  const initialToken = `initial_${crypto.randomUUID()}`;
  const oldReplacementToken = `old_replacement_${crypto.randomUUID()}`;
  const currentToken = `current_${crypto.randomUUID()}`;
  const initial = nativeEvent({
    appUserId: admin.userId,
    eventTimestamp: now,
    organizationId,
    subscriptionId: initialToken,
  });
  expect(await runRevenueCatWebhookWorkflow(db, initial)).toMatchObject({
    status: "applied",
  });

  const productChange = {
    ...initial,
    event_timestamp_ms: now + 1,
    id: crypto.randomUUID(),
    new_product_id: "sync_team_5_monthly",
    original_transaction_id: initialToken,
    type: "PRODUCT_CHANGE" as const,
  };
  expect(await runRevenueCatWebhookWorkflow(db, productChange)).toMatchObject({
    status: "applied",
  });
  const [changeAudit] = await db
    .select({
      sourceSubscriptionId: revenuecatWebhookEvents.sourceOriginalTransactionId,
    })
    .from(revenuecatWebhookEvents)
    .where(eq(revenuecatWebhookEvents.eventId, productChange.id));
  expect(changeAudit?.sourceSubscriptionId).toBe(initialToken);

  expect(
    await runRevenueCatWebhookWorkflow(
      db,
      nativeEvent({
        appUserId: admin.userId,
        eventTimestamp: now + 2,
        organizationId,
        productId: "sync_team_5_monthly",
        subscriptionId: oldReplacementToken,
        type: "RENEWAL",
      }),
      undefined,
      {
        revenuecat: playReplacementApiDeps({
          appUserId: admin.userId,
          predecessorSubscriptionId: initialToken,
          productId: "sync_team_5_monthly",
          replacementSubscriptionId: oldReplacementToken,
        }),
      },
    ),
  ).toMatchObject({ status: "applied" });
  expect(
    await runRevenueCatWebhookWorkflow(
      db,
      nativeEvent({
        appUserId: admin.userId,
        eventTimestamp: now + 3,
        organizationId,
        productId: "sync_team_5_monthly",
        subscriptionId: oldReplacementToken,
        type: "EXPIRATION",
      }),
    ),
  ).toMatchObject({ status: "applied" });
  expect(
    await runRevenueCatWebhookWorkflow(
      db,
      nativeEvent({
        appUserId: admin.userId,
        eventTimestamp: now + 4,
        organizationId,
        subscriptionId: currentToken,
      }),
    ),
  ).toMatchObject({ status: "applied" });

  const stale = nativeEvent({
    appUserId: admin.userId,
    eventTimestamp: now + 5,
    organizationId,
    productId: "sync_team_5_monthly",
    subscriptionId: oldReplacementToken,
    type,
  });
  const errorSpy = spyOn(console, "error").mockImplementation(() => undefined);
  try {
    expect(await runRevenueCatWebhookWorkflow(db, stale)).toEqual({
      reason: NATIVE_BINDING_CONFLICT_REASON,
      status: "retry",
    });
  } finally {
    errorSpy.mockRestore();
  }

  const [billing] = await db
    .select({
      providerProductId: organizationBilling.providerProductId,
      providerSubscriptionId: organizationBilling.providerSubscriptionId,
      status: organizationBilling.status,
    })
    .from(organizationBilling)
    .where(eq(organizationBilling.organizationId, organizationId));
  expect(billing).toEqual({
    providerProductId: "sync_solo_monthly",
    providerSubscriptionId: currentToken,
    status: "active",
  });
  const [unclaimed] = await db
    .select({ id: revenuecatWebhookEvents.id })
    .from(revenuecatWebhookEvents)
    .where(eq(revenuecatWebhookEvents.eventId, stale.id));
  expect(unclaimed).toBeUndefined();
});
