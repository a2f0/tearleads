import { afterEach, expect, mock, test } from "bun:test";
import type { OrganizationBillingView } from "@tearleads/client-sdk";
import { cleanup, fireEvent, render } from "@testing-library/react";
import {
  MiniAppLauncherProvider,
  useRegisterMiniAppLauncher,
} from "../../mini-apps/miniAppLauncher";
import type { AppRouteState } from "../../navigation/AppRoutePaths";
import { ActiveRouteBillingBanner, BillingBannerView } from "./BillingBanner";

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
  expect(getByRole("status").textContent).toContain("3 days in free trial");
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
  expect(getByRole("status").textContent).toContain("1 day in free trial");
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
  fireEvent.click(getByRole("button", { name: "Enroll" }));
  expect(onEnroll).toHaveBeenCalledTimes(1);
});

test("renders nothing on the enrollment screen", () => {
  const { container } = render(
    <BillingBannerView
      isBillingScreen={true}
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

function BannerAtRoute({ route }: { route: AppRouteState }) {
  useRegisterMiniAppLauncher(noop, true, route);
  return (
    <ActiveRouteBillingBanner
      view={view({
        status: "trialing",
        isLocal: false,
        isTrialing: true,
        canSync: true,
        trialDaysRemaining: 3,
      })}
    />
  );
}

test("hides the active-route banner only on org manager billing", () => {
  const rendered = render(
    <MiniAppLauncherProvider>
      <BannerAtRoute
        route={{ appId: "org-manager", pathSegments: ["billing"] }}
      />
    </MiniAppLauncherProvider>,
  );
  expect(rendered.container.firstChild).toBe(null);

  rendered.rerender(
    <MiniAppLauncherProvider>
      <BannerAtRoute
        route={{ appId: "org-manager", pathSegments: ["groups"] }}
      />
    </MiniAppLauncherProvider>,
  );
  expect(rendered.getByRole("status").textContent).toContain(
    "3 days in free trial",
  );
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
