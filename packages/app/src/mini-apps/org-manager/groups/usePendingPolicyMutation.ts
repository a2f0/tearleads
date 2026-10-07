import {
  type AuthoredPrincipalMutation,
  UnreadablePrincipalMutationError,
} from "@tearleads/client-sdk";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useOrgManagerActions } from "../../../stores/org-manager/OrgManagerProvider";

interface PendingPolicyMutationSnapshot {
  actions: ReturnType<typeof useOrgManagerActions>;
  error: string | null;
  pending: AuthoredPrincipalMutation | null;
  unreadable: UnreadablePrincipalMutationError | null;
  refresh: () => Promise<void>;
  setError: Dispatch<SetStateAction<string | null>>;
}

export function usePendingPolicyMutation(input: {
  organizationId: string;
  refreshSignal: string | null;
  mutating: boolean;
}): PendingPolicyMutationSnapshot {
  const actions = useOrgManagerActions();
  const [saved, setSaved] = useState<{
    mutation: AuthoredPrincipalMutation | null;
    unreadable: UnreadablePrincipalMutationError | null;
    scope: NonNullable<ReturnType<typeof actions.captureOperationScope>>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    const scope = actions.captureOperationScope();
    if (!scope || scope.organizationId !== input.organizationId) return;
    try {
      const saved = await actions.readPendingPolicyMutation(
        input.organizationId,
      );
      if (
        request === generation.current &&
        actions.isOperationScopeActive(scope)
      ) {
        setSaved({ mutation: saved, unreadable: null, scope });
        setError(null);
      }
    } catch (error) {
      if (
        request === generation.current &&
        actions.isOperationScopeActive(scope)
      ) {
        if (error instanceof UnreadablePrincipalMutationError)
          setSaved({ mutation: null, unreadable: error, scope });
        else setSaved(null);
        setError(
          error instanceof Error
            ? error.message
            : "Saved change could not be read",
        );
      }
    }
  }, [actions, input.organizationId]);
  useEffect(() => {
    void refresh();
    return () => {
      generation.current += 1;
    };
  }, [refresh, input.refreshSignal, input.mutating]);
  const pending =
    saved && actions.isOperationScopeActive(saved.scope)
      ? saved.mutation
      : null;
  const unreadable =
    saved && actions.isOperationScopeActive(saved.scope)
      ? saved.unreadable
      : null;
  return { actions, error, pending, unreadable, refresh, setError };
}

async function performPendingAction(
  snapshot: PendingPolicyMutationSnapshot,
  organizationId: string,
  abandon: boolean,
) {
  const { actions, pending, unreadable } = snapshot;
  if (unreadable) {
    if (!abandon) return;
    await actions.discardUnreadablePolicyMutation({
      organizationId: organizationId,
      recordId: unreadable.recordId,
      acknowledgeUnknownOutcome: true,
    });
  } else if (abandon && pending) {
    await actions.abandonPendingPolicyMutation({
      organizationId: organizationId,
      mutation: pending,
      acknowledgeUnknownOutcome: true,
    });
  } else {
    await actions.retryPendingPolicyMutation(organizationId);
  }
}

function pendingActionError(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Saved change could not be resolved";
}

export function usePendingPolicyMutationAction(input: {
  organizationId: string;
  snapshot: ReturnType<typeof usePendingPolicyMutation>;
  onResolved: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const { actions, pending, unreadable, refresh, setError } = input.snapshot;
  useEffect(() => {
    setBusy(false);
    return () => {
      generation.current += 1;
    };
  }, [input.organizationId, actions.captureOperationScope]);
  const run = useCallback(
    async (abandon: boolean) => {
      if ((!pending && !unreadable) || busy) return;
      const scope = actions.captureOperationScope();
      if (!scope || scope.organizationId !== input.organizationId) return;
      const operation = ++generation.current;
      const current = () =>
        operation === generation.current &&
        actions.isOperationScopeActive(scope);
      setBusy(true);
      setError(null);
      try {
        await performPendingAction(
          input.snapshot,
          input.organizationId,
          abandon,
        );
        if (!current()) return;
        await input.onResolved();
        if (current()) await refresh();
      } catch (error) {
        if (current()) setError(pendingActionError(error));
      } finally {
        if (operation === generation.current) setBusy(false);
      }
    },
    [
      actions,
      busy,
      input.onResolved,
      input.snapshot,
      input.organizationId,
      pending,
      unreadable,
      refresh,
      setError,
    ],
  );
  return { busy, run };
}
