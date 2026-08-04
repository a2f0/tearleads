import { afterEach, expect, test } from "bun:test";
import type { OrganizationBillingHistoryEntry } from "@tearleads/client-sdk";
import { cleanup, fireEvent, render } from "@testing-library/react";
import {
  formatMiniAppDate,
  formatMiniAppDateTime,
} from "../../../utils/formatMiniAppDate";
import { ORG_MANAGER_LABELS } from "../labels";
import { BillingHistory } from "./BillingHistory";

afterEach(() => cleanup());

function entry(
  overrides: Partial<OrganizationBillingHistoryEntry>,
): OrganizationBillingHistoryEntry {
  return {
    id: "history-entry",
    category: "lifecycle",
    provider: "revenuecat",
    eventType: "INITIAL_PURCHASE",
    outcome: "applied",
    occurredAt: "2026-07-01T12:00:00.000Z",
    productId: null,
    transactionId: null,
    invoiceId: null,
    subscriptionId: null,
    billingReason: null,
    seatCount: null,
    seatDelta: null,
    activeSeatCount: null,
    priceId: null,
    unitAmount: null,
    currency: null,
    interval: null,
    intervalCount: null,
    totalAmount: null,
    periodStartsAt: null,
    periodEndsAt: null,
    ...overrides,
  };
}

const ENTRIES: ReadonlyArray<OrganizationBillingHistoryEntry> = [
  entry({
    id: "renewal",
    eventType: "RENEWAL",
    occurredAt: "2026-07-10T12:00:00.000Z",
    productId: "sync_monthly",
    transactionId: "transaction-2",
  }),
  entry({
    id: "ignored-cancellation",
    eventType: "CANCELLATION",
    outcome: "ignored",
    occurredAt: "2026-07-05T12:00:00.000Z",
  }),
  entry({
    id: "initial-purchase",
    eventType: "INITIAL_PURCHASE",
    occurredAt: "2026-07-01T12:00:00.000Z",
    productId: "sync_monthly",
    transactionId: "transaction-1",
  }),
];

test("renders both tabs with the activity tab selected", () => {
  const view = render(
    <BillingHistory entries={ENTRIES} error={null} loading={false} />,
  );
  const activityTab = view.getByRole("tab", {
    name: ORG_MANAGER_LABELS.billingHistoryActivityTab,
  });
  const eventsTab = view.getByRole("tab", {
    name: ORG_MANAGER_LABELS.billingHistoryEventsTab,
  });
  expect(activityTab.getAttribute("aria-selected")).toBe("true");
  expect(eventsTab.getAttribute("aria-selected")).toBe("false");
});

test("the activity tab shows friendly labels for applied events only", () => {
  const view = render(
    <BillingHistory entries={ENTRIES} error={null} loading={false} />,
  );
  expect(view.getByText("Renewed")).toBeDefined();
  expect(view.getByText("Subscription started")).toBeDefined();
  expect(
    view.getByText(formatMiniAppDateTime("2026-07-10T12:00:00.000Z")),
  ).toBeDefined();
  // The ignored cancellation changed nothing, so it is not activity.
  expect(view.queryByText("Cancellation scheduled")).toBeNull();
  // Raw event types belong to the events tab.
  expect(view.queryByText("RENEWAL")).toBeNull();
  expect(view.queryByText("INITIAL_PURCHASE")).toBeNull();
});

test("switching to the events tab shows every raw event and its outcome", () => {
  const view = render(
    <BillingHistory entries={ENTRIES} error={null} loading={false} />,
  );
  fireEvent.click(
    view.getByRole("tab", {
      name: ORG_MANAGER_LABELS.billingHistoryEventsTab,
    }),
  );
  expect(
    view
      .getByRole("tab", { name: ORG_MANAGER_LABELS.billingHistoryEventsTab })
      .getAttribute("aria-selected"),
  ).toBe("true");
  expect(view.getByText("RENEWAL")).toBeDefined();
  expect(view.getByText("CANCELLATION")).toBeDefined();
  expect(view.getByText("INITIAL_PURCHASE")).toBeDefined();
  expect(view.getAllByText("Outcome: applied")).toHaveLength(2);
  expect(view.getAllByText("Outcome: ignored")).toHaveLength(1);
  expect(view.getAllByText("Provider: RevenueCat")).toHaveLength(3);
  expect(
    view.getByText(formatMiniAppDateTime("2026-07-05T12:00:00.000Z")),
  ).toBeDefined();
  // Friendly labels belong to the activity tab.
  expect(view.queryByText("Renewed")).toBeNull();

  // Switching back restores the friendly activity view.
  fireEvent.click(
    view.getByRole("tab", {
      name: ORG_MANAGER_LABELS.billingHistoryActivityTab,
    }),
  );
  expect(view.getByText("Renewed")).toBeDefined();
  expect(view.queryByText("RENEWAL")).toBeNull();
});

test("an unknown event type falls back to a title-cased label", () => {
  const view = render(
    <BillingHistory
      entries={[entry({ eventType: "BILLING_ISSUE" })]}
      error={null}
      loading={false}
    />,
  );
  expect(view.getByText("Billing issue")).toBeDefined();
});

test("activity reports licensed seats, rate, and the exact provider-paid total", () => {
  const view = render(
    <BillingHistory
      entries={[
        entry({
          id: "invoice-in_123",
          category: "invoice",
          provider: "stripe",
          eventType: "INVOICE_PAID",
          occurredAt: "2026-07-20T12:00:00.000Z",
          invoiceId: "in_123",
          subscriptionId: "sub_123",
          billingReason: "subscription_cycle",
          seatCount: 3,
          priceId: "price_monthly",
          unitAmount: 499,
          currency: "usd",
          interval: "month",
          intervalCount: 1,
          // The provider's prorated total is authoritative. 3 x $4.99 would
          // be $14.97, so the UI must not derive or replace this value.
          totalAmount: 842,
          periodStartsAt: "2026-07-20T12:00:00.000Z",
          periodEndsAt: "2026-08-01T12:00:00.000Z",
        }),
      ]}
      error={null}
      loading={false}
    />,
  );

  expect(view.getByText("Invoice paid")).toBeDefined();
  expect(view.getByText("3 licensed seats")).toBeDefined();
  expect(view.getByText("Plan price: $4.99/month")).toBeDefined();
  expect(view.getByText("Paid: $8.42")).toBeDefined();
  expect(view.getByText("Invoice reason: Subscription renewal")).toBeDefined();
  expect(view.queryByText(/14\.97/)).toBeNull();
  expect(
    view.getByText(formatMiniAppDateTime("2026-07-20T12:00:00.000Z")),
  ).toBeDefined();
});

test("activity reports signed seat changes and active assignments", () => {
  const view = render(
    <BillingHistory
      entries={[
        entry({
          id: "seat-change-1",
          category: "seat",
          provider: "internal",
          eventType: "licensed_seat_count_increased",
          seatCount: 3,
          seatDelta: 2,
          activeSeatCount: 2,
        }),
      ]}
      error={null}
      loading={false}
    />,
  );

  expect(view.getByText("Licensed seats increased")).toBeDefined();
  expect(view.getByText("3 licensed seats")).toBeDefined();
  expect(view.getByText("Licensed seat change: +2")).toBeDefined();
  expect(view.getByText("2 active seat assignments")).toBeDefined();
  expect(view.getByText("Cost unavailable for this seat event")).toBeDefined();
});

test("a lifecycle seat snapshot names unavailable cost data", () => {
  const view = render(
    <BillingHistory
      entries={[entry({ id: "renewal-seats", seatCount: 4 })]}
      error={null}
      loading={false}
    />,
  );

  expect(view.getByText("4 licensed seats")).toBeDefined();
  expect(view.getByText("Plan price unavailable for this event")).toBeDefined();
});

test("free-trial lifecycle activity explains capacity, cost, and expiration", () => {
  const periodStartsAt = "2026-07-01T12:00:00.000Z";
  const periodEndsAt = "2026-07-08T12:00:00.000Z";
  const view = render(
    <BillingHistory
      entries={[
        entry({
          activeSeatCount: 0,
          eventType: "free_trial_expired",
          id: "trial-expired",
          occurredAt: periodEndsAt,
          periodEndsAt,
          periodStartsAt,
          provider: "internal",
          seatCount: 0,
          seatDelta: -10,
        }),
        entry({
          activeSeatCount: 1,
          eventType: "free_trial_initialized",
          id: "trial-initialized",
          periodEndsAt,
          periodStartsAt,
          provider: "internal",
          seatCount: 10,
          seatDelta: 10,
        }),
      ]}
      error={null}
      loading={false}
    />,
  );

  expect(view.getByText("Free trial initialized")).toBeDefined();
  expect(view.getByText("Free trial expired")).toBeDefined();
  expect(view.getByText("10 licensed seats")).toBeDefined();
  expect(view.getByText("0 licensed seats")).toBeDefined();
  expect(view.getByText("Licensed seat change: +10")).toBeDefined();
  expect(view.getByText("Licensed seat change: -10")).toBeDefined();
  expect(
    view.getByText("Free trial access granted at no charge"),
  ).toBeDefined();
  expect(
    view.getByText("Free trial ended and sync was disabled"),
  ).toBeDefined();
  expect(
    view.getAllByText(
      `Trial period: ${formatMiniAppDate(periodStartsAt)} – ${formatMiniAppDate(periodEndsAt)}`,
    ),
  ).toHaveLength(2);
  expect(view.queryByText("Plan price unavailable for this event")).toBeNull();
});

test("a native lifecycle event shows its fixed tier capacity and price", () => {
  const view = render(
    <BillingHistory
      entries={[
        entry({
          id: "team-10-purchase",
          productId: "sync_team_10_monthly_staging:monthly",
          seatCount: 10,
          unitAmount: 2_000,
          currency: "usd",
          interval: "month",
          intervalCount: 1,
        }),
      ]}
      error={null}
      loading={false}
    />,
  );

  expect(view.getByText("10 licensed seats")).toBeDefined();
  expect(view.getByText("USD list price: $20.00/month")).toBeDefined();
  expect(view.getByText("Paid total unavailable")).toBeDefined();
});

test("activity preserves a provider-reported zero paid total", () => {
  const view = render(
    <BillingHistory
      entries={[
        entry({
          id: "zero-invoice",
          category: "invoice",
          provider: "stripe",
          eventType: "INVOICE_PAID",
          currency: "usd",
          totalAmount: 0,
        }),
      ]}
      error={null}
      loading={false}
    />,
  );

  expect(view.getByText("Paid: $0.00")).toBeDefined();
});

test("events expose provider details and raw billing identifiers", () => {
  const view = render(
    <BillingHistory
      entries={[
        entry({
          id: "invoice-in_raw",
          category: "invoice",
          provider: "stripe",
          eventType: "INVOICE_PAID",
          priceId: "price_raw",
          subscriptionId: "sub_raw",
          billingReason: "subscription_update",
          invoiceId: "in_raw",
          seatCount: 3,
          unitAmount: 499,
          currency: "usd",
          interval: "month",
          intervalCount: 1,
          totalAmount: 842,
        }),
      ]}
      error={null}
      loading={false}
    />,
  );
  fireEvent.click(
    view.getByRole("tab", {
      name: ORG_MANAGER_LABELS.billingHistoryEventsTab,
    }),
  );

  expect(view.getByText("Category: Invoice")).toBeDefined();
  expect(view.getByText("Provider: Stripe")).toBeDefined();
  expect(view.getByText("Outcome: applied")).toBeDefined();
  expect(view.getByText("Price ID: price_raw")).toBeDefined();
  expect(view.getByText("Subscription ID: sub_raw")).toBeDefined();
  expect(view.getByText("Invoice ID: in_raw")).toBeDefined();
  expect(view.getByText("3 licensed seats")).toBeDefined();
  expect(view.getByText("Plan price: $4.99/month")).toBeDefined();
  expect(view.getByText("Paid: $8.42")).toBeDefined();
  expect(view.getByText("Invoice reason: Subscription update")).toBeDefined();
});

test("invoice activity names unavailable financial facts", () => {
  const view = render(
    <BillingHistory
      entries={[
        entry({
          id: "partial-invoice",
          category: "invoice",
          provider: "stripe",
          eventType: "INVOICE_PAID",
        }),
      ]}
      error={null}
      loading={false}
    />,
  );

  expect(view.getByText("Paid total unavailable")).toBeDefined();
  expect(view.getByText("Licensed seat count unavailable")).toBeDefined();
  expect(view.getByText("Plan price unavailable")).toBeDefined();
});

test("a proration-only invoice keeps its exact total without inventing seat facts", () => {
  const view = render(
    <BillingHistory
      entries={[
        entry({
          id: "proration-only-invoice",
          category: "invoice",
          provider: "stripe",
          eventType: "INVOICE_PAID",
          billingReason: "subscription_update",
          currency: "usd",
          totalAmount: 317,
        }),
      ]}
      error={null}
      loading={false}
    />,
  );

  expect(view.getByText("Paid: $3.17")).toBeDefined();
  expect(view.getByText("Licensed seat count unavailable")).toBeDefined();
  expect(view.getByText("Plan price unavailable")).toBeDefined();
});

test("entries with unavailable billing facts omit empty detail rows", () => {
  const view = render(
    <BillingHistory
      entries={[entry({ id: "unavailable-entry" })]}
      error={null}
      loading={false}
    />,
  );

  expect(view.getByText("Subscription started")).toBeDefined();
  expect(view.queryByText(/^Paid:/)).toBeNull();
  expect(view.queryByText(/^Plan price:/)).toBeNull();
  expect(view.queryByText(/licensed seat/)).toBeNull();
  expect(
    view.getByText("Seat and plan price unavailable for this event"),
  ).toBeDefined();
  expect(view.queryByText("Paid total unavailable")).toBeNull();
});

test("shows the empty state on both tabs when there are no events", () => {
  const view = render(
    <BillingHistory entries={[]} error={null} loading={false} />,
  );
  expect(view.getByText(ORG_MANAGER_LABELS.billingHistoryEmpty)).toBeDefined();
  fireEvent.click(
    view.getByRole("tab", {
      name: ORG_MANAGER_LABELS.billingHistoryEventsTab,
    }),
  );
  expect(view.getByText(ORG_MANAGER_LABELS.billingHistoryEmpty)).toBeDefined();
});

test("the activity tab shows the empty state when nothing was applied", () => {
  const view = render(
    <BillingHistory
      entries={[entry({ eventType: "CANCELLATION", outcome: "ignored" })]}
      error={null}
      loading={false}
    />,
  );
  expect(view.getByText(ORG_MANAGER_LABELS.billingHistoryEmpty)).toBeDefined();
  fireEvent.click(
    view.getByRole("tab", {
      name: ORG_MANAGER_LABELS.billingHistoryEventsTab,
    }),
  );
  expect(view.getByText("CANCELLATION")).toBeDefined();
});

test("shows a loading hint before the history resolves", () => {
  const view = render(
    <BillingHistory entries={null} error={null} loading={true} />,
  );
  expect(
    view.getByText(ORG_MANAGER_LABELS.loadingBillingHistory),
  ).toBeDefined();
});

test("shows the load error instead of the lists", () => {
  const view = render(
    <BillingHistory
      entries={null}
      error={ORG_MANAGER_LABELS.failedLoadBillingHistory}
      loading={false}
    />,
  );
  expect(
    view.getByText(ORG_MANAGER_LABELS.failedLoadBillingHistory),
  ).toBeDefined();
  expect(view.queryByText(ORG_MANAGER_LABELS.billingHistoryEmpty)).toBeNull();
});
