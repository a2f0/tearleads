import { expect, test } from "bun:test";
import type { OrganizationBillingResponse } from "@tearleads/validators/response";
import {
  loadOrganizationBilling,
  loadOrganizationBillingHistory,
  loadOrganizationBillingManagementUrl,
  type OrganizationBilling,
  type OrganizationBillingHistory,
  resolveOrganizationBillingView,
  startOrganizationTrial,
} from "./billing";

const NOW_MS = Date.parse("2026-07-01T00:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

function iso(offsetMs: number): string {
  return new Date(NOW_MS + offsetMs).toISOString();
}

function billing(
  overrides: Partial<OrganizationBillingResponse>,
): OrganizationBilling {
  return {
    activeMemberCount: 1,
    organizationId: "org-1",
    status: "local",
    trialEndsAt: null,
    provider: null,
    currentPeriodStartsAt: null,
    currentPeriodEndsAt: null,
    seatCount: 0,
    disabledAt: null,
    purgeAfter: null,
    ...overrides,
  };
}

test("local orgs cannot sync and need no attention", () => {
  const view = resolveOrganizationBillingView(
    billing({ status: "local" }),
    NOW_MS,
  );
  expect(view.canSync).toBe(false);
  expect(view.isLocal).toBe(true);
  expect(view.needsAttention).toBe(false);
  expect(view.trialDaysRemaining).toBeNull();
  expect(view.seatCount).toBe(0);
});

test("an active, unexpired trial can sync and reports days remaining", () => {
  const view = resolveOrganizationBillingView(
    billing({ status: "trialing", trialEndsAt: iso(3.5 * DAY_MS) }),
    NOW_MS,
  );
  expect(view.canSync).toBe(true);
  expect(view.isTrialing).toBe(true);
  expect(view.trialDaysRemaining).toBe(4); // ceil(3.5)
  expect(view.needsAttention).toBe(false);
});

test("an expired trial cannot sync and needs attention", () => {
  const view = resolveOrganizationBillingView(
    billing({ status: "trialing", trialEndsAt: iso(-1 * DAY_MS) }),
    NOW_MS,
  );
  expect(view.canSync).toBe(false);
  expect(view.isTrialing).toBe(false);
  expect(view.trialDaysRemaining).toBe(0);
  expect(view.needsAttention).toBe(true);
});

test("trialing without an end date cannot sync (mirrors the server)", () => {
  const view = resolveOrganizationBillingView(
    billing({ status: "trialing", trialEndsAt: null }),
    NOW_MS,
  );
  expect(view.canSync).toBe(false);
  expect(view.trialDaysRemaining).toBeNull();
  expect(view.needsAttention).toBe(true);
});

test("an active subscription within its period can sync", () => {
  const view = resolveOrganizationBillingView(
    billing({
      status: "active",
      currentPeriodStartsAt: iso(-20 * DAY_MS),
      currentPeriodEndsAt: iso(10 * DAY_MS),
      seatCount: 3,
    }),
    NOW_MS,
  );
  expect(view.canSync).toBe(true);
  expect(view.isActive).toBe(true);
  expect(view.currentPeriodStartsAtMs).toBe(Date.parse(iso(-20 * DAY_MS)));
  expect(view.seatCount).toBe(3);
  expect(view.needsAttention).toBe(false);
});

test("an active subscription with no period end syncs indefinitely", () => {
  const view = resolveOrganizationBillingView(
    billing({ status: "active", currentPeriodEndsAt: null }),
    NOW_MS,
  );
  expect(view.canSync).toBe(true);
  expect(view.isActive).toBe(true);
});

test("an active subscription past its period cannot sync and needs attention", () => {
  const view = resolveOrganizationBillingView(
    billing({ status: "active", currentPeriodEndsAt: iso(-1 * DAY_MS) }),
    NOW_MS,
  );
  expect(view.canSync).toBe(false);
  expect(view.needsAttention).toBe(true);
});

test.each([
  "disabled",
  "past_due",
  "deleting",
  "purged",
] as const)("%s cannot sync and needs attention", (status) => {
  const view = resolveOrganizationBillingView(billing({ status }), NOW_MS);
  expect(view.canSync).toBe(false);
  expect(view.needsAttention).toBe(true);
});

test("loadOrganizationBilling passes the org id through to the api client", async () => {
  const calls: string[] = [];
  const snapshot = billing({ status: "active" });
  const result = await loadOrganizationBilling({
    apiClient: {
      getOrganizationBilling: async (organizationId) => {
        calls.push(organizationId);
        return snapshot;
      },
    },
    organizationId: "org-9",
  });
  expect(calls).toEqual(["org-9"]);
  expect(result).toBe(snapshot);
});

test("loadOrganizationBillingHistory passes the org id through to the api client", async () => {
  const calls: string[] = [];
  const history: OrganizationBillingHistory = {
    organizationId: "org-9",
    entries: [
      {
        id: "revenuecat:event-1",
        category: "lifecycle",
        provider: "revenuecat",
        eventType: "INITIAL_PURCHASE",
        outcome: "applied",
        occurredAt: iso(0),
        productId: "sync_monthly",
        transactionId: "transaction-1",
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
      },
    ],
  };
  const result = await loadOrganizationBillingHistory({
    apiClient: {
      getOrganizationBillingHistory: async (organizationId) => {
        calls.push(organizationId);
        return history;
      },
    },
    organizationId: "org-9",
  });
  expect(calls).toEqual(["org-9"]);
  expect(result).toBe(history);
});

test("loadOrganizationBillingManagementUrl passes through the org id", async () => {
  const calls: string[] = [];
  const result = await loadOrganizationBillingManagementUrl({
    apiClient: {
      getOrganizationBillingManagementUrl: async (organizationId) => {
        calls.push(organizationId);
        return {
          canCancelDirectly: false,
          managementUrl: "https://manage.example/x",
          subscriptionSource: "native" as const,
        };
      },
    },
    organizationId: "org-9",
  });
  expect(calls).toEqual(["org-9"]);
  expect(result).toEqual({
    canCancelDirectly: false,
    managementUrl: "https://manage.example/x",
    subscriptionSource: "native",
  });
});

test("startOrganizationTrial posts for the given org", async () => {
  const calls: string[] = [];
  const snapshot = billing({ status: "trialing", trialEndsAt: iso(DAY_MS) });
  const result = await startOrganizationTrial({
    apiClient: {
      startOrganizationTrial: async (organizationId) => {
        calls.push(organizationId);
        return snapshot;
      },
    },
    organizationId: "org-9",
  });
  expect(calls).toEqual(["org-9"]);
  expect(result).toBe(snapshot);
});
