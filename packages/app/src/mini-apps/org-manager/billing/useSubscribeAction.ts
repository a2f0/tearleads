import {
  PurchaseAbortedError,
  PurchaseAlreadyOwnedError,
  PurchaseCancelledError,
  type PurchasesCapability,
  type SyncSubscriptionOption,
} from "@tearleads/client-sdk";
import type { NativeSubscriptionStore } from "@tearleads/validators/billing";
import { type RefObject, useCallback, useState } from "react";
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

interface UseNativeSubscriptionMoveInput {
  readonly claimNativeSubscription: (
    store: NativeSubscriptionStore,
  ) => Promise<boolean>;
  readonly currentScope: BillingActionScope;
  readonly purchases: PurchasesCapability;
  readonly refresh: () => Promise<void>;
  readonly scopeRef: BillingScopeRef;
  readonly updateActionState: UpdateActionState;
  readonly userId: string | null;
}

/** Owns confirmation and the verified native restore/claim sequence. */
export function useNativeSubscriptionMove(
  input: UseNativeSubscriptionMoveInput,
) {
  const {
    claimNativeSubscription,
    currentScope,
    purchases,
    refresh,
    scopeRef,
    updateActionState,
    userId,
  } = input;
  const { logError } = useLog();
  const [openScope, setOpenScope] = useState<BillingActionScope | null>(null);
  const open = openScope !== null && scopeMatches(openScope, currentScope);
  const request = useCallback(() => setOpenScope(currentScope), [currentScope]);
  const dismiss = useCallback(() => setOpenScope(null), []);

  const confirm = useCallback(() => {
    const scope = currentScope;
    if (!scopeMatches(scopeRef.current, scope)) return;
    updateActionState(scope, (current) => ({
      ...current,
      actionError: null,
      busy: "restore",
    }));
    void (async () => {
      try {
        if (!userId || !purchases.nativeStore) {
          throw new Error("Native subscription restore is unavailable");
        }
        await purchases.identify({ userId });
        const restored = await purchases.restore({
          organizationId: scope.organizationId,
        });
        if (!restored.syncEntitlementActive) {
          throw new Error("The restored receipt has no sync entitlement");
        }
        const claimed = await claimNativeSubscription(purchases.nativeStore);
        if (!claimed) {
          throw new Error("The server did not accept the native subscription");
        }
        if (scopeMatches(scopeRef.current, scope)) await refresh();
      } catch (error) {
        logError(formatBillingPurchaseFailure(error, false));
        updateActionState(scope, (current) => ({
          ...current,
          actionError: ORG_MANAGER_LABELS.failedRestorePurchases,
        }));
      } finally {
        dismiss();
        updateActionState(scope, (current) => ({
          ...current,
          busy: null,
        }));
      }
    })();
  }, [
    claimNativeSubscription,
    currentScope,
    dismiss,
    logError,
    purchases,
    refresh,
    scopeRef,
    updateActionState,
    userId,
  ]);

  return { confirm, dismiss, open, request };
}

function createAttemptHost(
  checkoutHost: HTMLElement | undefined,
): HTMLDivElement | undefined {
  if (!checkoutHost) {
    return undefined;
  }
  const attemptHost = checkoutHost.ownerDocument.createElement("div");
  checkoutHost.appendChild(attemptHost);
  return attemptHost;
}

function observeLatePurchase({
  cancelPurchaseRef,
  isCancelled,
  purchase,
  refresh,
  scope,
  scopeRef,
  trace,
  traceError,
  updateActionState,
}: {
  cancelPurchaseRef: CancelPurchaseRef;
  isCancelled: () => boolean;
  purchase: Promise<{ syncEntitlementActive: boolean }>;
  refresh: () => Promise<void>;
  scope: BillingActionScope;
  scopeRef: BillingScopeRef;
  trace: (line: string) => void;
  traceError: (line: string) => void;
  updateActionState: UpdateActionState;
}): void {
  purchase.then(
    (result) => {
      if (!isCancelled()) {
        return;
      }
      trace(formatBillingPurchaseSuccess(result.syncEntitlementActive, true));
      if (
        !result.syncEntitlementActive ||
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
    (error) => {
      if (isCancelled()) {
        traceError(formatBillingPurchaseFailure(error, true));
      }
    },
  );
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
  onAlreadyOwned,
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
  onAlreadyOwned: () => void;
}): (option: SyncSubscriptionOption) => void {
  const { log, logError } = useLog();
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
        traceError: logError,
        updateActionState,
        userId,
        onAlreadyOwned,
      });
    },
    [
      canSubscribe,
      cancelPurchaseRef,
      checkoutHostRef,
      currentScope,
      log,
      logError,
      purchases,
      refresh,
      scopeRef,
      updateActionState,
      userId,
      onAlreadyOwned,
    ],
  );
}

function handleExpectedPurchaseError(input: {
  readonly error: unknown;
  readonly onAlreadyOwned: () => void;
  readonly trace: (line: string) => void;
}): boolean {
  if (input.error instanceof PurchaseAbortedError) {
    input.trace(formatBillingPurchaseStage("aborted"));
    return true;
  }
  if (input.error instanceof PurchaseCancelledError) {
    input.trace(formatBillingPurchaseStage("cancelled"));
    return true;
  }
  if (input.error instanceof PurchaseAlreadyOwnedError) {
    input.trace(formatBillingPurchaseStage("already-owned"));
    input.onAlreadyOwned();
    return true;
  }
  return false;
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
  traceError,
  updateActionState,
  userId,
  onAlreadyOwned,
}: {
  cancelPurchaseRef: CancelPurchaseRef;
  checkoutHost: HTMLElement | undefined;
  option: SyncSubscriptionOption;
  purchases: PurchasesCapability;
  refresh: () => Promise<void>;
  scope: BillingActionScope;
  scopeRef: BillingScopeRef;
  trace: (line: string) => void;
  traceError: (line: string) => void;
  updateActionState: UpdateActionState;
  userId: string;
  onAlreadyOwned: () => void;
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
    if (cancelled) {
      trace(formatBillingPurchaseStage("cancelled"));
      return;
    }
    if (!scopeMatches(scopeRef.current, scope)) {
      trace(formatBillingPurchaseStage("superseded"));
      return;
    }
    trace(formatBillingPurchaseStage("provider-started"));
    const purchase = purchases.purchaseSync({
      organizationId: scope.organizationId,
      packageId: option.packageId,
      abortSignal: abortController.signal,
      ...(attemptHost ? { checkoutHost: attemptHost } : {}),
    });
    // A cancellation only dismisses the checkout UI. If the provider had
    // already taken payment, the promise can still settle after the local race.
    observeLatePurchase({
      cancelPurchaseRef,
      isCancelled: () => cancelled,
      purchase,
      refresh,
      scope,
      scopeRef,
      trace,
      traceError,
      updateActionState,
    });
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
    if (handleExpectedPurchaseError({ error, onAlreadyOwned, trace })) return;
    // Previously swallowed silently, which made a rejected purchase
    // indistinguishable from a no-op. Log the real PurchasesError (e.g. a
    // ConfigurationError from a key/offering mismatch) so it is diagnosable,
    // while still surfacing the generic label to the user.
    traceError(formatBillingPurchaseFailure(error));
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
