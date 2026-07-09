import { afterEach, expect, test } from "bun:test";
import type { OrganizationBillingView } from "@tearleads/client-sdk";
import { cleanup, render } from "@testing-library/react";
import { BillingBannerView } from "./BillingBanner";

afterEach(() => cleanup());

function view(
  overrides: Partial<OrganizationBillingView>,
): OrganizationBillingView {
  return {
    status: "local",
    canSync: false,
    isLocal: true,
    isTrialing: false,
    isActive: false,
    trialDaysRemaining: null,
    trialEndsAtMs: null,
    currentPeriodStartsAtMs: null,
    currentPeriodEndsAtMs: null,
    seatCount: 0,
    needsAttention: false,
    ...overrides,
  };
}

test("renders nothing without a view", () => {
  const { container } = render(<BillingBannerView view={null} />);
  expect(container.firstChild).toBe(null);
});

test("renders nothing for a free/local org", () => {
  const { container } = render(
    <BillingBannerView view={view({ status: "local", isLocal: true })} />,
  );
  expect(container.firstChild).toBe(null);
});

test("renders nothing for an active subscription", () => {
  const { container } = render(
    <BillingBannerView
      view={view({
        status: "active",
        isLocal: false,
        isActive: true,
        canSync: true,
      })}
    />,
  );
  expect(container.firstChild).toBe(null);
});

test("shows the trial countdown while trialing", () => {
  const { getByRole } = render(
    <BillingBannerView
      view={view({
        status: "trialing",
        isLocal: false,
        isTrialing: true,
        canSync: true,
        trialDaysRemaining: 3,
      })}
    />,
  );
  expect(getByRole("status").textContent).toContain("3 days left");
});

test("uses the singular day at one day left", () => {
  const { getByRole } = render(
    <BillingBannerView
      view={view({
        status: "trialing",
        isLocal: false,
        isTrialing: true,
        canSync: true,
        trialDaysRemaining: 1,
      })}
    />,
  );
  expect(getByRole("status").textContent).toContain("1 day left");
});

test("warns when sync is disabled", () => {
  const { getByRole } = render(
    <BillingBannerView
      view={view({ status: "disabled", isLocal: false, needsAttention: true })}
    />,
  );
  expect(getByRole("alert").textContent).toContain("Sync is paused");
});

test("warns with the past-due message", () => {
  const { getByRole } = render(
    <BillingBannerView
      view={view({ status: "past_due", isLocal: false, needsAttention: true })}
    />,
  );
  expect(getByRole("alert").textContent).toContain("past due");
});
