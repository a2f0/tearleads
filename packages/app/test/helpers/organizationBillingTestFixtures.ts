import type {
  OrganizationBilling,
  OrganizationBillingView,
} from "@tearleads/client-sdk";

/** Complete wire and view fixtures for tests that stub the billing provider. */
export function billingFixture(
  canSync: boolean,
  isActive: boolean,
  isTrialing: boolean,
): {
  readonly billing: OrganizationBilling;
  readonly view: OrganizationBillingView;
} {
  const status = isActive ? "active" : isTrialing ? "trialing" : "local";
  const seatCount = isActive ? 5 : 0;
  return {
    billing: {
      activeMemberCount: 1,
      assignedSeatCount: canSync ? 1 : 0,
      assignedUserIds: canSync ? ["user-1"] : [],
      currentUserHasSyncSeat: canSync,
      currentPeriodEndsAt: isActive ? "2030-02-01T00:00:00.000Z" : null,
      currentPeriodStartsAt: isActive ? "2030-01-01T00:00:00.000Z" : null,
      disabledAt: null,
      organizationId: "org-1",
      pendingSeatCount: null,
      provider: isActive ? "revenuecat" : null,
      purgeAfter: null,
      seatCount,
      status,
      trialEndsAt: isTrialing ? "2030-01-08T00:00:00.000Z" : null,
    },
    view: {
      canSync,
      assignedSeatCount: canSync ? 1 : 0,
      currentUserHasSyncSeat: canSync,
      currentPeriodEndsAtMs: isActive ? Date.UTC(2030, 1, 1) : null,
      currentPeriodStartsAtMs: isActive ? Date.UTC(2030, 0, 1) : null,
      isActive,
      isLocal: status === "local",
      isTrialing,
      needsAttention: false,
      pendingSeatCount: null,
      seatCount,
      syncSeatUnavailable: false,
      status,
      trialDaysRemaining: isTrialing ? 7 : null,
      trialEndsAtMs: isTrialing ? Date.UTC(2030, 0, 8) : null,
    },
  };
}
