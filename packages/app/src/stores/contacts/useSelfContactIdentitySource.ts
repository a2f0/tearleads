import { useEffect, useMemo, useReducer } from "react";
import {
  type SelfContactIdentityRequest,
  type SelfContactIdentitySource,
  type SelfContactIdentityView,
  transitionSelfContactIdentity,
} from "./currentSelfContactIdentityState";

const PENDING_IDENTITY: SelfContactIdentityView = { status: "pending" };

export function useSelfContactIdentitySource(
  source: SelfContactIdentitySource,
): SelfContactIdentityView {
  const initialRequest = useMemo(() => ({ source }), [source]);
  const [state, dispatch] = useReducer(transitionSelfContactIdentity, {
    status: "pending",
    request: initialRequest,
  });
  useEffect(() => {
    if (!source.enabled) return;
    let active = true;
    let currentRequest: SelfContactIdentityRequest | null = null;
    const refresh = () => {
      if (!active || !source.isCurrent()) return;
      const request = { source };
      currentRequest = request;
      const isCurrent = () =>
        active && currentRequest === request && source.isCurrent();
      dispatch({ type: "started", request });
      void source.load().then(
        (identity) => {
          if (isCurrent())
            dispatch({ type: "resolved", request, identity, isCurrent });
        },
        (error: unknown) => {
          if (isCurrent()) dispatch({ type: "failed", request, error });
        },
      );
    };
    const unsubscribe = source.subscribe(refresh);
    refresh();
    return () => {
      active = false;
      unsubscribe();
    };
  }, [source]);
  // Effects run after render. Never expose a previous scope's resolved role
  // during the replacement's first frame, or after its authority expires.
  return state.request.source === source &&
    source.enabled &&
    source.isCurrent() &&
    (state.status !== "ready" || state.isCurrent())
    ? state
    : PENDING_IDENTITY;
}
