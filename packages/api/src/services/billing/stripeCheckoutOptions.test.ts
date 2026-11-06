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

test("options select Team 5 for a two-member effective roster", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticateWithOrganization(admin);
  await addSyntheticMember(admin, organizationId);
  const urls: string[] = [];

  const result = await getStripeCheckoutOptions(
    getDefaultApiServiceRuntime(),
    organizationId,
    admin.userId,
    {
      stripe: {
        env: STRIPE_ENV,
        fetchImpl: respondingFetch(
          [{ body: activeStripePrice("price_team_5", 1_000) }],
          urls,
        ),
      },
      revenueCat: { env: REVENUECAT_ENV },
    },
  );

  expect(result.options).toEqual([
    expect.objectContaining({ tierId: "team_5", seatLimit: 5 }),
  ]);
  expect(urls).toHaveLength(1);
});
