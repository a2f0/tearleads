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
  readonly recovering: boolean;
  readonly scopeKey: string;
  readonly target: RecoveryTarget | null;
}

interface RecoveryAttempt {
  readonly promise: Promise<boolean>;
  readonly scopeKey: string;
  readonly token: symbol;
}

type RecoveryStateSetter = Dispatch<SetStateAction<ScopedRecoveryState>>;

function emptyRecoveryState(scopeKey: string): ScopedRecoveryState {
  return { error: null, recovering: false, scopeKey, target: null };
}

function stateForScope(
  state: ScopedRecoveryState,
  scopeKey: string,
): ScopedRecoveryState {
  return state.scopeKey === scopeKey ? state : emptyRecoveryState(scopeKey);
}

function recoveryMessage(state: ScopedRecoveryState): string | null {
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
  readonly scopeIsCurrent: boolean;
  readonly scopeKey: string;
  readonly setState: RecoveryStateSetter;
}): boolean {
  if (!input.scopeIsCurrent) return false;
  if (input.error instanceof PurgedOrganizationRecoveryBillingRequiredError) {
    input.setState({
      error: null,
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
  input.setState((current) => ({
    ...stateForScope(current, input.scopeKey),
    error: ORG_MANAGER_LABELS.purgeRecoveryFailed,
    recovering: false,
  }));
  return false;
}

function useRecoveryAttempt(input: {
  readonly organizationId: string;
  readonly persistSession: () => Promise<boolean>;
  readonly scopeKey: string;
  readonly setState: RecoveryStateSetter;
  readonly symcrypt: ReturnType<typeof useSymCrypt>;
}) {
  const attemptRef = useRef<RecoveryAttempt | null>(null);
  const scopeKeyRef = useRef(input.scopeKey);
  scopeKeyRef.current = input.scopeKey;
  return useCallback((): Promise<boolean> => {
    const { organizationId, persistSession, scopeKey, setState, symcrypt } =
      input;
    const existing = attemptRef.current;
    if (existing?.scopeKey === scopeKey) return existing.promise;
    const token = Symbol("purge-recovery-attempt");
    const promise = (async () => {
      setState((current) => ({
        ...stateForScope(current, scopeKey),
        error: null,
        recovering: true,
      }));
      try {
        const recovered = await symcrypt.session.recoverPurgedOrganization(
          organizationId,
          {
            organizationProfileName:
              ORG_MANAGER_LABELS.recoveredOrganizationName,
          },
        );
        if (scopeKeyRef.current !== scopeKey || !recovered) return false;
        if (!(await persistSession())) {
          throw new Error("Recovered organization session was not persisted");
        }
        return true;
      } catch (error) {
        return handleRecoveryError({
          error,
          scopeIsCurrent: scopeKeyRef.current === scopeKey,
          scopeKey,
          setState,
        });
      } finally {
        if (attemptRef.current?.token === token) attemptRef.current = null;
        if (scopeKeyRef.current === scopeKey) {
          setState((current) => ({
            ...stateForScope(current, scopeKey),
            recovering: false,
          }));
        }
      }
    })();
    attemptRef.current = { promise, scopeKey, token };
    return promise;
  }, [input]);
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
  const scopeKey = `${input.userId ?? "signed-out"}:${input.organizationId}`;
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
  const [retryVersion, setRetryVersion] = useState(0);
  const recoveryAttemptInput = useMemo(
    () => ({
      organizationId: input.organizationId,
      persistSession,
      scopeKey,
      setState,
      symcrypt,
    }),
    [input.organizationId, persistSession, scopeKey, symcrypt],
  );
  const runRecovery = useRecoveryAttempt(recoveryAttemptInput);

  const sourceIsPurged = input.sourceBilling.view?.status === "purged";
  const recoverySignal = currentState.target
    ? replacementBilling.view?.canSync
      ? replacementBilling.billing
      : null
    : sourceIsPurged && input.enabled && input.userId
      ? input.sourceBilling.billing
      : null;

  useEffect(() => {
    attemptedSignalRef.current = null;
    setState(emptyRecoveryState(scopeKey));
  }, [scopeKey]);

  useEffect(() => {
    if (!recoverySignal || attemptedSignalRef.current === recoverySignal) {
      return;
    }
    attemptedSignalRef.current = recoverySignal;
    void runRecovery();
  }, [recoverySignal, retryVersion, runRecovery]);

  const retry = useCallback(() => {
    attemptedSignalRef.current = null;
    setRetryVersion((current) => current + 1);
  }, []);
  const billingRefresh = currentState.target
    ? replacementBilling.refresh
    : input.sourceBilling.refresh;
  const refresh = useCallback(async () => {
    await billingRefresh();
    retry();
  }, [billingRefresh, retry]);

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
