import { useCallback, useRef } from "react";
import { useOrganizationBilling } from "../../../providers/billing/BillingProvider";
import { useBillingActions } from "../hooks/useBillingActions";
import { BillingCancelSubscription } from "./BillingCancelSubscription";
import { BillingDirectCheckout } from "./BillingDirectCheckout";
import { BillingHistory } from "./BillingHistory";
import { BillingView } from "./BillingView";
import { useBillingHistory } from "./useBillingHistory";
import { useBillingManagementUrl } from "./useBillingManagementUrl";
import { useCancelSubscription } from "./useCancelSubscription";
import { useDirectCheckoutFlow } from "./useDirectCheckout";

/**
 * Container for the org-manager billing view: wires the billing snapshot
 * ({@link useOrganizationBilling}), the purchase orchestration
 * ({@link useBillingActions}), and — for org admins — the billing lifecycle
 * history ({@link useBillingHistory}). The presentational {@link BillingView}
 * and {@link BillingHistory} stay prop-driven and unit-testable.
 */
/**
 * The direct-checkout + cancel wiring, split out so {@link BillingPanel} stays
 * within the per-function line budget. Derives the render gate, the purchase
 * cross-lock, and the cancel flow from the billing snapshot.
 */
function useDirectCheckoutWiring(input: {
  readonly isOrgAdmin: boolean;
  readonly organizationId: string;
  readonly userId: string | null;
  readonly canSync: boolean;
  readonly hasView: boolean;
  readonly refresh: () => Promise<void>;
  readonly onPaid: () => void;
}) {
  const cancel = useCancelSubscription({ refresh: input.refresh });
  // `enabled` is the render gate too: when it flips off mid-flow — e.g. another
  // admin's purchase lands and the org starts syncing — the hook tears the
  // element down rather than having its host yanked out from under a live
  // session.
  const checkoutEnabled = Boolean(
    input.isOrgAdmin && input.hasView && !input.canSync,
  );
  const checkout = useDirectCheckoutFlow({
    // Deliberately NOT `actions.canSubscribe`: that folds in
    // `purchases.isAvailable`, which is false without a RevenueCat web key.
    // This checkout runs against our own Stripe account and needs only the
    // publishable key — which the hook already gates on via the capability's
    // `isAvailable`. Reusing `canSubscribe` would silently hide the form on a
    // build configured for Stripe alone.
    canSubscribe: input.isOrgAdmin && input.userId !== null,
    enabled: checkoutEnabled,
    organizationId: input.organizationId,
    onPaid: input.onPaid,
  });
  // While our own checkout is collecting or confirming, the provider-hosted
  // subscribe/trial/restore actions must not start a competing purchase — the
  // same cross-lock `busy` already provides among those actions.
  const checkoutActive =
    checkout.phase.kind === "collecting" ||
    checkout.phase.kind === "confirming" ||
    checkout.phase.kind === "starting";
  return { cancel, checkout, checkoutActive, checkoutEnabled };
}

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
  const { cancel, checkout, checkoutActive, checkoutEnabled } =
    useDirectCheckoutWiring({
      isOrgAdmin,
      organizationId,
      userId,
      canSync: billing.view?.canSync ?? false,
      hasView: billing.view !== null,
      refresh,
      onPaid: actions.markActivationPending,
    });

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
        // Where our own card checkout can run (web + a Stripe key), it is the
        // purchase path — rendering RevenueCat's subscribe list too would put
        // two near-identical "Sync / Subscribe" rows in the panel. Native
        // shells have no direct checkout, so `available` is false there and
        // they keep the provider-hosted store sheet.
        purchaseAvailable={actions.purchaseAvailable && !checkout.available}
        view={billing.view}
      />
      {/*
        Only offer a purchase the org can actually make: an org that already
        syncs would get a server 409 surfaced as a generic failure.
      */}
      {checkoutEnabled ? (
        <BillingDirectCheckout
          checkout={checkout}
          // `activationPending` too: after a payment the org still cannot
          // sync until the webhook lands, so the Subscribe row would come
          // back and a second checkout would 409 into a generic failure.
          disabled={actions.busy !== null || actions.activationPending}
        />
      ) : null}
      {/*
        Cancelling is only ours to offer for a subscription bought here: an
        org syncing on a RevenueCat/native purchase manages it through the
        store, and its provider link is rendered above.
      */}
      {checkout.available && isOrgAdmin && billing.view?.canSync ? (
        <BillingCancelSubscription
          cancel={cancel}
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
