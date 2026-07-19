import {
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
  // The provider promise cannot be settled from outside once its checkout is
  // embedded, so cancellation is a race: the registered cancel action rejects
  // this signal and the flow treats it as a dismissal. The provider promise is
  // deliberately left running — a payment already in flight can still complete.
  let cancelled = false;
  let rejectCancelSignal: ((error: Error) => void) | undefined;
  const cancelSignal = new Promise<never>((_, reject) => {
    rejectCancelSignal = reject;
  });
  cancelSignal.catch(() => {
    // Cancellation before the race begins (during identify) must not surface
    // as an unhandled rejection; the flow reads `cancelled` instead.
  });
  const cancelPurchase = () => {
    cancelled = true;
    rejectCancelSignal?.(new PurchaseCancelledError());
  };
  cancelPurchaseRef.current = cancelPurchase;
  try {
    await purchases.identify({ userId });
    if (cancelled || !scopeMatches(scopeRef.current, scope)) {
      return;
    }
    const purchase = purchases.purchaseSync({
      organizationId: scope.organizationId,
      packageId: option.packageId,
      ...(checkoutHost ? { checkoutHost } : {}),
    });
    purchase.then(
      (lateResult) => {
        // A cancellation only dismisses the checkout UI; a payment the
        // provider had already taken can still land afterwards. Honor it —
        // the entitlement is granted server-side regardless — by driving the
        // same activation flow the un-cancelled path would have run.
        if (
          !cancelled ||
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
      () => {
        // Outcome already delivered through the race (or dropped after a
        // cancellation); without this handler the loser would surface as an
        // unhandled rejection.
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
