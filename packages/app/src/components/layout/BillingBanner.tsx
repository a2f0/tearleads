import type { OrganizationBillingView } from "@tearleads/client-sdk";
import { buildMiniAppPath } from "../../navigation/AppRoutePaths";
import { useOrganizationBilling } from "../../providers/billing/BillingProvider";
import {
  BILLING_LABELS,
  BILLING_TRIAL_ENROLL_LABEL,
  getBillingTrialBannerLabel,
} from "../../providers/billing/billingLabels";
import "./BillingBanner.css";

// Deep link into the Org Manager's Billing view, where a trial converts to a
// paid subscription. buildMiniAppPath is a pure helper, so this app-shell banner
// — mounted above the panes, outside the pane-scoped navigation/bus providers —
// links there with a plain anchor instead of a provider-backed navigate hook.
const BILLING_ENROLL_HREF = buildMiniAppPath("org-manager", ["billing"]);

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
 * Presentational billing banner: a trial countdown while trialing, a warning
 * while sync needs attention (lapsed/disabled/past due), and nothing when the
 * org is active or free/local. Prop-driven so it is unit-testable.
 */
export function BillingBannerView({
  view,
}: {
  view: OrganizationBillingView | null;
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
        <a className="billing-banner-enroll" href={BILLING_ENROLL_HREF}>
          {BILLING_TRIAL_ENROLL_LABEL}
        </a>
      </div>
    );
  }
  return null;
}

/** Connects {@link BillingBannerView} to the shared billing snapshot. */
export function BillingBanner() {
  const { view } = useOrganizationBilling();
  return <BillingBannerView view={view} />;
}
