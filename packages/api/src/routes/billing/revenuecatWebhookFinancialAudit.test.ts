import { beforeAll, expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { revenuecatWebhookEvents } from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { eq } from "drizzle-orm";
import { setTestOrganizationBillingLocal } from "../../../test/helpers/organizationBilling";
import {
  postRevenueCatWebhook,
  REVENUECAT_WEBHOOK_SECRET,
  registerAndAuthenticate,
  revenuecatWebhookBody,
} from "../../../test/helpers/revenuecatWebhook";

const AUTH_ENV_KEY = "REVENUECAT_WEBHOOK_AUTH_HEADER";

beforeAll(() => {
  process.env[AUTH_ENV_KEY] = REVENUECAT_WEBHOOK_SECRET;
});

test("a native purchase persists RevenueCat financial audit facts", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  await setTestOrganizationBillingLocal(organizationId);
  const eventId = crypto.randomUUID();

  const response = await postRevenueCatWebhook(
    revenuecatWebhookBody({
      appUserId: admin.userId,
      currency: "USD",
      environment: "PRODUCTION",
      eventId,
      organizationId,
      periodType: "NORMAL",
      priceInPurchasedCurrency: 4.99,
      store: "APP_STORE",
      transactionId: "financial-audit-transaction",
      type: "INITIAL_PURCHASE",
    }),
  );
  expect(await response.json()).toEqual({ received: true, outcome: "applied" });

  const [audit] = await db
    .select({
      currency: revenuecatWebhookEvents.currency,
      environment: revenuecatWebhookEvents.environment,
      periodType: revenuecatWebhookEvents.periodType,
      priceInPurchasedCurrencyMinor:
        revenuecatWebhookEvents.priceInPurchasedCurrencyMinor,
    })
    .from(revenuecatWebhookEvents)
    .where(eq(revenuecatWebhookEvents.eventId, eventId));
  expect(audit).toEqual({
    currency: "USD",
    environment: "PRODUCTION",
    periodType: "NORMAL",
    priceInPurchasedCurrencyMinor: 499,
  });
});
