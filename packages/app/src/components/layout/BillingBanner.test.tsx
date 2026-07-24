import { afterEach, expect, mock, test } from "bun:test";
import type { OrganizationBillingView } from "@tearleads/client-sdk";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { BillingBannerView } from "./BillingBanner";

afterEach(() => cleanup());

const noop = () => {};

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
  const { container } = render(
    <BillingBannerView onEnroll={noop} view={null} />,
  );
  expect(container.firstChild).toBe(null);
});

test("renders nothing for a free/local org", () => {
  const { container } = render(
    <BillingBannerView
      onEnroll={noop}
      view={view({ status: "local", isLocal: true })}
    />,
  );
  expect(container.firstChild).toBe(null);
});

test("renders nothing for an active subscription", () => {
  const { container } = render(
    <BillingBannerView
      onEnroll={noop}
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
      onEnroll={noop}
      view={view({
        status: "trialing",
        isLocal: false,
        isTrialing: true,
        canSync: true,
        trialDaysRemaining: 3,
      })}
    />,
  );
  expect(getByRole("status").textContent).toContain(
    "Free trial ends in 3 days.",
  );
});

test("uses the singular day at one day left", () => {
  const { getByRole } = render(
    <BillingBannerView
      onEnroll={noop}
      view={view({
        status: "trialing",
        isLocal: false,
        isTrialing: true,
        canSync: true,
        trialDaysRemaining: 1,
      })}
    />,
  );
  expect(getByRole("status").textContent).toContain(
    "Free trial ends in 1 day.",
  );
});

test("enroll button invokes onEnroll while trialing", () => {
  const onEnroll = mock(() => {});
  const { getByRole } = render(
    <BillingBannerView
      onEnroll={onEnroll}
      view={view({
        status: "trialing",
        isLocal: false,
        isTrialing: true,
        canSync: true,
        trialDaysRemaining: 3,
      })}
    />,
  );
  fireEvent.click(getByRole("button", { name: "Enroll here" }));
  expect(onEnroll).toHaveBeenCalledTimes(1);
});

test("renders nothing on the enrollment screen", () => {
  const { container } = render(
    <BillingBannerView
      isEnrollmentScreen={true}
      onEnroll={noop}
      view={view({
        status: "trialing",
        isLocal: false,
        isTrialing: true,
        canSync: true,
        trialDaysRemaining: 3,
      })}
    />,
  );
  expect(container.firstChild).toBe(null);
});

test("warns when sync is disabled", () => {
  const { getByRole } = render(
    <BillingBannerView
      onEnroll={noop}
      view={view({ status: "disabled", isLocal: false, needsAttention: true })}
    />,
  );
  expect(getByRole("alert").textContent).toContain("Sync is paused");
});

test("warns with the past-due message", () => {
  const { getByRole } = render(
    <BillingBannerView
      onEnroll={noop}
      view={view({ status: "past_due", isLocal: false, needsAttention: true })}
    />,
  );
  expect(getByRole("alert").textContent).toContain("past due");
});
