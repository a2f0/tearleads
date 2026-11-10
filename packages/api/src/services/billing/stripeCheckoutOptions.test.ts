import { expect, test } from "bun:test";

import { createTestUser } from "@tearleads/test-utils";
import { registerAndAuthenticateWithOrganization } from "../../../test/helpers/registerUser";
import { addSyntheticMember } from "../../../test/helpers/revenuecatWebhook";
import { activeStripePrice } from "../../../test/helpers/stripeCatalog";
import {
  REVENUECAT_WEBHOOK_ENV as REVENUECAT_ENV,
  createRespondingFetch as respondingFetch,
  STRIPE_WEBHOOK_ENV as STRIPE_ENV,
} from "../../../test/helpers/stripeWebhook";
import { getDefaultApiServiceRuntime } from "../runtime";
import { getStripeCheckoutOptions } from "./stripeCheckoutOptions";

test("options stay empty until the WHOLE flow is configured", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticateWithOrganization(admin);
  const urls: string[] = [];
  const result = await getStripeCheckoutOptions(
    getDefaultApiServiceRuntime(),
    organizationId,
    admin.userId,
    {
      stripe: { env: STRIPE_ENV, fetchImpl: respondingFetch([], urls) },
      revenueCat: { env: {} },
    },
  );
  expect(result).toEqual({ options: [] });
  expect(urls).toHaveLength(0);
});

/** Answers each configured Price lookup; `inactive` Prices are retired. */
function catalogFetch(inactive: readonly string[], urls: string[]) {
  const amounts: Record<string, number> = {
    price_sync: 500,
    price_team_5: 1_000,
    price_team_10: 2_000,
  };
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    const priceId = new URL(url).pathname.split("/").at(-1) ?? "";
    const price = activeStripePrice(priceId, amounts[priceId] ?? 0);
    return Response.json(
      inactive.includes(priceId) ? { ...price, active: false } : price,
    );
  }) as typeof fetch;
}

test("options offer every plan that covers the roster, smallest first", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticateWithOrganization(admin);
  await addSyntheticMember(admin, organizationId);
  const urls: string[] = [];

  const result = await getStripeCheckoutOptions(
    getDefaultApiServiceRuntime(),
    organizationId,
    admin.userId,
    {
      stripe: { env: STRIPE_ENV, fetchImpl: catalogFetch([], urls) },
      revenueCat: { env: REVENUECAT_ENV },
    },
  );

  // Two members outgrow Solo; Team 5 and Team 10 both cover them.
  expect(result.options).toEqual([
    expect.objectContaining({ tierId: "team_5", seatLimit: 5 }),
    expect.objectContaining({ tierId: "team_10", seatLimit: 10 }),
  ]);
  expect(urls).toHaveLength(2);
});

test("a plan whose Stripe Price is unusable is left out", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticateWithOrganization(admin);

  const result = await getStripeCheckoutOptions(
    getDefaultApiServiceRuntime(),
    organizationId,
    admin.userId,
    {
      stripe: {
        env: STRIPE_ENV,
        fetchImpl: catalogFetch(["price_team_5"], []),
      },
      revenueCat: { env: REVENUECAT_ENV },
    },
  );

  expect(result.options.map((option) => option.tierId)).toEqual([
    "solo",
    "team_10",
  ]);
});
