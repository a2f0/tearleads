import {
  PurchaseCancelledError,
  type PurchasesCapability,
  type SyncSubscriptionOption,
} from "@tearleads/client-sdk";
import { type RefObject, useCallback } from "react";
import { useLog } from "../../../providers/logging/LogProvider";
import {
  formatBillingPurchaseFailure,
  formatBillingPurchaseStage,
  formatBillingPurchaseSuccess,
} from "../../../utils/billingPurchaseTrace";
import { ORG_MANAGER_LABELS } from "../labels";
import {
  type BillingActionScope,
  type BillingScopeRef,
  scopeMatches,
  type UpdateActionState,
} from "./billingActionScope";

/**
 * Holds the cancel action of the purchase currently in flight, or null. The
 * embedded Web Billing checkout hides the provider's own close control, so the
 * billing UI must offer the exit path itself; invoking the held action settles
 * the flow as a cancellation.
 */
type CancelPurchaseRef = RefObject<(() => void) | null>;

function createAttemptHost(
  checkoutHost: HTMLElement | undefined,
): HTMLDivElement | undefined {
  const attemptHost = checkoutHost?.ownerDocument.createElement("div");
  if (checkoutHost && attemptHost) {
    checkoutHost.appendChild(attemptHost);
  }
  return attemptHost;
}

export function useSubscribeAction({
  canSubscribe,
  cancelPurchaseRef,
  checkoutHostRef,
  currentScope,
  purchases,
  refresh,
  scopeRef,
  updateActionState,
  userId,
}: {
  canSubscribe: boolean;
  cancelPurchaseRef: CancelPurchaseRef;
  checkoutHostRef: RefObject<HTMLElement | null> | undefined;
  currentScope: BillingActionScope;
  purchases: PurchasesCapability;
  refresh: () => Promise<void>;
  scopeRef: BillingScopeRef;
  updateActionState: UpdateActionState;
  userId: string | null;
}): (option: SyncSubscriptionOption) => void {
  const { log } = useLog();
  return useCallback(
    (option) => {
      const scope = currentScope;
      if (!scopeMatches(scopeRef.current, scope) || !canSubscribe || !userId) {
        return;
      }
      updateActionState(scope, (current) => ({
        ...current,
        busy: `subscribe:${option.packageId}`,
        actionError: null,
        checkoutActive: true,
      }));
      void purchaseForOrganization({
        cancelPurchaseRef,
        checkoutHost: checkoutHostRef?.current ?? undefined,
        option,
        purchases,
        refresh,
        scope,
        scopeRef,
        trace: log,
        updateActionState,
        userId,
      });
    },
    [
      canSubscribe,
      cancelPurchaseRef,
      checkoutHostRef,
      currentScope,
      purchases,
      refresh,
      scopeRef,
      log,
      updateActionState,
      userId,
    ],
  );
}

/**
 * Runs one purchase attempt end to end. The embedded Web Billing checkout has
 * no provider-side abort API, which shapes everything here:
 *
 * - Cancellation is a race, not a provider call. The cancel action rejects a
 *   local signal; the provider promise stays pending (its UI is gone) or
 *   settles late on its own.
 * - An {@link AbortController} is passed to the backend so a cancel that lands
 *   *before* the checkout mounts stops the mount entirely — otherwise the SDK
 *   would render a checkout nothing controls.
 * - A payment the buyer had already submitted can complete after the UI was
 *   dismissed. That is safe for org attribution because the purchase carries
 *   its org in immutable per-transaction metadata (see client-sdk
 *   `purchaseSync`), so a late event is attributed to the org it was started
 *   for — the flow only has to reflect the outcome in the panel state.
 */
async function purchaseForOrganization({
  cancelPurchaseRef,
  checkoutHost,
  option,
  purchases,
  refresh,
  scope,
  scopeRef,
  trace,
  updateActionState,
  userId,
}: {
  cancelPurchaseRef: CancelPurchaseRef;
  checkoutHost: HTMLElement | undefined;
  option: SyncSubscriptionOption;
  purchases: PurchasesCapability;
  refresh: () => Promise<void>;
  scope: BillingActionScope;
  scopeRef: BillingScopeRef;
  trace: (line: string) => void;
  updateActionState: UpdateActionState;
  userId: string;
}): Promise<void> {
  trace(formatBillingPurchaseStage("started"));
  let cancelled = false;
  let rejectCancelSignal: ((error: Error) => void) | undefined;
  const cancelSignal = new Promise<never>((_, reject) => {
    rejectCancelSignal = reject;
  });
  cancelSignal.catch(() => {
    // Cancellation before the race begins (during identify) must not surface
    // as an unhandled rejection; the flow reads `cancelled` instead.
  });
  // Aborting tells the backend not to mount a checkout it has not mounted
  // yet; it cannot stop a checkout that is already on screen (no SDK API).
  const abortController = new AbortController();
  const cancelPurchase = () => {
    cancelled = true;
    abortController.abort();
    rejectCancelSignal?.(new PurchaseCancelledError());
  };
  cancelPurchaseRef.current = cancelPurchase;
  // Each attempt mounts into its own child of the panel's host. The SDK
  // empties its target element when a purchase finishes or fails — with a
  // shared element, an ABANDONED attempt settling late would wipe a
  // replacement checkout's UI. A per-attempt child keeps that teardown scoped
  // to the attempt's own (by then detached) element.
  const attemptHost = createAttemptHost(checkoutHost);
  try {
    // Raced so a hung identification cannot hold the panel busy with no way
    // out — Cancel settles the flow immediately even in this phase.
    const identify = purchases.identify({ userId });
    identify.catch(() => {
      // Outcome delivered through the race; without this handler a losing
      // identify would surface as an unhandled rejection.
    });
    await Promise.race([identify, cancelSignal]);
    trace(formatBillingPurchaseStage("identified"));
    if (cancelled || !scopeMatches(scopeRef.current, scope)) {
      return;
    }
    trace(formatBillingPurchaseStage("provider-started"));
    const purchase = purchases.purchaseSync({
      organizationId: scope.organizationId,
      packageId: option.packageId,
      abortSignal: abortController.signal,
      ...(attemptHost ? { checkoutHost: attemptHost } : {}),
    });
    purchase.then(
      (lateResult) => {
        // Only a purchase that was cancelled and then landed anyway needs
        // handling here; every live outcome is delivered through the race
        // below.
        if (!cancelled) {
          return;
        }
        // A cancellation only dismisses the checkout UI; a payment the
        // provider had already taken can still land afterwards. Honor it —
        // the entitlement is granted server-side regardless — by driving the
        // same activation flow the un-cancelled path would have run. A
        // replacement checkout for this same scope could now only duplicate
        // the entitlement, so retire it first.
        if (
          !lateResult.syncEntitlementActive ||
          !scopeMatches(scopeRef.current, scope)
        ) {
          return;
        }
        cancelPurchaseRef.current?.();
        updateActionState(scope, (current) => ({
          ...current,
          activationPending: true,
        }));
        void refresh();
      },
      () => {
        // A cancelled attempt failing late affects nothing outside its own
        // (already detached) attempt host; this handler only keeps the loser
        // of the race from surfacing as an unhandled rejection.
      },
    );
    const result = await Promise.race([purchase, cancelSignal]);
    trace(formatBillingPurchaseSuccess(result.syncEntitlementActive));
    // The checkout is settled — Cancel has nothing left to reach, so retire
    // the affordance now rather than after the billing refresh below.
    updateActionState(scope, (current) => ({
      ...current,
      checkoutActive: false,
    }));
    if (!scopeMatches(scopeRef.current, scope)) {
      return;
    }
    if (!result.syncEntitlementActive) {
      updateActionState(scope, (current) => ({
        ...current,
        actionError: ORG_MANAGER_LABELS.failedSubscribe,
      }));
      return;
    }
    updateActionState(scope, (current) => ({
      ...current,
      activationPending: true,
    }));
    await refresh();
  } catch (error) {
    // Dismissing the checkout is a normal exit, not a failure — the attempt
    // host is removed (finally) and the busy state cleared without surfacing
    // an error.
    if (error instanceof PurchaseCancelledError) {
      trace(formatBillingPurchaseStage("cancelled"));
      return;
    }
    // Previously swallowed silently, which made a rejected purchase
    // indistinguishable from a no-op. Log the real PurchasesError (e.g. a
    // ConfigurationError from a key/offering mismatch) so it is diagnosable,
    // while still surfacing the generic label to the user.
    trace(formatBillingPurchaseFailure(error));
    console.error("Failed to complete the organization sync purchase:", error);
    updateActionState(scope, (current) => ({
      ...current,
      actionError: ORG_MANAGER_LABELS.failedSubscribe,
    }));
  } finally {
    // This attempt is settled from the panel's point of view; whatever the
    // SDK does to the attempt host later happens off-DOM.
    attemptHost?.remove();
    // A newer flow may have installed its own cancel action (scope switched
    // mid-purchase); only clear the ref while it still belongs to this flow.
    if (cancelPurchaseRef.current === cancelPurchase) {
      cancelPurchaseRef.current = null;
    }
    updateActionState(scope, (current) => ({
      ...current,
      busy: null,
      checkoutActive: false,
    }));
  }
}
