import {
  PurchaseIdentityPendingError,
  PurchaseProviderStalledError,
  type PurchasesCapability,
  type SyncSubscriptionOption,
} from "@tearleads/client-sdk";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  type BillingActionScope,
  type BillingScopeRef,
  scopeMatches,
} from "../billing/billingActionScope";
import { ORG_MANAGER_LABELS } from "../labels";

const OPTIONS_RETRY_DELAYS_MS: readonly number[] = [
  1_000, 2_000, 4_000, 5_000, 5_000,
];

export interface BillingOptionsState extends BillingActionScope {
  readonly errorKind: BillingOptionsErrorKind;
  readonly options: ReadonlyArray<SyncSubscriptionOption>;
}

export type BillingOptionsErrorKind =
  | "identity-pending"
  | "stalled"
  | "unavailable"
  | null;

interface UseBillingOptionsInput {
  readonly actionIdle: boolean;
  readonly canSubscribe: boolean;
  readonly currentScope: BillingActionScope;
  readonly purchases: PurchasesCapability;
  readonly retryDelaysMs: readonly number[] | undefined;
  readonly scopeRef: BillingScopeRef;
  readonly setOptionsState: Dispatch<SetStateAction<BillingOptionsState>>;
  readonly userId: string | null;
}

interface OptionsRetryBudget extends BillingActionScope {
  readonly loadGeneration: number;
  nextDelayIndex: number;
}

export function emptyOptionsState(
  scope: BillingActionScope,
): BillingOptionsState {
  return { ...scope, errorKind: null, options: [] };
}

function requirePendingBillingIdentity(
  error: unknown,
): PurchaseIdentityPendingError {
  if (error instanceof PurchaseIdentityPendingError) return error;
  throw error;
}

async function identifyBuyer(
  purchases: PurchasesCapability,
  userId: string,
): Promise<PurchaseIdentityPendingError | undefined> {
  try {
    await purchases.identify({ userId });
    return undefined;
  } catch (error) {
    return requirePendingBillingIdentity(error);
  }
}

function optionsErrorKind(error: unknown): BillingOptionsErrorKind {
  if (error === undefined) return null;
  return error instanceof PurchaseProviderStalledError
    ? "stalled"
    : error instanceof PurchaseIdentityPendingError
      ? "identity-pending"
      : "unavailable";
}

export function billingOptionsErrorLabel(
  kind: BillingOptionsErrorKind,
): string | null {
  if (kind === "identity-pending") {
    return ORG_MANAGER_LABELS.billingIdentityPending;
  }
  if (kind === "stalled") return ORG_MANAGER_LABELS.billingProviderStalled;
  return kind === "unavailable"
    ? ORG_MANAGER_LABELS.billingOptionsUnavailable
    : null;
}

function scheduleOptionsRetry(
  error: unknown,
  delayMs: number | undefined,
  load: () => Promise<void>,
): ReturnType<typeof setTimeout> | undefined {
  return error instanceof PurchaseIdentityPendingError && delayMs !== undefined
    ? setTimeout(() => void load(), delayMs)
    : undefined;
}

export function useBillingOptions(input: UseBillingOptionsInput): () => void {
  // A hook instance uses one schedule; production uses the fixed module value.
  const retryDelaysRef = useRef(input.retryDelaysMs ?? OPTIONS_RETRY_DELAYS_MS);
  const retryBudgetRef = useRef<OptionsRetryBudget>(null);
  const [loadGeneration, setLoadGeneration] = useState(0);
  const retryOptions = useCallback(() => {
    setLoadGeneration((current) => current + 1);
  }, []);
  useEffect(() => {
    const scope = input.currentScope;
    const userId = input.userId;
    if (!scopeMatches(input.scopeRef.current, scope)) return;
    if (!input.canSubscribe || userId === null) {
      input.setOptionsState(emptyOptionsState(scope));
      return;
    }
    if (!input.actionIdle) return;
    let retryBudget = retryBudgetRef.current;
    if (
      retryBudget === null ||
      retryBudget.loadGeneration !== loadGeneration ||
      !scopeMatches(retryBudget, scope)
    ) {
      retryBudget = { ...scope, loadGeneration, nextDelayIndex: 0 };
      retryBudgetRef.current = retryBudget;
    }
    // Preserve a last-known-good catalog and its disabled/error state while a
    // same-scope manual retry is in flight. A changed scope still starts empty.
    input.setOptionsState((current) =>
      scopeMatches(current, scope) ? current : emptyOptionsState(scope),
    );
    let cancelled = false;
    let retryTimeout: ReturnType<typeof setTimeout> | undefined;
    const retry = (error: unknown): void => {
      retryTimeout = scheduleOptionsRetry(
        error,
        retryDelaysRef.current[retryBudget.nextDelayIndex],
        load,
      );
      if (retryTimeout !== undefined) retryBudget.nextDelayIndex += 1;
    };
    const load = async (): Promise<void> => {
      try {
        const pendingIdentityError = await identifyBuyer(
          input.purchases,
          userId,
        );
        if (cancelled || !scopeMatches(input.scopeRef.current, scope)) return;
        const next = await input.purchases.listSyncOptions();
        if (!cancelled && scopeMatches(input.scopeRef.current, scope)) {
          input.setOptionsState({
            ...scope,
            errorKind: optionsErrorKind(pendingIdentityError),
            options: next,
          });
          if (pendingIdentityError) retry(pendingIdentityError);
        }
      } catch (error) {
        if (!cancelled && scopeMatches(input.scopeRef.current, scope)) {
          input.setOptionsState((current) => {
            const scoped = scopeMatches(current, scope)
              ? current
              : emptyOptionsState(scope);
            return {
              ...scoped,
              errorKind: optionsErrorKind(error),
            };
          });
          retry(error);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (retryTimeout !== undefined) clearTimeout(retryTimeout);
    };
  }, [
    input.actionIdle,
    input.canSubscribe,
    input.currentScope,
    input.purchases,
    input.scopeRef,
    input.setOptionsState,
    input.userId,
    loadGeneration,
  ]);
  return retryOptions;
}
