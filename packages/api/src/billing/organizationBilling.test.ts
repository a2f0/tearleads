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

  test("only trialing and active organizations may sync", () => {
    expect(organizationCanSync("trialing")).toBe(true);
    expect(organizationCanSync("active")).toBe(true);
    const cannotSync: OrganizationBillingStatus[] = [
      "local",
      "past_due",
      "disabled",
      "deleting",
      "purged",
    ];
    for (const status of cannotSync) {
      expect(organizationCanSync(status)).toBe(false);
    }
  });

  test("serializes dates to ISO strings and preserves nulls", () => {
    const trialEndsAt = new Date("2026-01-08T00:00:00.000Z");
    expect(
      serializeOrganizationBilling({
        organizationId: "org-1",
        status: "trialing",
        trialEndsAt,
        provider: null,
        currentPeriodEndsAt: null,
        disabledAt: null,
        purgeAfter: null,
      }),
    ).toEqual({
      organizationId: "org-1",
      status: "trialing",
      trialEndsAt: trialEndsAt.toISOString(),
      provider: null,
      currentPeriodEndsAt: null,
      disabledAt: null,
      purgeAfter: null,
    });
  });
});
