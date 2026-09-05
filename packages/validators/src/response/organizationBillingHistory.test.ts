import { expect, test } from "bun:test";
import {
  isOrganizationBillingHistoryEntry,
  isOrganizationBillingHistoryResponse,
} from "./organizationBillingHistory";

const ENTRY = {
  id: "event-1",
  category: "lifecycle",
  provider: "revenuecat",
  environment: null,
  eventType: "INITIAL_PURCHASE",
  outcome: "applied",
  occurredAt: "2026-07-01T00:00:00.000Z",
  productId: "sync_solo_monthly",
  transactionId: "transaction-1",
  invoiceId: null,
  subscriptionId: null,
  billingReason: null,
  seatCount: 4,
  seatDelta: 1,
  activeSeatCount: 3,
  priceId: null,
  unitAmount: null,
  currency: null,
  interval: null,
  intervalCount: null,
  totalAmount: null,
  totalCurrency: null,
  periodStartsAt: "2026-07-01T00:00:00.000Z",
  periodEndsAt: "2026-08-01T00:00:00.000Z",
};

const HISTORY_RESPONSE = {
  organizationId: "org-1",
  entries: [
    ENTRY,
    {
      ...ENTRY,
      id: "event-2",
      eventType: "CANCELLATION",
      outcome: "ignored",
      occurredAt: "2026-06-01T00:00:00.000Z",
      productId: null,
      transactionId: null,
    },
  ],
};

test("isOrganizationBillingHistoryResponse accepts the history shape", () => {
  expect(isOrganizationBillingHistoryResponse(HISTORY_RESPONSE)).toBe(true);
});

test("isOrganizationBillingHistoryResponse accepts an empty history", () => {
  expect(
    isOrganizationBillingHistoryResponse({
      organizationId: "org-1",
      entries: [],
    }),
  ).toBe(true);
});

test("isOrganizationBillingHistoryResponse rejects a missing organizationId", () => {
  expect(isOrganizationBillingHistoryResponse({ entries: [ENTRY] })).toBe(
    false,
  );
});

test("isOrganizationBillingHistoryResponse rejects a non-array entries", () => {
  expect(
    isOrganizationBillingHistoryResponse({
      organizationId: "org-1",
      entries: ENTRY,
    }),
  ).toBe(false);
});

test("isOrganizationBillingHistoryResponse rejects an invalid entry", () => {
  expect(
    isOrganizationBillingHistoryResponse({
      organizationId: "org-1",
      entries: [{ ...ENTRY, outcome: "duplicate" }],
    }),
  ).toBe(false);
  expect(
    isOrganizationBillingHistoryResponse({
      organizationId: "org-1",
      entries: [{ ...ENTRY, occurredAt: null }],
    }),
  ).toBe(false);
  expect(isOrganizationBillingHistoryResponse(null)).toBe(false);
  expect(isOrganizationBillingHistoryResponse("nope")).toBe(false);
});

test("isOrganizationBillingHistoryEntry allows null product and transaction ids", () => {
  expect(
    isOrganizationBillingHistoryEntry({
      ...ENTRY,
      productId: null,
      transactionId: null,
    }),
  ).toBe(true);
});

test("isOrganizationBillingHistoryEntry accepts lifecycle, seat, and invoice metadata", () => {
  expect(
    isOrganizationBillingHistoryEntry({
      ...ENTRY,
      category: "seat",
      provider: "internal",
      eventType: "licensed_seat_count_increased",
      productId: null,
      transactionId: null,
      seatDelta: -1,
    }),
  ).toBe(true);
  expect(
    isOrganizationBillingHistoryEntry({
      ...ENTRY,
      category: "invoice",
      provider: "stripe",
      eventType: "INVOICE_PAID",
      invoiceId: "in_1",
      subscriptionId: "sub_1",
      billingReason: "subscription_cycle",
      seatCount: 4,
      seatDelta: null,
      activeSeatCount: null,
      priceId: "price_1",
      unitAmount: 1_200,
      currency: "usd",
      interval: "month",
      intervalCount: 3,
      totalAmount: 4_800,
      totalCurrency: "usd",
    }),
  ).toBe(true);
});

test("isOrganizationBillingHistoryEntry rejects unknown categories and providers", () => {
  expect(
    isOrganizationBillingHistoryEntry({ ...ENTRY, category: "charge" }),
  ).toBe(false);
  expect(
    isOrganizationBillingHistoryEntry({ ...ENTRY, provider: "paypal" }),
  ).toBe(false);
});

test("isOrganizationBillingHistoryEntry requires nullable snapshot fields", () => {
  const { invoiceId: _invoiceId, ...withoutInvoiceId } = ENTRY;
  expect(isOrganizationBillingHistoryEntry(withoutInvoiceId)).toBe(false);
  expect(
    isOrganizationBillingHistoryEntry({ ...ENTRY, periodStartsAt: 1 }),
  ).toBe(false);
  expect(
    isOrganizationBillingHistoryEntry({ ...ENTRY, billingReason: 1 }),
  ).toBe(false);
  const { totalCurrency: _totalCurrency, ...withoutTotalCurrency } = ENTRY;
  expect(isOrganizationBillingHistoryEntry(withoutTotalCurrency)).toBe(false);
});

test("isOrganizationBillingHistoryEntry validates billing environments", () => {
  expect(
    isOrganizationBillingHistoryEntry({ ...ENTRY, environment: "sandbox" }),
  ).toBe(true);
  expect(
    isOrganizationBillingHistoryEntry({ ...ENTRY, environment: "production" }),
  ).toBe(true);
  expect(
    isOrganizationBillingHistoryEntry({ ...ENTRY, environment: "test" }),
  ).toBe(false);
});

test("isOrganizationBillingHistoryEntry requires safe integer snapshots", () => {
  for (const key of [
    "seatCount",
    "seatDelta",
    "activeSeatCount",
    "unitAmount",
    "intervalCount",
    "totalAmount",
  ] as const) {
    expect(isOrganizationBillingHistoryEntry({ ...ENTRY, [key]: 1.5 })).toBe(
      false,
    );
    expect(
      isOrganizationBillingHistoryEntry({
        ...ENTRY,
        [key]: Number.MAX_SAFE_INTEGER + 1,
      }),
    ).toBe(false);
    expect(isOrganizationBillingHistoryEntry({ ...ENTRY, [key]: null })).toBe(
      true,
    );
  }
});

test("isOrganizationBillingHistoryEntry rejects negative counts and amounts", () => {
  for (const key of [
    "seatCount",
    "activeSeatCount",
    "unitAmount",
    "totalAmount",
  ] as const) {
    expect(isOrganizationBillingHistoryEntry({ ...ENTRY, [key]: -1 })).toBe(
      false,
    );
  }
  expect(
    isOrganizationBillingHistoryEntry({ ...ENTRY, intervalCount: 0 }),
  ).toBe(false);
  expect(isOrganizationBillingHistoryEntry({ ...ENTRY, seatDelta: -1 })).toBe(
    true,
  );
});

test("isOrganizationBillingHistoryEntry rejects non-string ids and outcomes", () => {
  expect(isOrganizationBillingHistoryEntry({ ...ENTRY, productId: 1 })).toBe(
    false,
  );
  expect(isOrganizationBillingHistoryEntry({ ...ENTRY, outcome: 1 })).toBe(
    false,
  );
  expect(isOrganizationBillingHistoryEntry({ ...ENTRY, eventType: 1 })).toBe(
    false,
  );
  expect(isOrganizationBillingHistoryEntry({ ...ENTRY, id: 1 })).toBe(false);
});
