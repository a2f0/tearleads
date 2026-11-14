import { useEffect, useMemo, useReducer } from "react";
import type { CurrentSelfContactIdentity } from "./currentSelfContactIdentity";
import {
  type SelfContactIdentityAuthority,
  type SelfContactIdentityRequest,
  type SelfContactIdentitySource,
  type SelfContactIdentityView,
  transitionSelfContactIdentity,
} from "./currentSelfContactIdentityState";

const PENDING_IDENTITY: SelfContactIdentityView = { status: "pending" };

type PublishIdentity = (
  event: Parameters<typeof transitionSelfContactIdentity>[1],
) => void;

interface IdentityLoadLifetime {
  active: boolean;
  authority: SelfContactIdentityAuthority | null;
  request: SelfContactIdentityRequest | null;
  pending: ReturnType<typeof Promise.withResolvers<void>> | null;
}

function sameIdentity(
  left: CurrentSelfContactIdentity,
  right: CurrentSelfContactIdentity,
): boolean {
  return (
    left.documentId === right.documentId &&
    left.localId === right.localId &&
    left.localIds.size === right.localIds.size &&
    [...left.localIds].every((id) => right.localIds.has(id))
  );
}

function identityAuthority(
  source: SelfContactIdentitySource,
  lifetime: IdentityLoadLifetime,
  identity: CurrentSelfContactIdentity,
): SelfContactIdentityAuthority {
  if (lifetime.authority && sameIdentity(lifetime.authority.identity, identity))
    return lifetime.authority;
  const authority: SelfContactIdentityAuthority = {
    identity,
    isCurrent: () =>
      lifetime.active && source.isCurrent() && lifetime.authority === authority,
    runWhenCurrent: async (work) => {
      while (authority.isCurrent()) {
        const pending = lifetime.pending;
        // Invoke in this same turn: an extra awaited boolean would leave a
        // window for another refresh between the check and the SDK call.
        if (!pending) return work();
        await pending.promise;
      }
      return null;
    },
  };
  return authority;
}

function stopIdentityLifetime(lifetime: IdentityLoadLifetime): void {
  lifetime.active = false;
  lifetime.authority = null;
  lifetime.pending?.resolve();
}

function refreshIdentity(
  source: SelfContactIdentitySource,
  lifetime: IdentityLoadLifetime,
  publish: PublishIdentity,
): void {
  if (!lifetime.active) return;
  if (!source.isCurrent()) {
    stopIdentityLifetime(lifetime);
    return;
  }
  const request = { source };
  const completed = Promise.withResolvers<void>();
  lifetime.request = request;
  const superseded = lifetime.pending;
  lifetime.pending = completed;
  // Wake admission waiters so they join the newest read, even if the older
  // read never finishes. Resolution is a wake signal, not a persistence proof.
  superseded?.resolve();
  const isLatest = () =>
    lifetime.active && source.isCurrent() && lifetime.request === request;
  publish({ type: "started", request, preserve: lifetime.authority !== null });
  void Promise.resolve()
    .then(() => source.load())
    .then(
      (identity) => {
        if (!isLatest()) return;
        const authority = identityAuthority(source, lifetime, identity);
        lifetime.authority = authority;
        publish({ type: "resolved", request, authority });
      },
      (error: unknown) => {
        if (!isLatest()) return;
        lifetime.authority = null;
        publish({ type: "failed", request, error });
      },
    )
    .finally(() => {
      if (lifetime.pending === completed) lifetime.pending = null;
      completed.resolve();
    });
}

function subscribeIdentity(
  source: SelfContactIdentitySource,
  publish: PublishIdentity,
) {
  const lifetime: IdentityLoadLifetime = {
    active: true,
    authority: null,
    request: null,
    pending: null,
  };
  const refresh = () => refreshIdentity(source, lifetime, publish);
  const unsubscribe = source.subscribe(refresh);
  refresh();
  return () => {
    stopIdentityLifetime(lifetime);
    unsubscribe();
  };
}

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
    return subscribeIdentity(source, dispatch);
  }, [source]);
  // Effects run after render. Never expose a previous scope's resolved role
  // during the replacement's first frame, or after its authority expires.
  if (
    state.request.source !== source ||
    !source.enabled ||
    !source.isCurrent() ||
    ((state.status === "ready" || state.status === "refreshing") &&
      !state.isCurrent())
  )
    return PENDING_IDENTITY;
  return state.status === "refreshing" ? { ...state, status: "ready" } : state;
}
