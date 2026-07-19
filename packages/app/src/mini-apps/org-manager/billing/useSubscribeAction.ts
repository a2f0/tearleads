import {
  PurchaseAbortedError,
  PurchaseCancelledError,
  type PurchasesCapability,
  type SyncSubscriptionOption,
} from "@tearleads/client-sdk";
import { type RefObject, useCallback } from "react";
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
      }));
      void purchaseForOrganization({
        cancelPurchaseRef,
        checkoutHost: checkoutHostRef?.current ?? undefined,
        option,
        purchases,
        refresh,
        scope,
        scopeRef,
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
  updateActionState: UpdateActionState;
  userId: string;
}): Promise<void> {
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
  try {
    // Raced so a hung identification cannot hold the panel busy with no way
    // out — Cancel settles the flow immediately even in this phase.
    const identify = purchases.identify({ userId });
    identify.catch(() => {
      // Outcome delivered through the race; without this handler a losing
      // identify would surface as an unhandled rejection.
    });
    await Promise.race([identify, cancelSignal]);
    if (cancelled || !scopeMatches(scopeRef.current, scope)) {
      return;
    }
    const purchase = purchases.purchaseSync({
      organizationId: scope.organizationId,
      packageId: option.packageId,
      abortSignal: abortController.signal,
      ...(checkoutHost ? { checkoutHost } : {}),
    });
    purchase.then(
      (lateResult) => {
        if (!cancelled) {
          // Outcome already delivered through the race below.
          return;
        }
        // The provider's own late teardown empties the shared host, wiping a
        // replacement checkout's UI — retire that flow so it does not sit
        // busy and invisible. (No-op when none is in flight.)
        cancelPurchaseRef.current?.();
        // A cancellation only dismisses the checkout UI; a payment the
        // provider had already taken can still land afterwards. Honor it —
        // the entitlement is granted server-side regardless — by driving the
        // same activation flow the un-cancelled path would have run.
        if (
          !lateResult.syncEntitlementActive ||
          !scopeMatches(scopeRef.current, scope)
        ) {
          return;
        }
        updateActionState(scope, (current) => ({
          ...current,
          activationPending: true,
        }));
        void refresh();
      },
      (error) => {
        if (!cancelled) {
          // Outcome already delivered through the race; without this handler
          // the loser would surface as an unhandled rejection.
          return;
        }
        // A late PurchaseAbortedError is the pre-mount abort path: the
        // purchase layers raise it for every post-abort pre-mount failure
        // (see client-sdk purchaseSync and the web backend), so it reliably
        // means no checkout UI ever existed and no teardown can wipe the
        // shared host — a retry in flight must keep running. Any other
        // rejection (including the provider's own cancellation of a MOUNTED
        // checkout) comes with a teardown that empties the shared host (same
        // hazard as the late-success path above), so retire the replacement
        // flow.
        if (error instanceof PurchaseAbortedError) {
          return;
        }
        cancelPurchaseRef.current?.();
      },
    );
    const result = await Promise.race([purchase, cancelSignal]);
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
    // Dismissing the checkout is a normal exit, not a failure — remove the
    // embedded checkout UI the provider left behind and clear the busy state
    // (finally) without surfacing an error.
    if (error instanceof PurchaseCancelledError) {
      checkoutHost?.replaceChildren();
      return;
    }
    // Previously swallowed silently, which made a rejected purchase
    // indistinguishable from a no-op. Log the real PurchasesError (e.g. a
    // ConfigurationError from a key/offering mismatch) so it is diagnosable,
    // while still surfacing the generic label to the user.
    console.error("Failed to complete the organization sync purchase:", error);
    updateActionState(scope, (current) => ({
      ...current,
      actionError: ORG_MANAGER_LABELS.failedSubscribe,
    }));
  } finally {
    // A newer flow may have installed its own cancel action (scope switched
    // mid-purchase); only clear the ref while it still belongs to this flow.
    if (cancelPurchaseRef.current === cancelPurchase) {
      cancelPurchaseRef.current = null;
    }
    updateActionState(scope, (current) => ({ ...current, busy: null }));
  }
}
