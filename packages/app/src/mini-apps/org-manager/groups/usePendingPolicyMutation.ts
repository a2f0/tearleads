import type { AuthoredPrincipalMutation } from "@tearleads/client-sdk";
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
        setSaved({ mutation: saved, scope });
        setError(null);
      }
    } catch (error) {
      if (
        request === generation.current &&
        actions.isOperationScopeActive(scope)
      )
        setError(
          error instanceof Error
            ? error.message
            : "Saved change could not be read",
        );
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
  return { actions, error, pending, refresh, setError };
}

export function usePendingPolicyMutationAction(input: {
  organizationId: string;
  snapshot: ReturnType<typeof usePendingPolicyMutation>;
  onResolved: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const { actions, pending, refresh, setError } = input.snapshot;
  useEffect(() => {
    setBusy(false);
    return () => {
      generation.current += 1;
    };
  }, [input.organizationId, actions.captureOperationScope]);
  const run = useCallback(
    async (abandon: boolean) => {
      if (!pending || busy) return;
      const scope = actions.captureOperationScope();
      if (!scope || scope.organizationId !== input.organizationId) return;
      const operation = ++generation.current;
      const current = () =>
        operation === generation.current &&
        actions.isOperationScopeActive(scope);
      setBusy(true);
      setError(null);
      try {
        if (abandon) {
          await actions.abandonPendingPolicyMutation({
            organizationId: input.organizationId,
            mutation: pending,
            acknowledgeUnknownOutcome: true,
          });
        } else {
          await actions.retryPendingPolicyMutation(input.organizationId);
        }
        if (!current()) return;
        await input.onResolved();
        if (current()) await refresh();
      } catch (error) {
        if (current())
          setError(
            error instanceof Error
              ? error.message
              : "Saved change could not be resolved",
          );
      } finally {
        if (current()) setBusy(false);
      }
    },
    [
      actions,
      busy,
      input.onResolved,
      input.organizationId,
      pending,
      refresh,
      setError,
    ],
  );
  return { busy, run };
}
