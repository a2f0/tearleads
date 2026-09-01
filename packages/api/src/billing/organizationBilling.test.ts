import { describe, expect, test } from "bun:test";
import type { OrganizationBillingStatus } from "@tearleads/api-shared/schema";
import {
  createLocalBillingFields,
  createTrialBillingFields,
  FREE_TRIAL_MS,
  organizationCanSync,
  serializeOrganizationBilling,
} from "./organizationBilling";

describe("organization billing lifecycle", () => {
  test("local billing starts free and on-device", () => {
    expect(createLocalBillingFields()).toEqual({
      status: "local",
      trialEndsAt: null,
    });
  });

  test("trial billing sets a 7-day trial from now", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const fields = createTrialBillingFields(now);
    expect(fields.status).toBe("trialing");
    expect(fields.trialEndsAt.getTime()).toBe(now.getTime() + FREE_TRIAL_MS);
  });

  test("only active and non-expired trialing organizations may sync", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const future = new Date("2026-01-02T00:00:00.000Z");
    const past = new Date("2025-12-31T00:00:00.000Z");

    expect(
      organizationCanSync(
        { currentPeriodEndsAt: null, status: "active", trialEndsAt: null },
        now,
      ),
    ).toBe(true);
    expect(
      organizationCanSync(
        { currentPeriodEndsAt: future, status: "active", trialEndsAt: null },
        now,
      ),
    ).toBe(true);
    expect(
      organizationCanSync(
        { currentPeriodEndsAt: past, status: "active", trialEndsAt: null },
        now,
      ),
    ).toBe(false);
    // A trialing org must have an unexpired trial end; null is not an
    // indefinite sync entitlement.
    expect(
      organizationCanSync(
        {
          currentPeriodEndsAt: null,
          status: "trialing",
          trialEndsAt: null,
        },
        now,
      ),
    ).toBe(false);
    expect(
      organizationCanSync(
        {
          currentPeriodEndsAt: null,
          status: "trialing",
          trialEndsAt: future,
        },
        now,
      ),
    ).toBe(true);
    // An expired trial that has not yet been flipped to `disabled` is not
    // syncable, evaluated in-memory against `now`.
    expect(
      organizationCanSync(
        { currentPeriodEndsAt: null, status: "trialing", trialEndsAt: past },
        now,
      ),
    ).toBe(false);

    const cannotSync: OrganizationBillingStatus[] = [
      "local",
      "past_due",
      "disabled",
      "deleting",
      "purged",
    ];
    for (const status of cannotSync) {
      expect(
        organizationCanSync(
          { currentPeriodEndsAt: null, status, trialEndsAt: null },
          now,
        ),
      ).toBe(false);
    }
  });

  test("serializes dates to ISO strings and preserves nulls", () => {
    const trialEndsAt = new Date("2026-01-08T00:00:00.000Z");
    expect(
      serializeOrganizationBilling(
        {
          organizationId: "org-1",
          status: "trialing",
          trialEndsAt,
          provider: null,
          currentPeriodStartsAt: null,
          currentPeriodEndsAt: null,
          seatCount: 1,
          disabledAt: null,
          purgeAfter: null,
        },
        {
          activeMemberCount: 1,
          assignedSeatCount: 1,
          assignedUserIds: ["user-1"],
          currentUserHasSyncSeat: true,
          pendingSeatCount: null,
        },
      ),
    ).toEqual({
      organizationId: "org-1",
      activeMemberCount: 1,
      assignedSeatCount: 1,
      assignedUserIds: ["user-1"],
      currentUserHasSyncSeat: true,
      status: "trialing",
      trialEndsAt: trialEndsAt.toISOString(),
      provider: null,
      currentPeriodStartsAt: null,
      currentPeriodEndsAt: null,
      seatCount: 1,
      pendingSeatCount: null,
      disabledAt: null,
      purgeAfter: null,
    });
  });
});
