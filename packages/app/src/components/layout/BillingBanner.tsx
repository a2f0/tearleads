import type { OrganizationBillingView } from "@tearleads/client-sdk";
import { useCallback } from "react";
import {
  useActiveMiniAppRoute,
  useMiniAppLauncher,
} from "../../mini-apps/miniAppLauncher";
import { useOrganizationBilling } from "../../providers/billing/BillingProvider";
import {
  BILLING_LABELS,
  BILLING_TRIAL_ENROLL_LABEL,
  getBillingTrialBannerLabel,
} from "../../providers/billing/billingLabels";
import "./BillingBanner.css";

function needsAttentionMessage(
  status: OrganizationBillingView["status"],
): string {
  switch (status) {
    case "past_due":
      return BILLING_LABELS.bannerPastDue;
    case "deleting":
      return BILLING_LABELS.bannerDeleting;
    case "purged":
      return BILLING_LABELS.bannerPurged;
    default:
      return BILLING_LABELS.bannerSyncPaused;
  }
}

/**
 * Presentational billing banner: a trial countdown with an enrollment link while
 * trialing, a warning while sync needs attention (lapsed/disabled/past due), and
 * nothing when the org is active or free/local. Prop-driven so it is
 * unit-testable without the navigation stack.
 */
export function BillingBannerView({
  view,
  onEnroll,
  isBillingScreen = false,
}: {
  view: OrganizationBillingView | null;
  onEnroll: () => void;
  isBillingScreen?: boolean | undefined;
}) {
  if (!view || isBillingScreen) {
    return null;
  }
  // A warning takes precedence over the trial countdown. These are mutually
  // exclusive today (isTrialing implies canSync implies !needsAttention), but
  // checking needsAttention first keeps the urgent state winning regardless.
  if (view.needsAttention) {
    return (
      <div className="billing-banner billing-banner--warning" role="alert">
        {needsAttentionMessage(view.status)}
      </div>
    );
  }
  if (view.isTrialing && view.trialDaysRemaining !== null) {
    return (
      <div className="billing-banner billing-banner--info" role="status">
        <span className="billing-banner-trial-copy">
          {getBillingTrialBannerLabel(view.trialDaysRemaining)}
        </span>{" "}
        <button
          className="billing-banner-enroll"
          onClick={onEnroll}
          type="button"
        >
          {BILLING_TRIAL_ENROLL_LABEL}
        </button>
      </div>
    );
  }
  return null;
}

const BILLING_ROUTE = {
  appId: "org-manager",
  pathSegments: ["billing"],
} as const;

/**
 * Connects {@link BillingBannerView} to the active pane route and sends its
 * enrollment action through the shell launcher bridge.
 */
export function ActiveRouteBillingBanner({
  view,
}: {
  view: OrganizationBillingView | null;
}) {
  const launch = useMiniAppLauncher();
  const activeRoute = useActiveMiniAppRoute();
  // Billing sub-routes retain the same leading segment and hide the banner too.
  const isBillingScreen =
    activeRoute?.appId === BILLING_ROUTE.appId &&
    activeRoute.pathSegments[0] === BILLING_ROUTE.pathSegments[0];
  const openBilling = useCallback(() => {
    launch(BILLING_ROUTE);
  }, [launch]);
  return (
    <BillingBannerView
      isBillingScreen={isBillingScreen}
      onEnroll={openBilling}
      view={view}
    />
  );
}

export function BillingBanner() {
  const { view } = useOrganizationBilling();
  return <ActiveRouteBillingBanner view={view} />;
}
