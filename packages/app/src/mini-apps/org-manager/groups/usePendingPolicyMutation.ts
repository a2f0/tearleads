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
    const current = () =>
      request === generation.current && actions.isOperationScopeActive(scope);
    try {
      const saved = await actions.readPendingPolicyMutation(
        input.organizationId,
      );
      if (current()) {
        setSaved({ mutation: saved, unreadable: null, scope });
        setError(null);
      }
    } catch (error) {
      if (!current()) return;
      setSaved(
        error instanceof UnreadablePrincipalMutationError
          ? { mutation: null, unreadable: error, scope }
          : null,
      );
      setError(pendingReadError(error));
    }
  }, [actions, input.organizationId]);
  useEffect(() => {
    void refresh();
    return () => {
      generation.current += 1;
    };
  }, [refresh, input.refreshSignal, input.mutating]);
  const active =
    saved && actions.isOperationScopeActive(saved.scope) ? saved : null;
  const pending = active ? active.mutation : null;
  const unreadable = active ? active.unreadable : null;
  return { actions, error, pending, unreadable, refresh, setError };
}

function pendingReadError(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Saved change could not be read";
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

/** Runs the action, then refreshes while the operation is still current. */
async function resolvePendingAction(input: {
  abandon: boolean;
  current: () => boolean;
  onResolved: () => void | Promise<void>;
  organizationId: string;
  refresh: () => Promise<void>;
  setError: Dispatch<SetStateAction<string | null>>;
  snapshot: PendingPolicyMutationSnapshot;
}) {
  const { current } = input;
  try {
    await performPendingAction(
      input.snapshot,
      input.organizationId,
      input.abandon,
    );
    if (!current()) return;
    await input.onResolved();
    if (current()) await input.refresh();
  } catch (error) {
    if (current()) input.setError(pendingActionError(error));
  }
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
        await resolvePendingAction({
          abandon,
          current,
          onResolved: input.onResolved,
          organizationId: input.organizationId,
          refresh,
          setError,
          snapshot: input.snapshot,
        });
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
