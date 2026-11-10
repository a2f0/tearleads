import { expect, test } from "bun:test";
import { activeStripePrice } from "../../test/helpers/stripeCatalog";
import {
  STRIPE_PAYLOAD_ENV as ENV,
  recordingStripeFetch as fakeFetch,
  STRIPE_PAYLOAD_PRICE as VALID_TEAM_5_PRICE,
} from "../../test/helpers/stripePayloadFetch";
import { createCheckoutSession } from "./stripeCheckoutSession";

test("createCheckoutSession stamps org metadata onto the subscription", async () => {
  const { fetchImpl, requests } = fakeFetch([
    { body: VALID_TEAM_5_PRICE },
    { body: { id: "cs_1", url: "https://checkout.stripe.com/pay/cs_1" } },
  ]);

  const session = await createCheckoutSession(
    {
      checkoutAttemptId: "attempt-hosted-1",
      customerId: "cus_1",
      expiresAt: new Date("2030-01-01T00:45:00.000Z"),
      userId: "user-1",
      organizationId: "org-1",
      returnUrl: "https://app.example/billing?tab=events",
      seatQuantity: 2,
    },
    { env: ENV, fetchImpl },
  );

  expect(session).toMatchObject({
    id: "cs_1",
    url: "https://checkout.stripe.com/pay/cs_1",
  });
  const body = requests[1]?.body ?? "";
  expect(requests[1]?.url).toContain("/v1/checkout/sessions");
  // Purely org-scoped: an org's attempts collapse onto one session.
  expect(requests[1]?.headers.get("Idempotency-Key")).toBe(
    "checkout-session:org-1:attempt-hosted-1",
  );
  // The return URL is canonicalized (query dropped) so the stable success_url
  // params match the reused org key.
  expect(body).toContain(
    `success_url=${encodeURIComponent("https://app.example/billing")}`,
  );
  expect(body).not.toContain("tab%3Devents");
  expect(body).toContain("mode=subscription");
  expect(body).toContain("customer=cus_1");
  // The subscription MUST carry orgId/userId so the webhook can associate it
  // and findLiveOrgSubscription can later resolve it for cancel/portal.
  expect(body).toContain(
    `${encodeURIComponent("subscription_data[metadata][orgId]")}=org-1`,
  );
  expect(body).toContain(
    `${encodeURIComponent("subscription_data[metadata][userId]")}=user-1`,
  );
  // The Session itself names its attempt, so a later attempt can tell which
  // Sessions it must expire.
  expect(body).toContain(
    `${encodeURIComponent("metadata[checkoutAttemptId]")}=attempt-hosted-1`,
  );
});

test("createCheckoutSession is null without price/secret config", async () => {
  const { fetchImpl, requests } = fakeFetch([]);

  expect(
    await createCheckoutSession(
      {
        checkoutAttemptId: "attempt-hosted-1",
        customerId: "cus_1",
        expiresAt: new Date("2030-01-01T00:45:00.000Z"),
        userId: "user-1",
        organizationId: "org-1",
        returnUrl: "https://app.example/billing",
        seatQuantity: 1,
      },
      { env: {}, fetchImpl },
    ),
  ).toBeNull();
  expect(requests).toHaveLength(0);
});

test("createCheckoutSession passes an unparseable return url through unchanged", async () => {
  const { fetchImpl, requests } = fakeFetch([
    { body: activeStripePrice("price_solo", 500) },
    { body: { id: "cs_2", url: "https://checkout.stripe.com/pay/cs_2" } },
  ]);
  await createCheckoutSession(
    {
      checkoutAttemptId: "attempt-hosted-2",
      customerId: "cus_1",
      expiresAt: new Date("2030-01-01T00:45:00.000Z"),
      userId: "user-1",
      organizationId: "org-1",
      returnUrl: "not a url",
      seatQuantity: 1,
    },
    { env: ENV, fetchImpl },
  );

  // Canonicalization cannot parse it, so it falls back to the raw value rather
  // than throwing (the value is origin-validated upstream anyway).
  // URLSearchParams encodes the space as "+"; the point is the raw value
  // passed through rather than the canonicalizer throwing.
  expect(requests[1]?.body ?? "").toContain("success_url=not+a+url");
});
