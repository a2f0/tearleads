import type { OrganizationBillingView } from "@tearleads/client-sdk";
import { type RefObject, useCallback, useRef } from "react";
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
import { useOpenSubscriptionManagement } from "./useOpenSubscriptionManagement";

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
  readonly refresh: () => Promise<void>;
  readonly onPaid: () => void;
  readonly management: ReturnType<typeof useBillingManagementUrl>;
}) {
  const { view } = input;
  const cancel = useCancelSubscription({ refresh: input.refresh });
  // Gate on `isActive`, NOT `canSync`. `canSync` folds in trialing, which would
  // hide the checkout for the whole trial; a trialing org has no subscription
  // yet (the trial is a local status, no Stripe sub) and its admin may want to
  // commit before the trial ends. So this offers the checkout in every state
  // where a paid subscription can start (local, trialing, lapsed).
  //
  // This is close to, but not exactly, the server's checkout gate: the server
  // refuses only a raw stored `status === "active"`, while `isActive` here also
  // requires the current period not to have ended. They diverge only in a
  // transient window — a still-`active` row whose period expired before the
  // renewal/revoke webhook landed — where this offers a checkout the server
  // then 409s. That window predates this gate (the old `!canSync` had it too)
  // and self-heals on the next billing refresh, so it is left as-is.
  //
  // `enabled` is the render gate too: when it flips off mid-flow (the payment
  // lands, the org becomes active) the hook tears the element down rather than
  // having its host yanked out from under a live session.
  const checkoutEnabled = Boolean(
    input.isOrgAdmin && view !== null && !view.isActive,
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
  // Offer inline cancel only when the server recognizes the immutable Stripe
  // Price. `isActive`, not `canSync`, excludes a local free trial; a native
  // subscription instead exposes its store management URL.
  const showInlineCancel =
    input.isOrgAdmin &&
    (view?.isActive ?? false) &&
    input.management.canCancelDirectly;
  return {
    cancel,
    checkout,
    checkoutActive,
    checkoutEnabled,
    managementUrl: input.management.managementUrl,
    showInlineCancel,
  };
}

function BillingPanelSubscriptionControls(input: {
  readonly actions: ReturnType<typeof useBillingActions>;
  readonly billing: ReturnType<typeof useOrganizationBilling>;
  readonly checkoutHostRef: RefObject<HTMLDivElement | null>;
  readonly direct: ReturnType<typeof useDirectCheckoutWiring>;
  readonly isOrgAdmin: boolean;
  readonly isPersonalOrganization: boolean | null;
  readonly nativePurchaseAllowed: boolean;
  readonly onRefresh: () => void;
  readonly organizationId: string;
  readonly subscriptionManagement: ReturnType<
    typeof useOpenSubscriptionManagement
  >;
}) {
  const { actions, billing, direct } = input;
  const nativePurchaseAvailable =
    actions.purchaseAvailable &&
    input.nativePurchaseAllowed &&
    !direct.checkout.available;
  const purchaseSectionHidden =
    (billing.view?.isActive ?? false) && !nativePurchaseAvailable;
  return (
    <>
      <BillingView
        actionError={input.subscriptionManagement.error ?? actions.actionError}
        activationPending={actions.activationPending}
        busy={direct.checkoutActive ? "checkout" : actions.busy}
        canSubscribe={actions.canSubscribe}
        checkoutActive={actions.checkoutActive}
        checkoutHostRef={input.checkoutHostRef}
        directCheckoutAvailable={direct.checkout.available}
        embeddedCheckout={actions.embeddedCheckout}
        error={billing.error}
        isOrgAdmin={input.isOrgAdmin}
        loading={billing.loading}
        managementUrl={direct.managementUrl}
        minimumSeatCount={
          billing.billing?.organizationId === input.organizationId
            ? billing.billing.activeMemberCount
            : null
        }
        nativePurchaseRestricted={
          actions.purchaseAvailable && input.isPersonalOrganization === false
        }
        onCancelCheckout={actions.cancelCheckout}
        onManageSubscription={input.subscriptionManagement.open}
        onRefresh={input.onRefresh}
        onRestore={actions.restore}
        onStartTrial={actions.startTrial}
        onSubscribe={actions.subscribe}
        options={actions.options}
        purchaseAvailable={nativePurchaseAvailable}
        purchaseSectionHidden={purchaseSectionHidden}
        restoreAvailable={actions.purchaseAvailable}
        view={billing.view}
      />
      {direct.checkoutEnabled ? (
        <BillingDirectCheckout
          checkout={direct.checkout}
          disabled={actions.busy !== null || actions.activationPending}
        />
      ) : null}
      {direct.showInlineCancel ? (
        <BillingCancelSubscription
          cancel={direct.cancel}
          disabled={actions.busy !== null}
        />
      ) : null}
    </>
  );
}

export function BillingPanel({
  isOrgAdmin,
  isPersonalOrganization = true,
  organizationId,
  userId,
}: {
  isOrgAdmin: boolean;
  isPersonalOrganization?: boolean | null;
  organizationId: string;
  userId: string | null;
}) {
  const billing = useOrganizationBilling();
  const { refresh } = billing;
  const handleRefresh = useCallback(() => {
    void refresh();
  }, [refresh]);
  const subscriptionManagement = useOpenSubscriptionManagement(handleRefresh);
  // Resolve the owner of an existing subscription before offering provider
  // actions. Native plans may change tier through the store; an active Stripe
  // plan must never be duplicated by starting a second native subscription.
  const management = useBillingManagementUrl(
    organizationId,
    isOrgAdmin &&
      billing.view !== null &&
      !billing.view.isLocal &&
      !billing.view.isTrialing,
    billing.billing,
  );
  const nativePurchaseAllowed =
    isPersonalOrganization === true &&
    (!(billing.view?.isActive ?? false) ||
      management.subscriptionSource === "native");
  // Where the Web Billing checkout embeds so a purchase runs inside the panel
  // (the view keeps the div mounted; the hook reads it at purchase time).
  const checkoutHostRef = useRef<HTMLDivElement | null>(null);
  const actions = useBillingActions({
    isOrgAdmin,
    nativePurchaseAllowed,
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
  const direct = useDirectCheckoutWiring({
    isOrgAdmin,
    organizationId,
    userId,
    view: billing.view,
    refresh,
    onPaid: actions.markActivationPending,
    management,
  });

  return (
    <div>
      <BillingPanelSubscriptionControls
        actions={actions}
        billing={billing}
        checkoutHostRef={checkoutHostRef}
        direct={direct}
        isOrgAdmin={isOrgAdmin}
        isPersonalOrganization={isPersonalOrganization}
        nativePurchaseAllowed={nativePurchaseAllowed}
        onRefresh={handleRefresh}
        organizationId={organizationId}
        subscriptionManagement={subscriptionManagement}
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
