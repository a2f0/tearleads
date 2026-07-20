import type { OrganizationBillingView } from "@tearleads/client-sdk";
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
  readonly view: OrganizationBillingView | null;
  readonly reloadToken: unknown;
  readonly refresh: () => Promise<void>;
  readonly onPaid: () => void;
}) {
  const { view } = input;
  const cancel = useCancelSubscription({ refresh: input.refresh });
  // Resolve the provider manage link here too: it is both rendered by the view
  // and the signal that a subscription is provider-managed rather than ours.
  // Only for an admin of an org with a provider-managed sub (active or lapsed)
  // — not a local or free-trial org, which has no provider customer.
  const managementUrl = useBillingManagementUrl(
    input.organizationId,
    input.isOrgAdmin && view !== null && !view.isLocal && !view.isTrialing,
    input.reloadToken,
  );
  // `enabled` is the render gate too: when it flips off mid-flow — e.g. another
  // admin's purchase lands and the org starts syncing — the hook tears the
  // element down rather than having its host yanked out from under a live
  // session.
  const checkoutEnabled = Boolean(
    input.isOrgAdmin && view !== null && !view.canSync,
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
  // Offer inline cancel ONLY for a subscription bought through our own
  // checkout. The snapshot carries no provider field, so two signals stand in
  // for one:
  //   - `isActive`, not `canSync` — a TRIALING org has no subscription to
  //     cancel, and canSync folds trialing in.
  //   - no provider manage link — a RevenueCat-managed sub (store purchase, or
  //     a legacy RC web sub) resolves one, rendered above; a Stripe-direct sub
  //     has no RC customer, so it is absent. This keeps a phone-bought sub,
  //     opened on web, from showing a Cancel that could only 404.
  const showInlineCancel =
    checkout.available &&
    input.isOrgAdmin &&
    (view?.isActive ?? false) &&
    managementUrl === null;
  return {
    cancel,
    checkout,
    checkoutActive,
    checkoutEnabled,
    managementUrl,
    showInlineCancel,
  };
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
  const handleRefresh = useCallback(() => {
    void refresh();
  }, [refresh]);
  const {
    cancel,
    checkout,
    checkoutActive,
    checkoutEnabled,
    managementUrl,
    showInlineCancel,
  } = useDirectCheckoutWiring({
    isOrgAdmin,
    organizationId,
    userId,
    view: billing.view,
    // The billing snapshot is the reload token so a refresh re-resolves links.
    reloadToken: billing.billing,
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
      {/* Gated in useDirectCheckoutWiring: active, ours (no provider link). */}
      {showInlineCancel ? (
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
