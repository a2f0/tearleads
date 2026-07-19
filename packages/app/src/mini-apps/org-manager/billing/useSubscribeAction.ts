import {
  PurchaseCancelledError,
  type PurchasesCapability,
  type SyncSubscriptionOption,
} from "@tearleads/client-sdk";
import { type RefObject, useCallback, useRef } from "react";
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

/**
 * A cancelled purchase whose provider promise has not settled yet. The org
 * binding is a mutable customer-level subscriber attribute, so a purchase for
 * a *different* org must not rebind it while this one could still complete —
 * the webhook would attribute the landed payment to the wrong org.
 */
interface OrphanedPurchase {
  readonly organizationId: string;
  readonly expiresAtMs: number;
}

/**
 * How long a cancelled, unsettled purchase blocks purchases for other orgs.
 * A purchase whose payment was already submitted settles within seconds (the
 * provider polls its backend independently of the removed UI); one cancelled
 * before payment can never complete but also never settles, so the guard
 * expires rather than blocking forever.
 */
const ORPHAN_ATTRIBUTION_GRACE_MS = 30_000;

type OrphanedPurchaseRef = RefObject<OrphanedPurchase | null>;

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
  const orphanedPurchaseRef = useRef<OrphanedPurchase | null>(null);
  return useCallback(
    (option) => {
      const scope = currentScope;
      if (!scopeMatches(scopeRef.current, scope) || !canSubscribe || !userId) {
        return;
      }
      const orphan = orphanedPurchaseRef.current;
      if (
        orphan &&
        orphan.organizationId !== scope.organizationId &&
        Date.now() < orphan.expiresAtMs
      ) {
        updateActionState(scope, (current) => ({
          ...current,
          actionError: ORG_MANAGER_LABELS.billingCheckoutSettling,
        }));
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
        orphanedPurchaseRef,
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
  orphanedPurchaseRef,
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
  orphanedPurchaseRef: OrphanedPurchaseRef;
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
  let purchase: Promise<{ syncEntitlementActive: boolean }> | undefined;
  const clearOwnOrphan = () => {
    if (orphanedPurchaseRef.current?.organizationId === scope.organizationId) {
      orphanedPurchaseRef.current = null;
    }
  };
  try {
    await purchases.identify({ userId });
    if (cancelled || !scopeMatches(scopeRef.current, scope)) {
      return;
    }
    purchase = purchases.purchaseSync({
      organizationId: scope.organizationId,
      packageId: option.packageId,
      ...(checkoutHost ? { checkoutHost } : {}),
    });
    purchase.then(
      (lateResult) => {
        clearOwnOrphan();
        if (!cancelled) {
          // Outcome already delivered through the race.
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
      () => {
        clearOwnOrphan();
        if (!cancelled) {
          // Outcome already delivered through the race; without this handler
          // the loser would surface as an unhandled rejection.
          return;
        }
        // Same shared-host teardown hazard as the late-success path above.
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
      if (purchase) {
        // The abandoned provider purchase may still complete; keep other
        // orgs' purchases from rebinding the attribution until it settles
        // (or can no longer land).
        orphanedPurchaseRef.current = {
          organizationId: scope.organizationId,
          expiresAtMs: Date.now() + ORPHAN_ATTRIBUTION_GRACE_MS,
        };
      }
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
