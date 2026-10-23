import { expect, test } from "bun:test";
import type { RootRevenuecatEvent } from "@tearleads/client-sdk";
import { render, within } from "@testing-library/react";
import { RevenuecatDeliveries } from "./RevenuecatDeliveries";

const delivery: RootRevenuecatEvent = {
  appUserId: "buyer",
  createdAt: "2026-10-22T12:00:01.000Z",
  currency: "KWD",
  environment: "PRODUCTION",
  eventId: "evt-kwd",
  eventTimestamp: "2026-10-22T12:00:00.000Z",
  eventType: "INITIAL_PURCHASE",
  expirationAt: null,
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  organizationId: null,
  originalTransactionId: null,
  outcome: "applied",
  periodType: "NORMAL",
  priceInPurchasedCurrencyMinor: 4999,
  productId: null,
  purchasedAt: null,
  sourceOrganizationId: null,
  store: "APP_STORE",
  transactionId: null,
};

test("a store price uses the currency's ISO minor unit, as RevenueCat reports it", () => {
  const view = render(
    <RevenuecatDeliveries
      deliveries={[delivery]}
      onSelectIdentity={() => undefined}
    />,
  );
  const facts = view.getByRole("table", {
    name: "RevenueCat delivery evt-kwd",
  });
  // KWD has three decimals; Stripe's two-decimal convention would show 49.99.
  expect(within(facts).getByText(/4\.999/)).toBeTruthy();
  expect(within(facts).queryByText(/49\.99/)).toBeNull();
});
