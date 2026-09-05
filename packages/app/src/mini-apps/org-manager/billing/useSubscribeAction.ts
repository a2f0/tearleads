import {
  PurchaseAbortedError,
  PurchaseAlreadyOwnedError,
  PurchaseCancelledError,
  PurchaseIdentityPendingError,
  PurchaseProviderStalledError,
  type PurchasesCapability,
  PurchasesUnavailableError,
  type SyncSubscriptionOption,
} from "@tearleads/client-sdk";
import type { NativeSubscriptionStore } from "@tearleads/validators/billing";
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
 * Holds the cancel action of the purchase currently in flight, or null. Leaving
 * the panel before the store sheet presents settles the flow as a
 * cancellation; once the sheet is up the action is retired, because a
 * presented StoreKit or Play sheet cannot be dismissed from the app.
 */
type CancelPurchaseRef = RefObject<(() => void) | null>;

function retirePurchaseCancellation(
  cancelPurchaseRef: CancelPurchaseRef,
  cancelPurchase: () => void,
): void {
  if (cancelPurchaseRef.current === cancelPurchase) {
    cancelPurchaseRef.current = null;
  }
}

/**
 * A cancelled flow's provider promise still settles on its own — as the
 * pre-sheet abort — after the local race has already rejected. Trace it so a
 * lost abort is diagnosable, and so the rejection is never unhandled.
 */
function observeAbandonedPurchase(
  purchase: Promise<unknown>,
  isCancelled: () => boolean,
  traceError: (line: string) => void,
): void {
  purchase.catch((error: unknown) => {
    if (isCancelled()) {
      traceError(formatBillingPurchaseFailure(error, true));
    }
  });
}

export function useSubscribeAction({
  canSubscribe,
  cancelPurchaseRef,
  checkNativePurchaseEligibility,
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
      }));
      void purchaseForOrganization({
        cancelPurchaseRef,
        checkNativePurchaseEligibility,
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
  readonly cancelPurchase: () => void;
  readonly cancelPurchaseRef: CancelPurchaseRef;
  readonly option: SyncSubscriptionOption;
  readonly purchases: PurchasesCapability;
  readonly scope: BillingActionScope;
}) {
  return input.purchases.purchaseSync({
    organizationId: input.scope.organizationId,
    packageId: input.option.packageId,
    abortSignal: input.abortSignal,
    onProviderPresented: () => {
      retirePurchaseCancellation(input.cancelPurchaseRef, input.cancelPurchase);
    },
  });
}

/**
 * Runs one purchase attempt end to end. A presented store sheet cannot be
 * dismissed by the app, which shapes everything here:
 *
 * - Cancellation is a race, not a provider call, and it exists only for the
 *   phases before the sheet: the eligibility preflight, identification, and
 *   native preparation. The cancel action rejects a local signal.
 * - An {@link AbortController} is passed to the backend so a cancel that lands
 *   before presentation stops the sheet from opening at all — otherwise the
 *   store would present a purchase nothing in the panel is waiting for.
 * - The backend reports presentation synchronously, at which point the cancel
 *   action is retired: from then on the sheet's own dismissal is the only exit
 *   and the flow waits for the store's result.
 */
async function purchaseForOrganization({
  cancelPurchaseRef,
  checkNativePurchaseEligibility,
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
      cancelPurchase,
      cancelPurchaseRef,
      option,
      purchases,
      scope,
    });
    observeAbandonedPurchase(purchase, cancellation.isCancelled, traceError);
    const result = await Promise.race([purchase, cancellation.signal]);
    trace(formatBillingPurchaseSuccess(result.syncEntitlementActive));
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
    // A newer flow may have installed its own cancel action (scope switched
    // mid-purchase); only clear the ref while it still belongs to this flow.
    retirePurchaseCancellation(cancelPurchaseRef, cancelPurchase);
    updateActionState(scope, (current) => ({ ...current, busy: null }));
  }
}
