import { expect, test } from "bun:test";
import {
  isOrganizationBillingHistoryEntry,
  isOrganizationBillingHistoryResponse,
} from "./organizationBillingHistory";

const ENTRY = {
  eventType: "INITIAL_PURCHASE",
  outcome: "applied",
  occurredAt: "2026-07-01T00:00:00.000Z",
  productId: "sync_monthly",
  transactionId: "transaction-1",
};

const HISTORY_RESPONSE = {
  organizationId: "org-1",
  entries: [
    ENTRY,
    {
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
});
