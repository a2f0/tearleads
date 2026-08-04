import type { PurchasesCapability } from "@tearleads/client-sdk";
import type { Dispatch, SetStateAction } from "react";
import {
  type BillingActionScope,
  type BillingActionState,
  type BillingScopeRef,
  scopeMatches,
} from "../billing/billingActionScope";
import {
  type BillingOptionsErrorKind,
  type BillingOptionsState,
  useBillingOptions,
} from "./useBillingOptions";

interface ResolvedBillingOptions {
  readonly actionStateMatches: boolean;
  readonly optionsErrorKind: BillingOptionsErrorKind;
  readonly optionsMatch: boolean;
  readonly purchaseCanSubscribe: boolean;
  readonly retryOptions: () => void;
}

interface UseResolvedBillingOptionsInput {
  readonly actionState: BillingActionState;
  readonly canSubscribe: boolean;
  readonly currentScope: BillingActionScope;
  readonly optionsRetryDelaysMs: readonly number[] | undefined;
  readonly optionsState: BillingOptionsState;
  readonly organizationId: string;
  readonly purchases: PurchasesCapability;
  readonly scopeRef: BillingScopeRef;
  readonly setOptionsState: Dispatch<SetStateAction<BillingOptionsState>>;
  readonly userId: string | null;
}

function resolveScopeMatches(input: UseResolvedBillingOptionsInput): {
  actionStateMatches: boolean;
  optionsMatch: boolean;
} {
  const scopeMatchesInputs =
    input.currentScope.organizationId === input.organizationId &&
    input.currentScope.userId === input.userId;
  return {
    actionStateMatches:
      scopeMatchesInputs && scopeMatches(input.actionState, input.currentScope),
    optionsMatch:
      scopeMatchesInputs &&
      scopeMatches(input.optionsState, input.currentScope),
  };
}

export function useResolvedBillingOptions(
  input: UseResolvedBillingOptionsInput,
): ResolvedBillingOptions {
  const retryOptions = useBillingOptions({
    actionIdle:
      !scopeMatches(input.actionState, input.currentScope) ||
      input.actionState.busy === null,
    canSubscribe: input.canSubscribe,
    currentScope: input.currentScope,
    purchases: input.purchases,
    retryDelaysMs: input.optionsRetryDelaysMs,
    scopeRef: input.scopeRef,
    setOptionsState: input.setOptionsState,
    userId: input.userId,
  });
  const matches = resolveScopeMatches(input);
  const optionsErrorKind = matches.optionsMatch
    ? input.optionsState.errorKind
    : null;
  const hasLoadedOptions =
    matches.optionsMatch && input.optionsState.options.length > 0;
  return {
    ...matches,
    optionsErrorKind,
    purchaseCanSubscribe:
      input.canSubscribe &&
      (optionsErrorKind === null ||
        (optionsErrorKind === "unavailable" && hasLoadedOptions)),
    retryOptions,
  };
}
