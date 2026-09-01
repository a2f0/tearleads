import { beforeAll, expect, test } from "bun:test";
import { createTestUser } from "@tearleads/bob-and-alice";
import invariant from "invariant";
import {
  postRevenueCatWebhook as postWebhook,
  readOrganizationBilling as readBilling,
  registerAndAuthenticate,
  THIRTY_DAYS_MS,
  REVENUECAT_WEBHOOK_SECRET as WEBHOOK_SECRET,
  revenuecatWebhookBody as webhookBody,
} from "../../../test/helpers/revenuecatWebhook";

const AUTH_ENV_KEY = "REVENUECAT_WEBHOOK_AUTH_HEADER";
const LAPSED_GRACE_MS = 30 * 24 * 60 * 60 * 1000;

beforeAll(() => {
  process.env[AUTH_ENV_KEY] = WEBHOOK_SECRET;
});

async function purchaseForPersonalOrganization() {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  await postWebhook(
    webhookBody({
      appUserId: admin.userId,
      organizationId,
      type: "INITIAL_PURCHASE",
    }),
  );
  return { admin, organizationId };
}

test("an expiration event disables sync and opens the purge grace window", async () => {
  const { admin, organizationId } = await purchaseForPersonalOrganization();
  const response = await postWebhook(
    webhookBody({
      appUserId: admin.userId,
      organizationId,
      type: "EXPIRATION",
    }),
  );
  expect(await response.json()).toEqual({ received: true, outcome: "applied" });

  const billing = await readBilling(organizationId);
  expect(billing.status).toBe("disabled");
  invariant(billing.disabledAt, "expected disabledAt");
  invariant(billing.purgeAfter, "expected purgeAfter");
  expect(billing.purgeAfter.getTime() - billing.disabledAt.getTime()).toBe(
    LAPSED_GRACE_MS,
  );
});

test("a renewal after an expiration re-activates sync and clears the purge window", async () => {
  const { admin, organizationId } = await purchaseForPersonalOrganization();
  await postWebhook(
    webhookBody({
      appUserId: admin.userId,
      organizationId,
      type: "EXPIRATION",
    }),
  );
  const disabled = await readBilling(organizationId);
  expect(disabled.status).toBe("disabled");
  invariant(disabled.disabledAt, "expected disabledAt after expiration");
  invariant(disabled.purgeAfter, "expected purgeAfter after expiration");

  const expirationAtMs = Date.now() + THIRTY_DAYS_MS;
  const response = await postWebhook(
    webhookBody({
      appUserId: admin.userId,
      expirationAtMs,
      organizationId,
      type: "RENEWAL",
    }),
  );
  expect(await response.json()).toEqual({ received: true, outcome: "applied" });

  const reactivated = await readBilling(organizationId);
  expect(reactivated.status).toBe("active");
  expect(reactivated.currentPeriodEndsAt?.getTime()).toBe(expirationAtMs);
  expect(reactivated.disabledAt).toBeNull();
  expect(reactivated.purgeAfter).toBeNull();
});
