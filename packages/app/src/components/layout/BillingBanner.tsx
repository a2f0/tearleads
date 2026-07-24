import type { OrganizationBillingView } from "@tearleads/client-sdk";
import { useCallback } from "react";
import { useMiniAppLauncher } from "../../mini-apps/miniAppLauncher";
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
}: {
  view: OrganizationBillingView | null;
  onEnroll: () => void;
}) {
  if (!view) {
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
        {getBillingTrialBannerLabel(view.trialDaysRemaining)}{" "}
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

/**
 * Connects {@link BillingBannerView} to the shared billing snapshot, and routes
 * enrollment into the Org Manager's Billing view. The banner is app-shell chrome
 * mounted above the panes, so it opens the mini-app through the launcher bridge
 * ({@link useMiniAppLauncher}) rather than a pane-scoped navigation hook.
 */
export function BillingBanner() {
  const { view } = useOrganizationBilling();
  const launch = useMiniAppLauncher();
  const openBilling = useCallback(() => {
    launch({ appId: "org-manager", pathSegments: ["billing"] });
  }, [launch]);
  return <BillingBannerView onEnroll={openBilling} view={view} />;
}
