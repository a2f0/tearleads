import { useEffect, useMemo, useReducer } from "react";
import type { CurrentSelfContactIdentity } from "./currentSelfContactIdentity";
import {
  type SelfContactIdentityAdmission,
  type SelfContactIdentityAuthority,
  type SelfContactIdentityRequest,
  type SelfContactIdentitySource,
  type SelfContactIdentityView,
  selfContactIdentityRetryDelay,
  transitionSelfContactIdentity,
} from "./currentSelfContactIdentityState";

const PENDING_IDENTITY: SelfContactIdentityView = { status: "pending" };

type PublishIdentity = (
  event: Parameters<typeof transitionSelfContactIdentity>[1],
) => void;

/** Runs `retry` after `delayMs`; the returned function cancels it. */
export type SelfContactIdentityRetryScheduler = (
  retry: () => void,
  delayMs: number,
) => () => void;

const scheduleRetryTimer: SelfContactIdentityRetryScheduler = (
  retry,
  delayMs,
) => {
  const timer = setTimeout(retry, delayMs);
  return () => clearTimeout(timer);
};

interface IdentityLoadLifetime {
  active: boolean;
  authority: SelfContactIdentityAuthority | null;
  request: SelfContactIdentityRequest | null;
  pending: ReturnType<typeof Promise.withResolvers<void>> | null;
  /** Cancels the scheduled retry of `request` after its read failed. */
  cancelRetry: (() => void) | null;
  readonly scheduleRetry: SelfContactIdentityRetryScheduler;
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

function cancelIdentityRetry(lifetime: IdentityLoadLifetime): void {
  lifetime.cancelRetry?.();
  lifetime.cancelRetry = null;
}

function stopIdentityLifetime(lifetime: IdentityLoadLifetime): void {
  lifetime.active = false;
  lifetime.authority = null;
  cancelIdentityRetry(lifetime);
  lifetime.pending?.resolve();
}

/** No signing identity: admission binds only this lifetime and the source's
 * documents authority generation, since no document can be current Me. */
function absentAdmission(
  source: SelfContactIdentitySource,
  lifetime: IdentityLoadLifetime,
): SelfContactIdentityAdmission {
  const isCurrent = () => lifetime.active && source.isCurrent();
  return {
    isCurrent,
    runWhenCurrent: async (work) => (isCurrent() ? work() : null),
  };
}

function refreshIdentity(
  source: SelfContactIdentitySource,
  lifetime: IdentityLoadLifetime,
  publish: PublishIdentity,
  attempt = 0,
): void {
  if (!lifetime.active) return;
  if (!source.isCurrent()) {
    stopIdentityLifetime(lifetime);
    return;
  }
  // A newer read, retry or notification-driven, supersedes a scheduled retry.
  cancelIdentityRetry(lifetime);
  const request = { source, attempt };
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
        const delayMs = selfContactIdentityRetryDelay(request);
        if (delayMs === null) return;
        lifetime.cancelRetry = lifetime.scheduleRetry(() => {
          if (isLatest())
            refreshIdentity(source, lifetime, publish, attempt + 1);
        }, delayMs);
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
  scheduleRetry: SelfContactIdentityRetryScheduler,
) {
  const lifetime: IdentityLoadLifetime = {
    active: true,
    authority: null,
    request: null,
    pending: null,
    cancelRetry: null,
    scheduleRetry,
  };
  if (source.availability === "absent") {
    publish({
      type: "absent",
      request: { source, attempt: 0 },
      admission: absentAdmission(source, lifetime),
    });
    return () => stopIdentityLifetime(lifetime);
  }
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
  scheduleRetry: SelfContactIdentityRetryScheduler = scheduleRetryTimer,
): SelfContactIdentityView {
  const initialRequest = useMemo(() => ({ source, attempt: 0 }), [source]);
  const [state, dispatch] = useReducer(transitionSelfContactIdentity, {
    status: "pending",
    request: initialRequest,
  });
  useEffect(() => {
    if (source.availability === "unavailable") return;
    return subscribeIdentity(source, dispatch, scheduleRetry);
  }, [scheduleRetry, source]);
  const authority =
    state.status === "ready" || state.status === "refreshing" ? state : null;
  const identity = authority?.identity;
  const isCurrent = authority?.isCurrent;
  const runWhenCurrent = authority?.runWhenCurrent;
  // Request generations guard admission, not the displayed identity. Keep
  // consumers' view stable while equivalent metadata reads come and go.
  const readyView = useMemo<SelfContactIdentityView>(
    () =>
      identity && isCurrent && runWhenCurrent
        ? { status: "ready", identity, isCurrent, runWhenCurrent }
        : PENDING_IDENTITY,
    [identity, isCurrent, runWhenCurrent],
  );
  // Effects run after render. Never expose a previous scope's resolved role
  // during the replacement's first frame, or after its authority expires.
  if (
    state.request.source !== source ||
    source.availability === "unavailable" ||
    !source.isCurrent() ||
    ((state.status === "ready" ||
      state.status === "refreshing" ||
      state.status === "absent") &&
      !state.isCurrent())
  )
    return PENDING_IDENTITY;
  return state.status === "ready" || state.status === "refreshing"
    ? readyView
    : state;
}
