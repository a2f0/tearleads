import {
  PurgedOrganizationRecoveryBillingRequiredError,
  resolveOrganizationBillingView,
} from "@symcrypt/client-sdk";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useOrganizationBillingState } from "../../../providers/billing/BillingProvider";
import { useIdentity } from "../../../providers/identity/IdentityProvider";
import { useSymCrypt } from "../../../providers/sdk/SymCryptProvider";
import { ORG_MANAGER_LABELS } from "../labels";

interface RecoveryTarget {
  readonly containerId: string;
  readonly organizationId: string;
}

interface ScopedRecoveryState {
  readonly error: string | null;
  readonly persistencePending: boolean;
  readonly recovering: boolean;
  readonly scopeKey: string;
  readonly target: RecoveryTarget | null;
}

interface RecoveryAttempt {
  completionScopeKey: string | null;
  promise: Promise<boolean>;
  readonly sourceScopeKey: string;
  readonly token: symbol;
}

type RecoveryStateSetter = Dispatch<SetStateAction<ScopedRecoveryState>>;

function emptyRecoveryState(scopeKey: string): ScopedRecoveryState {
  return {
    error: null,
    persistencePending: false,
    recovering: false,
    scopeKey,
    target: null,
  };
}

function stateForScope(
  state: ScopedRecoveryState,
  scopeKey: string,
): ScopedRecoveryState {
  return state.scopeKey === scopeKey ? state : emptyRecoveryState(scopeKey);
}

function recoveryMessage(state: ScopedRecoveryState): string | null {
  if (state.persistencePending) {
    return state.recovering ? ORG_MANAGER_LABELS.purgeRecoveryFinalizing : null;
  }
  if (state.target) {
    return state.recovering
      ? ORG_MANAGER_LABELS.purgeRecoveryFinalizing
      : ORG_MANAGER_LABELS.purgeRecoveryBillingRequired;
  }
  return state.recovering ? ORG_MANAGER_LABELS.purgeRecoveryPreparing : null;
}

function useReplacementBilling(
  targetOrganizationId: string | null,
  symcrypt: ReturnType<typeof useSymCrypt>,
) {
  const client = useMemo(
    () => ({
      organizations: {
        loadBilling: () =>
          targetOrganizationId
            ? symcrypt.organizations.loadBillingForOrganization(
                targetOrganizationId,
              )
            : Promise.resolve(null),
        startTrial: () =>
          targetOrganizationId
            ? symcrypt.organizations.startTrial(targetOrganizationId)
            : Promise.resolve(null),
      },
    }),
    [symcrypt, targetOrganizationId],
  );
  const billing = useOrganizationBillingState(client, targetOrganizationId);
  return {
    ...billing,
    view: billing.billing
      ? resolveOrganizationBillingView(billing.billing, Date.now())
      : null,
  };
}

function handleRecoveryError(input: {
  readonly error: unknown;
  readonly persistencePending: boolean;
  readonly scopeIsCurrent: boolean;
  readonly scopeKey: string;
  readonly setState: RecoveryStateSetter;
  readonly target: RecoveryTarget | null;
}): boolean {
  if (!input.scopeIsCurrent) return false;
  if (input.error instanceof PurgedOrganizationRecoveryBillingRequiredError) {
    input.setState({
      error: null,
      persistencePending: false,
      recovering: false,
      scopeKey: input.scopeKey,
      target: {
        containerId: input.error.replacementContainerId,
        organizationId: input.error.replacementOrganizationId,
      },
    });
    return false;
  }
  console.error("Failed to recover purged organization:", input.error);
  input.setState((current) => {
    const scoped = stateForScope(current, input.scopeKey);
    return {
      ...scoped,
      error: ORG_MANAGER_LABELS.purgeRecoveryFailed,
      persistencePending: input.persistencePending,
      recovering: false,
      target: input.target ?? scoped.target,
    };
  });
  return false;
}

function recoveryScopeKey(userId: string, organizationId: string): string {
  return `${userId}:${organizationId}`;
}

function attemptCoversScope(
  attempt: RecoveryAttempt,
  scopeKey: string,
): boolean {
  return (
    attempt.sourceScopeKey === scopeKey ||
    attempt.completionScopeKey === scopeKey
  );
}

interface RecoveryAttemptInput {
  readonly organizationId: string;
  readonly persistenceTarget: RecoveryTarget | null;
  readonly persistSession: () => Promise<boolean>;
  readonly scopeKey: string;
  readonly setState: RecoveryStateSetter;
  readonly symcrypt: ReturnType<typeof useSymCrypt>;
  readonly userId: string | null;
}

interface RecoveryExecution {
  readonly stateScopeKey: string;
  readonly target: RecoveryTarget;
}

interface RecoveryAttemptRuntime extends RecoveryAttemptInput {
  readonly attempt: RecoveryAttempt;
  readonly attemptRef: { current: RecoveryAttempt | null };
  readonly scopeKeyRef: { readonly current: string };
}

async function resolveRecoveryExecution(
  input: RecoveryAttemptRuntime,
): Promise<RecoveryExecution | null> {
  if (input.persistenceTarget) {
    return { stateScopeKey: input.scopeKey, target: input.persistenceTarget };
  }
  if (!input.userId) return null;
  const recovered = await input.symcrypt.session.recoverPurgedOrganization(
    input.organizationId,
    { organizationProfileName: ORG_MANAGER_LABELS.recoveredOrganizationName },
  );
  if (!recovered) return null;
  const stateScopeKey = recoveryScopeKey(
    input.userId,
    recovered.organizationId,
  );
  input.attempt.completionScopeKey = stateScopeKey;
  if (!attemptCoversScope(input.attempt, input.scopeKeyRef.current))
    return null;
  const target: RecoveryTarget = recovered;
  input.setState({
    error: null,
    persistencePending: true,
    recovering: true,
    scopeKey: stateScopeKey,
    target,
  });
  return { stateScopeKey, target };
}

async function executeRecoveryAttempt(
  input: RecoveryAttemptRuntime,
): Promise<boolean> {
  let execution: RecoveryExecution | null = null;
  input.setState((current) => ({
    ...stateForScope(current, input.scopeKey),
    error: null,
    recovering: true,
  }));
  try {
    execution = await resolveRecoveryExecution(input);
    if (!execution) return false;
    if (!(await input.persistSession())) {
      throw new Error("Recovered organization session was not persisted");
    }
    if (!attemptCoversScope(input.attempt, input.scopeKeyRef.current)) {
      return false;
    }
    input.setState(emptyRecoveryState(execution.stateScopeKey));
    return true;
  } catch (error) {
    const stateScopeKey = execution?.stateScopeKey ?? input.scopeKey;
    const target = execution?.target ?? input.persistenceTarget;
    return handleRecoveryError({
      error,
      persistencePending: target !== null,
      scopeIsCurrent: attemptCoversScope(
        input.attempt,
        input.scopeKeyRef.current,
      ),
      scopeKey: stateScopeKey,
      setState: input.setState,
      target,
    });
  } finally {
    if (input.attemptRef.current?.token === input.attempt.token) {
      input.attemptRef.current = null;
    }
    if (attemptCoversScope(input.attempt, input.scopeKeyRef.current)) {
      const stateScopeKey = execution?.stateScopeKey ?? input.scopeKey;
      input.setState((current) => ({
        ...stateForScope(current, stateScopeKey),
        recovering: false,
      }));
    }
  }
}

function useRecoveryAttempt(input: RecoveryAttemptInput) {
  const attemptRef = useRef<RecoveryAttempt | null>(null);
  const scopeKeyRef = useRef(input.scopeKey);
  scopeKeyRef.current = input.scopeKey;
  return useCallback((): Promise<boolean> => {
    const existing = attemptRef.current;
    if (existing && attemptCoversScope(existing, input.scopeKey)) {
      return existing.promise;
    }
    const token = Symbol("purge-recovery-attempt");
    const attempt: RecoveryAttempt = {
      completionScopeKey: null,
      promise: Promise.resolve(false),
      sourceScopeKey: input.scopeKey,
      token,
    };
    const promise = executeRecoveryAttempt({
      ...input,
      attempt,
      attemptRef,
      scopeKeyRef,
    });
    attempt.promise = promise;
    attemptRef.current = attempt;
    return promise;
  }, [input]);
}

function resolveAutomaticRecoverySignal(input: {
  readonly currentState: ScopedRecoveryState;
  readonly enabled: boolean;
  readonly replacementBilling: ReturnType<typeof useReplacementBilling>;
  readonly sourceBilling: unknown;
  readonly sourceIsPurged: boolean;
  readonly userId: string | null;
}): unknown {
  if (input.currentState.persistencePending) return null;
  if (input.currentState.target) {
    return input.replacementBilling.view?.canSync
      ? input.replacementBilling.billing
      : null;
  }
  return input.sourceIsPurged && input.enabled && input.userId
    ? input.sourceBilling
    : null;
}

/** Coordinates the app-owned handoff around the SDK's durable recovery. */
export function usePurgedOrganizationRecovery(input: {
  readonly organizationId: string;
  readonly enabled: boolean;
  readonly sourceBilling: {
    readonly billing:
      | Parameters<typeof resolveOrganizationBillingView>[0]
      | null;
    readonly error: string | null;
    readonly loading: boolean;
    readonly refresh: () => Promise<void>;
    readonly startTrial: () => Promise<boolean>;
    readonly view: ReturnType<typeof resolveOrganizationBillingView> | null;
  };
  readonly userId: string | null;
}) {
  const symcrypt = useSymCrypt();
  const { persistSession } = useIdentity();
  const scopeKey = recoveryScopeKey(
    input.userId ?? "signed-out",
    input.organizationId,
  );
  const [state, setState] = useState<ScopedRecoveryState>(() =>
    emptyRecoveryState(scopeKey),
  );
  const currentState = stateForScope(state, scopeKey);
  const targetOrganizationId = currentState.target?.organizationId ?? null;
  const replacementBilling = useReplacementBilling(
    targetOrganizationId,
    symcrypt,
  );
  const attemptedSignalRef = useRef<unknown>(null);
  const recoveryAttemptInput = useMemo(
    () => ({
      organizationId: input.organizationId,
      persistenceTarget: currentState.persistencePending
        ? currentState.target
        : null,
      persistSession,
      scopeKey,
      setState,
      symcrypt,
      userId: input.userId,
    }),
    [
      currentState.persistencePending,
      currentState.target,
      input.organizationId,
      input.userId,
      persistSession,
      scopeKey,
      symcrypt,
    ],
  );
  const runRecovery = useRecoveryAttempt(recoveryAttemptInput);

  const sourceIsPurged = input.sourceBilling.view?.status === "purged";
  const recoverySignal = resolveAutomaticRecoverySignal({
    currentState,
    enabled: input.enabled,
    replacementBilling,
    sourceBilling: input.sourceBilling.billing,
    sourceIsPurged,
    userId: input.userId,
  });

  useEffect(() => {
    attemptedSignalRef.current = null;
    setState((current) =>
      current.scopeKey === scopeKey ? current : emptyRecoveryState(scopeKey),
    );
  }, [scopeKey]);

  useEffect(() => {
    if (!recoverySignal || attemptedSignalRef.current === recoverySignal) {
      return;
    }
    attemptedSignalRef.current = recoverySignal;
    void runRecovery();
  }, [recoverySignal, runRecovery]);

  const retry = useCallback(() => {
    void runRecovery();
  }, [runRecovery]);
  const billingRefresh = currentState.target
    ? replacementBilling.refresh
    : input.sourceBilling.refresh;
  const refresh = useCallback(async () => {
    await billingRefresh();
    await runRecovery();
  }, [billingRefresh, runRecovery]);

  const active =
    currentState.target !== null || (input.enabled && sourceIsPurged);
  return {
    active,
    billing: currentState.target ? replacementBilling : input.sourceBilling,
    error: currentState.error,
    finalize: runRecovery,
    message: recoveryMessage(currentState),
    refresh,
    replacement: currentState.target,
    retry,
  };
}
