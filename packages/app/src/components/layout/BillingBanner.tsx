import type { OrganizationBillingView } from "@tearleads/client-sdk";
import { useActiveMiniAppRoute } from "../../mini-apps/miniAppLauncher";
import { useOrganizationBilling } from "../../providers/billing/BillingProvider";
import { BILLING_LABELS } from "../../providers/billing/billingLabels";
import "./BillingBanner.css";

function needsAttentionMessage(view: OrganizationBillingView): string {
  if (view.syncSeatUnavailable) {
    return BILLING_LABELS.bannerSyncSeatUnavailable;
  }
  switch (view.status) {
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
 * Presentational billing warning shown only while sync needs attention
 * (lapsed/disabled/past due). Trial promotion no longer occupies app chrome.
 */
export function BillingBannerView({
  view,
  isBillingScreen = false,
}: {
  view: OrganizationBillingView | null;
  isBillingScreen?: boolean | undefined;
}) {
  if (!view || isBillingScreen || !view.needsAttention) {
    return null;
  }

  return (
    <div className="billing-banner billing-banner--warning" role="alert">
      {needsAttentionMessage(view)}
    </div>
  );
}

const BILLING_ROUTE = {
  appId: "org-manager",
  pathSegments: ["billing"],
} as const;

/**
 * Connects {@link BillingBannerView} to the active pane route so the warning is
 * not duplicated inside Organization Billing.
 */
export function ActiveRouteBillingBanner({
  view,
}: {
  view: OrganizationBillingView | null;
}) {
  const activeRoute = useActiveMiniAppRoute();
  // Billing sub-routes retain the same leading segment and hide the banner too.
  const isBillingScreen =
    activeRoute?.appId === BILLING_ROUTE.appId &&
    activeRoute.pathSegments[0] === BILLING_ROUTE.pathSegments[0];
  return <BillingBannerView isBillingScreen={isBillingScreen} view={view} />;
}

export function BillingBanner() {
  const { view } = useOrganizationBilling();
  return <ActiveRouteBillingBanner view={view} />;
}
