import { useCallback, useLayoutEffect, useRef } from "react";
import type { OrgManagerRequestKind } from "../refresh";

export type { OrgManagerRequestKind } from "../refresh";

interface RequestScopeState {
  active: boolean;
  readonly requestIds: Map<OrgManagerRequestKind, number>;
  readonly scopeKey: string;
}

function createRequestScopeState(scopeKey: string): RequestScopeState {
  return { active: true, requestIds: new Map(), scopeKey };
}

/**
 * Produces latest-request guards scoped to the active authenticated
 * organization. A committed scope change invalidates every outstanding
 * request before effects or user interactions can start work in the new org.
 */
export function useOrgManagerRequestGuard(scopeKey: string) {
  const scopeStateRef = useRef<RequestScopeState>(
    createRequestScopeState(scopeKey),
  );

  useLayoutEffect(() => {
    scopeStateRef.current.active = false;
    const scopeState = createRequestScopeState(scopeKey);
    scopeStateRef.current = scopeState;
    return () => {
      scopeState.active = false;
    };
  }, [scopeKey]);

  return useCallback((kind: OrgManagerRequestKind): (() => boolean) => {
    const scopeState = scopeStateRef.current;
    const requestId = (scopeState.requestIds.get(kind) ?? 0) + 1;
    scopeState.requestIds.set(kind, requestId);

    return () =>
      scopeState.active &&
      scopeStateRef.current === scopeState &&
      scopeState.requestIds.get(kind) === requestId;
  }, []);
}
