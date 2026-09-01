import {
  PurchaseAbortedError,
  PurchaseAlreadyOwnedError,
  PurchaseCancelledError,
  PurchaseIdentityPendingError,
  PurchaseProviderStalledError,
  type PurchasesCapability,
  PurchasesUnavailableError,
  type SyncSubscriptionOption,
} from "@symcrypt/client-sdk";
import type { NativeSubscriptionStore } from "@symcrypt/validators/billing";
import { type RefObject, useCallback } from "react";
import { useLog } from "../../../providers/logging/LogProvider";
import {
  formatBillingPurchaseFailure,
  formatBillingPurchaseStage,
  formatBillingPurchaseSuccess,
} from "../../../utils/billingPurchaseTrace";
import {
  type CheckNativePurchaseEligibility,
  NativePurchaseEligibilityError,
  nativePurchaseEligibilityErrorLabel,
  requireNativePurchaseEligibility,
} from "../hooks/nativePurchaseEligibility";
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

function retireNativeCancellation(
  cancelPurchaseRef: CancelPurchaseRef,
  cancelPurchase: () => void,
  purchases: PurchasesCapability,
): void {
  if (
    purchases.supportsEmbeddedCheckout !== true &&
    cancelPurchaseRef.current === cancelPurchase
  ) {
    cancelPurchaseRef.current = null;
  }
}

function retireLegacyNativeCancellation(
  cancelPurchaseRef: CancelPurchaseRef,
  cancelPurchase: () => void,
  purchases: PurchasesCapability,
): void {
  if (
    purchases.nativeStore !== null &&
    purchases.supportsEmbeddedCheckout !== true &&
    purchases.supportsProviderPresentationCallback !== true
  ) {
    retireNativeCancellation(cancelPurchaseRef, cancelPurchase, purchases);
  }
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
  targetSeatCount,
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
  targetSeatCount: number;
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
        activationTargetSeatCount: targetSeatCount,
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
  checkNativePurchaseEligibility,
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
  checkNativePurchaseEligibility: CheckNativePurchaseEligibility;
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
        checkNativePurchaseEligibility,
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
      checkNativePurchaseEligibility,
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

function isUnregisteredPurchaseBridge(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "bridge-unregistered"
  );
}

function reportUnexpectedPurchaseError(error: unknown): void {
  if (
    error instanceof NativePurchaseEligibilityError ||
    error instanceof PurchaseIdentityPendingError ||
    isUnregisteredPurchaseBridge(error)
  ) {
    return;
  }
  console.error("Failed to complete the organization sync purchase:", error);
}

function purchaseErrorLabel(error: unknown): string {
  const eligibilityLabel = nativePurchaseEligibilityErrorLabel(error);
  if (eligibilityLabel) return eligibilityLabel;
  if (error instanceof PurchaseIdentityPendingError) {
    return ORG_MANAGER_LABELS.billingIdentityPending;
  }
  if (error instanceof PurchasesUnavailableError) {
    return isUnregisteredPurchaseBridge(error)
      ? ORG_MANAGER_LABELS.billingNativeCheckoutUnregistered
      : ORG_MANAGER_LABELS.billingNativeCheckoutUnavailable;
  }
  return error instanceof PurchaseProviderStalledError
    ? ORG_MANAGER_LABELS.billingProviderStalled
    : ORG_MANAGER_LABELS.failedSubscribe;
}

async function traceNativePurchaseEligibility(
  check: CheckNativePurchaseEligibility,
  store: NativeSubscriptionStore,
  cancelSignal: Promise<never>,
  trace: (line: string) => void,
): Promise<void> {
  const eligibility = requireNativePurchaseEligibility(check, store);
  eligibility.catch(() => {
    // A cancelled flow may leave the request settling after the panel is idle.
  });
  await Promise.race([eligibility, cancelSignal]);
  trace(formatBillingPurchaseStage("eligibility-checked"));
}

function createPurchaseCancellation() {
  let cancelled = false;
  let rejectSignal: ((error: Error) => void) | undefined;
  const signal = new Promise<never>((_, reject) => {
    rejectSignal = reject;
  });
  signal.catch(() => {
    // Cancellation before a race begins must not be unhandled.
  });
  const abortController = new AbortController();
  const cancel = () => {
    cancelled = true;
    abortController.abort();
    rejectSignal?.(new PurchaseCancelledError());
  };
  return {
    abortController,
    cancel,
    isCancelled: () => cancelled,
    signal,
  };
}

function startProviderPurchase(input: {
  readonly abortSignal: AbortSignal;
  readonly attemptHost: HTMLDivElement | undefined;
  readonly cancelPurchase: () => void;
  readonly cancelPurchaseRef: CancelPurchaseRef;
  readonly option: SyncSubscriptionOption;
  readonly purchases: PurchasesCapability;
  readonly scope: BillingActionScope;
}) {
  retireLegacyNativeCancellation(
    input.cancelPurchaseRef,
    input.cancelPurchase,
    input.purchases,
  );
  return input.purchases.purchaseSync({
    organizationId: input.scope.organizationId,
    packageId: input.option.packageId,
    abortSignal: input.abortSignal,
    onProviderPresented: () => {
      retireNativeCancellation(
        input.cancelPurchaseRef,
        input.cancelPurchase,
        input.purchases,
      );
    },
    ...(input.attemptHost ? { checkoutHost: input.attemptHost } : {}),
  });
}

function retireCheckout(
  updateActionState: UpdateActionState,
  scope: BillingActionScope,
): void {
  updateActionState(scope, (current) => ({
    ...current,
    checkoutActive: false,
  }));
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
  checkNativePurchaseEligibility,
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
  checkNativePurchaseEligibility: CheckNativePurchaseEligibility;
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
  const cancellation = createPurchaseCancellation();
  const cancelPurchase = cancellation.cancel;
  cancelPurchaseRef.current = cancelPurchase;
  // Each attempt mounts into its own child of the panel's host. The SDK
  // empties its target element when a purchase finishes or fails — with a
  // shared element, an ABANDONED attempt settling late would wipe a
  // replacement checkout's UI. A per-attempt child keeps that teardown scoped
  // to the attempt's own (by then detached) element.
  const attemptHost = createAttemptHost(checkoutHost);
  try {
    if (purchases.nativeStore) {
      await traceNativePurchaseEligibility(
        checkNativePurchaseEligibility,
        purchases.nativeStore,
        cancellation.signal,
        trace,
      );
    }
    if (!scopeMatches(scopeRef.current, scope)) {
      trace(formatBillingPurchaseStage("superseded"));
      return;
    }
    // Raced so a hung identification cannot hold the panel busy with no way
    // out — Cancel settles the flow immediately even in this phase.
    const identify = purchases.identify({ userId });
    identify.catch(() => {
      // Outcome delivered through the race; without this handler a losing
      // identify would surface as an unhandled rejection.
    });
    await Promise.race([identify, cancellation.signal]);
    trace(formatBillingPurchaseStage("identified"));
    if (cancellation.isCancelled()) {
      trace(formatBillingPurchaseStage("cancelled"));
      return;
    }
    if (!scopeMatches(scopeRef.current, scope)) {
      trace(formatBillingPurchaseStage("superseded"));
      return;
    }
    trace(formatBillingPurchaseStage("provider-started"));
    const purchase = startProviderPurchase({
      abortSignal: cancellation.abortController.signal,
      attemptHost,
      cancelPurchase,
      cancelPurchaseRef,
      option,
      purchases,
      scope,
    });
    // A cancellation only dismisses the checkout UI. If the provider had
    // already taken payment, the promise can still settle after the local race.
    observeLatePurchase({
      cancelPurchaseRef,
      isCancelled: cancellation.isCancelled,
      purchase,
      refresh,
      scope,
      scopeRef,
      targetSeatCount: option.seatLimit,
      trace,
      traceError,
      updateActionState,
    });
    const result = await Promise.race([purchase, cancellation.signal]);
    trace(formatBillingPurchaseSuccess(result.syncEntitlementActive));
    // The checkout is settled — Cancel has nothing left to reach, so retire
    // the affordance now rather than after the billing refresh below.
    retireCheckout(updateActionState, scope);
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
      activationTargetSeatCount: option.seatLimit,
    }));
    await refresh();
  } catch (error) {
    if (handleExpectedPurchaseError({ error, onAlreadyOwned, trace })) return;
    // Previously swallowed silently, which made a rejected purchase
    // indistinguishable from a no-op. Log the real PurchasesError (e.g. a
    // ConfigurationError from a key/offering mismatch) so it is diagnosable,
    // while still surfacing the generic label to the user.
    traceError(formatBillingPurchaseFailure(error));
    reportUnexpectedPurchaseError(error);
    updateActionState(scope, (current) => ({
      ...current,
      actionError: purchaseErrorLabel(error),
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
