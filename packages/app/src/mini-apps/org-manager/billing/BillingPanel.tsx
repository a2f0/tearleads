import { useCallback, useRef } from "react";
import { useOrganizationBilling } from "../../../providers/billing/BillingProvider";
import { useBillingActions } from "../hooks/useBillingActions";
import { BillingHistory } from "./BillingHistory";
import { BillingView } from "./BillingView";
import { useBillingHistory } from "./useBillingHistory";
import { useBillingManagementUrl } from "./useBillingManagementUrl";

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

  return (
    <div>
      <BillingView
        actionError={actions.actionError}
        activationPending={actions.activationPending}
        busy={actions.busy}
        canSubscribe={actions.canSubscribe}
        checkoutHostRef={checkoutHostRef}
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
