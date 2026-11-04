import { expect, test } from "bun:test";
import type { OrganizationBillingResponse } from "@tearleads/validators/response";
import {
  claimNativeOrganizationSubscription,
  type OrganizationBilling,
  resolveOrganizationBillingView,
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
    assignedSeatCount: 1,
    assignedUserIds: ["user-1"],
    currentUserHasSyncSeat: true,
    organizationId: "org-1",
    status: "local",
    trialEndsAt: null,
    provider: null,
    currentPeriodStartsAt: null,
    currentPeriodEndsAt: null,
    seatCount: 0,
    pendingSeatCount: null,
    disabledAt: null,
    purgeAfter: null,
    canCancelDirectly: false,
    subscriptionSource: null,
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
  expect(view.canCancelDirectly).toBe(false);
  expect(view.needsAttention).toBe(false);
  expect(view.trialDaysRemaining).toBeNull();
  expect(view.seatCount).toBe(0);
  expect(view.pendingSeatCount).toBeNull();
});

test("projects a pending native plan change", () => {
  const view = resolveOrganizationBillingView(
    billing({
      status: "active",
      currentPeriodEndsAt: iso(DAY_MS),
      seatCount: 5,
      pendingSeatCount: 1,
    }),
    NOW_MS,
  );
  expect(view.pendingSeatCount).toBe(1);
});

test("an active organization remains blocked for a user without a sync seat", () => {
  const view = resolveOrganizationBillingView(
    billing({
      assignedSeatCount: 5,
      assignedUserIds: ["user-1", "user-2", "user-3", "user-4", "user-5"],
      currentPeriodEndsAt: iso(DAY_MS),
      currentUserHasSyncSeat: false,
      seatCount: 5,
      status: "active",
    }),
    NOW_MS,
  );
  expect(view.isActive).toBe(true);
  expect(view.canSync).toBe(false);
  expect(view.syncSeatUnavailable).toBe(true);
  expect(view.needsAttention).toBe(true);
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
      canCancelDirectly: true,
      subscriptionSource: "stripe",
      currentPeriodStartsAt: iso(-20 * DAY_MS),
      currentPeriodEndsAt: iso(10 * DAY_MS),
      seatCount: 3,
    }),
    NOW_MS,
  );
  expect(view.canSync).toBe(true);
  expect(view.isActive).toBe(true);
  expect(view.currentPeriodStartsAtMs).toBe(Date.parse(iso(-20 * DAY_MS)));
  expect(view.canCancelDirectly).toBe(true);
  expect(view.subscriptionSource).toBe("stripe");
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

test.each(["disabled", "deleting", "purged"] as const)(
  "%s cannot sync and needs attention",
  (status) => {
    const view = resolveOrganizationBillingView(billing({ status }), NOW_MS);
    expect(view.canSync).toBe(false);
    expect(view.needsAttention).toBe(true);
  },
);

test("claimNativeOrganizationSubscription passes the org and store through", async () => {
  const calls: Array<readonly [string, string]> = [];
  const snapshot = billing({ status: "active" });
  const result = await claimNativeOrganizationSubscription({
    apiClient: {
      claimNativeOrganizationSubscription: async (organizationId, store) => {
        calls.push([organizationId, store]);
        return { data: snapshot, ok: true };
      },
    },
    organizationId: "org-9",
    store: "app_store",
  });
  expect(calls).toEqual([["org-9", "app_store"]]);
  expect(result).toBe(snapshot);
});
