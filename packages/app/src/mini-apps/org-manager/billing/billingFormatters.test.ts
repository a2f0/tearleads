import { afterEach, expect, test } from "bun:test";
import type { OrganizationBillingHistoryEntry } from "@tearleads/client-sdk";
import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { BillingHistory } from "./BillingHistory";

afterEach(() => cleanup());

function entry(
  overrides: Partial<OrganizationBillingHistoryEntry>,
): OrganizationBillingHistoryEntry {
  return {
    activeSeatCount: null,
    billingReason: null,
    category: "lifecycle",
    currency: null,
    environment: null,
    eventType: "INITIAL_PURCHASE",
    id: "history-entry",
    interval: null,
    intervalCount: null,
    invoiceId: null,
    occurredAt: "2026-07-01T12:00:00.000Z",
    outcome: "applied",
    periodEndsAt: null,
    periodStartsAt: null,
    priceId: null,
    productId: null,
    provider: "revenuecat",
    seatCount: null,
    seatDelta: null,
    subscriptionId: null,
    totalAmount: null,
    totalCurrency: null,
    transactionId: null,
    unitAmount: null,
    ...overrides,
  };
}

test("a production native charge shows RevenueCat's purchased-currency total", () => {
  const view = render(
    createElement(BillingHistory, {
      entries: [
        entry({
          currency: "usd",
          environment: "production",
          eventType: "RENEWAL",
          id: "production-renewal",
          interval: "month",
          intervalCount: 1,
          seatCount: 10,
          totalAmount: 1_999,
          totalCurrency: "EUR",
          unitAmount: 2_000,
        }),
      ],
      error: null,
      loading: false,
    }),
  );

  expect(view.getByText("Paid: €19.99")).toBeDefined();
  expect(view.getByText("USD list price: $20.00/month")).toBeDefined();
});

test("a sandbox native charge is identified without implying real payment", () => {
  const view = render(
    createElement(BillingHistory, {
      entries: [
        entry({
          environment: "sandbox",
          eventType: "INITIAL_PURCHASE",
          id: "sandbox-purchase",
        }),
      ],
      error: null,
      loading: false,
    }),
  );

  expect(view.getByText("Sandbox transaction — no real charge")).toBeDefined();
  expect(view.queryByText("Paid total unavailable")).toBeNull();
});
