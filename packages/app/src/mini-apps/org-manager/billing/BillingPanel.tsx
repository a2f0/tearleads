import type { OrganizationBillingView } from "@tearleads/client-sdk";
import type { NativeSubscriptionStore } from "@tearleads/validators/billing";
import {
  type FormEvent,
  type RefObject,
  useCallback,
  useId,
  useRef,
} from "react";
import {
  MiniAppActions,
  MiniAppButton,
  MiniAppModalBackdrop,
  MiniAppModalForm,
  MiniAppModalPanel,
} from "../../../components/mini-app/MiniAppLayout";
import { useOrganizationBilling } from "../../../providers/billing/BillingProvider";
import { useTearleads } from "../../../providers/sdk/TearleadsProvider";
import { useBillingActions } from "../hooks/useBillingActions";
import { ORG_MANAGER_LABELS } from "../labels";
import { BillingCancelSubscription } from "./BillingCancelSubscription";
import { BillingDirectCheckout } from "./BillingDirectCheckout";
import { BillingHistory } from "./BillingHistory";
import { BillingView } from "./BillingView";
import { useBillingHistory } from "./useBillingHistory";
import { useBillingManagementUrl } from "./useBillingManagementUrl";
import { useCancelSubscription } from "./useCancelSubscription";
import { useDirectCheckoutFlow } from "./useDirectCheckout";
import { useOpenSubscriptionManagement } from "./useOpenSubscriptionManagement";

export function allowsNativePurchase(input: {
  readonly isActive: boolean;
  readonly isPersonalOrganization: boolean | null;
  readonly status: OrganizationBillingView["status"];
  readonly subscriptionSource: "native" | "stripe" | null;
}): boolean {
  return (
    input.isPersonalOrganization === true &&
    input.status !== "past_due" &&
    input.subscriptionSource !== "stripe" &&
    (!input.isActive || input.subscriptionSource === "native")
  );
}

function BillingSubscriptionMoveDialog({
  busy,
  open,
  onCancel,
  onConfirm,
}: {
  readonly busy: boolean;
  readonly open: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  const titleId = useId();
  const messageId = useId();
  if (!open) return null;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!busy) onConfirm();
  };
  return (
    <MiniAppModalBackdrop role="presentation">
      <MiniAppModalPanel
        aria-describedby={messageId}
        aria-labelledby={titleId}
        aria-modal="true"
        role="dialog"
      >
        <MiniAppModalForm onSubmit={submit}>
          <h2 id={titleId}>
            {ORG_MANAGER_LABELS.billingSubscriptionMoveTitle}
          </h2>
          <p id={messageId}>
            {ORG_MANAGER_LABELS.billingSubscriptionMoveMessage}
          </p>
          <MiniAppActions>
            <MiniAppButton disabled={busy} onClick={onCancel} type="button">
              {ORG_MANAGER_LABELS.cancel}
            </MiniAppButton>
            <MiniAppButton disabled={busy} type="submit">
              {busy
                ? ORG_MANAGER_LABELS.billingRestoring
                : ORG_MANAGER_LABELS.billingSubscriptionMoveConfirm}
            </MiniAppButton>
          </MiniAppActions>
        </MiniAppModalForm>
      </MiniAppModalPanel>
    </MiniAppModalBackdrop>
  );
}

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
  // commit before the trial ends. So this offers the checkout in states where
  // a paid subscription can start (local, trialing, fully lapsed). `past_due`
  // is excluded because the existing Stripe subscription may still bill.
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
    input.isOrgAdmin &&
      view !== null &&
      !view.isActive &&
      view.status !== "past_due" &&
      input.management.subscriptionSource !== "stripe",
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
  // Price or live binding. This intentionally includes past-due Stripe plans:
  // they can still bill and are exactly the state where an admin needs a
  // direct cancellation path. Native subscriptions use their store URL.
  const showInlineCancel =
    input.isOrgAdmin && input.management.canCancelDirectly;
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
        onRestore={actions.requestSubscriptionMove}
        onStartTrial={actions.startTrial}
        onSubscribe={actions.subscribe}
        options={actions.options}
        purchaseAvailable={nativePurchaseAvailable}
        purchaseSectionHidden={purchaseSectionHidden}
        restoreAvailable={
          input.isOrgAdmin &&
          actions.purchaseAvailable &&
          input.isPersonalOrganization === true
        }
        view={billing.view}
      />
      <BillingSubscriptionMoveDialog
        busy={actions.busy === "restore"}
        onCancel={actions.dismissSubscriptionMove}
        onConfirm={actions.confirmSubscriptionMove}
        open={actions.subscriptionMoveOpen}
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
  isPersonalOrganization = null,
  organizationId,
  userId,
}: {
  isOrgAdmin: boolean;
  isPersonalOrganization?: boolean | null;
  organizationId: string;
  userId: string | null;
}) {
  const tearleads = useTearleads();
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
    billing.view !== null &&
    allowsNativePurchase({
      isActive: billing.view.isActive,
      isPersonalOrganization,
      status: billing.view.status,
      subscriptionSource: management.subscriptionSource,
    });
  // Where the Web Billing checkout embeds so a purchase runs inside the panel
  // (the view keeps the div mounted; the hook reads it at purchase time).
  const checkoutHostRef = useRef<HTMLDivElement | null>(null);
  const claimNativeSubscription = useCallback(
    async (store: NativeSubscriptionStore) =>
      (
        await tearleads.organizations.claimNativeSubscription(
          organizationId,
          store,
        )
      )?.organizationId === organizationId,
    [organizationId, tearleads],
  );
  const actions = useBillingActions({
    isOrgAdmin,
    nativePurchaseAllowed,
    billingCanSync: billing.view?.canSync ?? false,
    claimNativeSubscription,
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
