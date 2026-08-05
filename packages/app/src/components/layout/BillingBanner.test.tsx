import { afterEach, expect, test } from "bun:test";
import type { OrganizationBillingView } from "@tearleads/client-sdk";
import { cleanup, render } from "@testing-library/react";
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
    assignedSeatCount: 0,
    currentUserHasSyncSeat: false,
    syncSeatUnavailable: false,
    pendingSeatCount: null,
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

test("renders no promotional chrome while trialing", () => {
  const { container } = render(
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
  expect(container.firstChild).toBe(null);
});

test("renders no warning on the billing screen", () => {
  const { container } = render(
    <BillingBannerView
      isBillingScreen={true}
      view={view({
        status: "disabled",
        isLocal: false,
        needsAttention: true,
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
        status: "disabled",
        isLocal: false,
        needsAttention: true,
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
  expect(rendered.getByRole("alert").textContent).toContain("Sync is paused");
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
