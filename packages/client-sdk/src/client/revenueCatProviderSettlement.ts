import type { RevenueCatProviderPhaseCoordinator } from "./revenueCatProviderPhase";
import type { RevenueCatTimeoutCoordinator } from "./revenueCatTimeoutCoordinator";

interface RevenueCatProviderSettlementInput<T> {
  readonly buyerPaced: boolean;
  readonly onPreparationTimeout: () => void;
  readonly onProviderTimeout?: () => void;
  readonly operation: Promise<T>;
  readonly operationName: string;
  readonly preflight: Promise<void>;
  readonly providerPhase: RevenueCatProviderPhaseCoordinator | undefined;
  readonly providerStarted: () => boolean;
  readonly timeouts: RevenueCatTimeoutCoordinator;
}

/** Applies a deadline to preflight/provider work without timing the server tail. */
export function settleRevenueCatProviderOperation<T>(
  input: RevenueCatProviderSettlementInput<T>,
): Promise<T> {
  const { timeouts } = input;
  if (input.buyerPaced) {
    void input.operation.catch(() => undefined);
    return timeouts
      .withProviderTimeout(
        input.preflight,
        `${input.operationName} preparation`,
        () => timeouts.identityMutationActive,
        input.onPreparationTimeout,
      )
      .then(() => input.operation);
  }
  const providerPhase = input.providerPhase;
  if (providerPhase) {
    void input.operation.catch(() => undefined);
    return timeouts
      .withProviderTimeout(
        input.preflight,
        `${input.operationName} preparation`,
        () => timeouts.identityMutationActive,
        input.onPreparationTimeout,
      )
      .then(() => Promise.race([input.operation, providerPhase.timedOut]));
  }
  return timeouts.withProviderTimeout(
    input.operation,
    input.operationName,
    () => input.providerStarted() || timeouts.identityMutationActive,
    input.onProviderTimeout,
  );
}
