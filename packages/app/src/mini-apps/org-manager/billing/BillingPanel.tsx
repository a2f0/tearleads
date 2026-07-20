import { useCallback, useRef } from "react";
import { useOrganizationBilling } from "../../../providers/billing/BillingProvider";
import { useBillingActions } from "../hooks/useBillingActions";
import { BillingDirectCheckout } from "./BillingDirectCheckout";
import { BillingHistory } from "./BillingHistory";
import { BillingView } from "./BillingView";
import { useBillingHistory } from "./useBillingHistory";
import { useBillingManagementUrl } from "./useBillingManagementUrl";
import { useDirectCheckoutFlow } from "./useDirectCheckout";

/**
 * Container for the org-manager billing view: wires the billing snapshot
 * ({@link useOrganizationBilling}), the purchase orchestration
 * ({@link useBillingActions}), and — for org admins — the billing lifecycle
 * history ({@link useBillingHistory}). The presentational {@link BillingView}
 * and {@link BillingHistory} stay prop-driven and unit-testable.
 */
export function BillingPanel({
  isOrgAdmin,
  organizationId,
  userId,
}: {
  isOrgAdmin: boolean;
  organizationId: string;
  userId: string | null;
}) {
  const billing = useOrganizationBilling();
  const { refresh } = billing;
  // Where the Web Billing checkout embeds so a purchase runs inside the panel
  // (the view keeps the div mounted; the hook reads it at purchase time).
  const checkoutHostRef = useRef<HTMLDivElement | null>(null);
  const actions = useBillingActions({
    isOrgAdmin,
    billingCanSync: billing.view?.canSync ?? false,
    checkoutHostRef,
    organizationId,
    refresh,
    startTrial: billing.startTrial,
    userId,
  });
  // Pass the billing snapshot so a billing refresh (activation poll / Refresh)
  // also refetches history, keeping the tabs current after a purchase.
  const history = useBillingHistory(
    organizationId,
    isOrgAdmin,
    billing.billing,
  );
  // Only fetch the manage link for an admin of an org with a provider-managed
  // subscription (active or lapsed) — not a local or free-trial org, which has
  // no provider customer to resolve. Reuse the billing snapshot as the reload
  // token so a refresh re-resolves the link.
  const managementUrl = useBillingManagementUrl(
    organizationId,
    isOrgAdmin &&
      billing.view !== null &&
      !billing.view.isLocal &&
      !billing.view.isTrialing,
    billing.billing,
  );
  const handleRefresh = useCallback(() => {
    void refresh();
  }, [refresh]);
  // A confirmed payment grants the entitlement asynchronously (Stripe →
  // RevenueCat → our webhook), so reuse the existing refresh/activation poll
  // rather than assuming the org can sync immediately.
  // `enabled` is the render gate too (below): when it flips off mid-flow —
  // e.g. another admin's purchase lands and the org starts syncing — the hook
  // tears the element down rather than having its host yanked out from under
  // a live session.
  const checkoutEnabled = Boolean(
    isOrgAdmin && billing.view && !billing.view.canSync,
  );
  const checkout = useDirectCheckoutFlow({
    canSubscribe: actions.canSubscribe,
    enabled: checkoutEnabled,
    organizationId,
    onPaid: actions.markActivationPending,
  });

  // While our own checkout is collecting or confirming, the provider-hosted
  // subscribe/trial/restore actions must not start a competing purchase — the
  // same cross-lock `busy` already provides among those actions.
  const checkoutActive =
    checkout.phase.kind === "collecting" ||
    checkout.phase.kind === "confirming" ||
    checkout.phase.kind === "starting";

  return (
    <div>
      <BillingView
        actionError={actions.actionError}
        activationPending={actions.activationPending}
        busy={checkoutActive ? "checkout" : actions.busy}
        canSubscribe={actions.canSubscribe}
        checkoutActive={actions.checkoutActive}
        checkoutHostRef={checkoutHostRef}
        embeddedCheckout={actions.embeddedCheckout}
        error={billing.error}
        isOrgAdmin={isOrgAdmin}
        loading={billing.loading}
        managementUrl={managementUrl}
        onCancelCheckout={actions.cancelCheckout}
        onRefresh={handleRefresh}
        onRestore={actions.restore}
        onStartTrial={actions.startTrial}
        onSubscribe={actions.subscribe}
        options={actions.options}
        purchaseAvailable={actions.purchaseAvailable}
        view={billing.view}
      />
      {/*
        Only offer a purchase the org can actually make: an org that already
        syncs would get a server 409 surfaced as a generic failure.
      */}
      {checkoutEnabled ? (
        <BillingDirectCheckout
          checkout={checkout}
          disabled={actions.busy !== null}
        />
      ) : null}
      {isOrgAdmin ? (
        <BillingHistory
          entries={history.entries}
          error={history.error}
          loading={history.loading}
        />
      ) : null}
    </div>
  );
}
