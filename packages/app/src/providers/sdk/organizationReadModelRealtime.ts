import type { Tearleads } from "@tearleads/client-sdk";
import {
  activeDemandOrganizationId,
  activeDemandScope,
  currentOrganizationReadModelScope,
  hasOpenOrganizationReadModelSocket,
  isSameOrganizationReadModelScope,
  type OrganizationReadModelScope,
  type OrganizationRealtimeState,
  type ProjectionListener,
  type ProjectionSubscription,
  stateFor,
} from "./organizationReadModelRealtimeState";
import {
  ensureOrganizationReadModelReconciliation,
  notifyProjectionListeners,
  scheduleOrganizationReadModelReconciliation,
  scheduleOrganizationReadModelReconciliationAfterActivePass,
} from "./organizationReadModelReconciliation";

export {
  ensureOrganizationReadModelReconciliation,
  scheduleOrganizationReadModelReconciliation,
};

const DISCONNECTED_RECONCILIATION_FALLBACK_MS = 2_000;

function clearDisconnectedReconciliationFallback(
  state: OrganizationRealtimeState,
  organizationId: string,
): void {
  const timer = state.disconnectedFallbackByOrganizationId.get(organizationId);
  if (timer === undefined) {
    return;
  }
  clearTimeout(timer);
  state.disconnectedFallbackByOrganizationId.delete(organizationId);
}

function scheduleDisconnectedReconciliationFallback(
  tearleads: Tearleads,
  state: OrganizationRealtimeState,
  scope: OrganizationReadModelScope,
): void {
  clearDisconnectedReconciliationFallback(state, scope.organizationId);
  const timer = setTimeout(() => {
    if (
      state.disconnectedFallbackByOrganizationId.get(scope.organizationId) !==
      timer
    ) {
      return;
    }
    state.disconnectedFallbackByOrganizationId.delete(scope.organizationId);
    const currentScope = activeDemandScope(
      tearleads,
      state,
      scope.organizationId,
    );
    if (
      hasOpenOrganizationReadModelSocket(state) ||
      !isSameOrganizationReadModelScope(scope, currentScope)
    ) {
      return;
    }
    void scheduleOrganizationReadModelReconciliationAfterActivePass(
      tearleads,
      scope.organizationId,
    );
  }, DISCONNECTED_RECONCILIATION_FALLBACK_MS);
  state.disconnectedFallbackByOrganizationId.set(scope.organizationId, timer);
  // Timers should not keep Bun/Node test processes alive. Browser timers are
  // numeric and simply have no `unref` method.
  if (typeof timer === "object" && timer !== null) {
    const unref = Reflect.get(timer, "unref");
    if (typeof unref === "function") {
      Reflect.apply(unref, timer, []);
    }
  }
}

function syncOrganizationInterest(
  tearleads: Tearleads,
  state: OrganizationRealtimeState,
): void {
  const ws = state.socket;
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return;
  }
  const organizationId = activeDemandOrganizationId(tearleads, state);
  if (organizationId === null && state.declaredOrganizationId === undefined) {
    return;
  }
  if (organizationId === state.declaredOrganizationId) {
    return;
  }
  const declarationId = String(++state.declarationSequence);
  ws.send(
    JSON.stringify({
      type: "known_organizations",
      declarationId,
      organizationIds: organizationId ? [organizationId] : [],
    }),
  );
  state.declaredOrganizationId = organizationId;
  state.acknowledgedOrganizationId = undefined;
  state.caughtUpScope = null;
  state.pendingDeclaration = { declarationId, organizationId, socket: ws };
}

/** Register actual projection demand. No mounted consumer means no websocket
 * organization interest and therefore no background read-model request. */
export function subscribeOrganizationReadModelRealtime(
  tearleads: Tearleads,
  organizationId: string,
  listener: ProjectionListener,
  options: {
    readonly getReadModelCursor?: (() => string | null) | undefined;
    readonly isMutationActive?: (() => boolean) | undefined;
  } = {},
): () => void {
  const state = stateFor(tearleads);
  const listeners =
    state.listenersByOrganizationId.get(organizationId) ??
    new Set<ProjectionSubscription>();
  const scope = currentOrganizationReadModelScope(tearleads, organizationId);
  const hadActiveExactDemand = [...listeners].some(
    (subscription) =>
      subscription.active &&
      isSameOrganizationReadModelScope(subscription.scope, scope),
  );
  const subscription: ProjectionSubscription = {
    active: true,
    getReadModelCursor: options.getReadModelCursor ?? (() => null),
    isMutationActive: options.isMutationActive ?? (() => false),
    listener,
    scope,
  };
  listeners.add(subscription);
  state.listenersByOrganizationId.set(organizationId, listeners);
  syncOrganizationInterest(tearleads, state);
  // The first active exact-scope consumer owns catch-up. A new declaration
  // waits for the server acknowledgement that authorization/indexing finished;
  // additional consumers share the pass and warm same-task route remounts keep
  // the acknowledged lease without another request.
  if (
    scope &&
    !hadActiveExactDemand &&
    hasOpenOrganizationReadModelSocket(state) &&
    state.acknowledgedOrganizationId === organizationId &&
    !isSameOrganizationReadModelScope(state.caughtUpScope, scope)
  ) {
    void scheduleOrganizationReadModelReconciliationAfterActivePass(
      tearleads,
      organizationId,
    );
  } else if (
    scope &&
    !hadActiveExactDemand &&
    !hasOpenOrganizationReadModelSocket(state)
  ) {
    // Keep HTTP reconciliation functional when realtime is unavailable. If a
    // socket opens first, attach cancels this fallback and owns the sole pass;
    // if it opens later, its fresh pass closes the disconnected mutation gap.
    scheduleDisconnectedReconciliationFallback(tearleads, state, scope);
  }

  return () => {
    if (!subscription.active) {
      return;
    }
    subscription.active = false;
    const deferredSelfHint =
      state.deferredSelfHintByOrganizationId.get(organizationId);
    const abandonedSelfHint =
      deferredSelfHint?.owner === subscription ? deferredSelfHint : null;
    if (abandonedSelfHint) {
      state.deferredSelfHintByOrganizationId.delete(organizationId);
    }
    // React route transitions can unmount and remount the same exact consumer
    // in one passive-effect flush. Keep its demand lease through the current
    // task so that transition neither drops server interest nor starts a second
    // warm catch-up; inactive listeners are never notified.
    queueMicrotask(() => {
      listeners.delete(subscription);
      if (listeners.size === 0) {
        state.listenersByOrganizationId.delete(organizationId);
        state.deferredSelfHintByOrganizationId.delete(organizationId);
        clearDisconnectedReconciliationFallback(state, organizationId);
      }
      syncOrganizationInterest(tearleads, state);
      const currentScope = activeDemandScope(tearleads, state, organizationId);
      if (
        abandonedSelfHint &&
        isSameOrganizationReadModelScope(abandonedSelfHint.scope, currentScope)
      ) {
        void scheduleOrganizationReadModelReconciliationAfterActivePass(
          tearleads,
          organizationId,
        );
      }
    });
  };
}

/** Bind the currently open socket to the demand registry. Reconnects
 * re-declare demand and perform one feed catch-up for the active consumer. */
export function attachOrganizationReadModelSocket(
  tearleads: Tearleads,
  ws: WebSocket,
): () => void {
  const state = stateFor(tearleads);
  state.socket = ws;
  state.acknowledgedOrganizationId = undefined;
  state.caughtUpScope = null;
  state.declaredOrganizationId = undefined;
  state.pendingDeclaration = null;
  syncOrganizationInterest(tearleads, state);

  const demandScope = activeDemandScope(tearleads, state);
  if (demandScope) {
    clearDisconnectedReconciliationFallback(state, demandScope.organizationId);
  }

  return () => {
    if (state.socket === ws) {
      state.socket = null;
      state.acknowledgedOrganizationId = undefined;
      state.caughtUpScope = null;
      state.declaredOrganizationId = undefined;
      state.pendingDeclaration = null;
      const disconnectedDemand = activeDemandScope(tearleads, state);
      if (disconnectedDemand) {
        scheduleDisconnectedReconciliationFallback(
          tearleads,
          state,
          disconnectedDemand,
        );
      }
    }
  };
}

/** Start the authoritative catch-up only after the server has finished
 * authorizing and indexing the exact organization declaration on this socket. */
export function handleOrganizationReadModelInterestAcknowledgement(
  tearleads: Tearleads,
  ws: WebSocket,
  declarationId: string,
  organizationId: string | null,
  _authorized: boolean,
): void {
  const state = stateFor(tearleads);
  const pending = state.pendingDeclaration;
  if (
    state.socket !== ws ||
    !pending ||
    pending.socket !== ws ||
    pending.declarationId !== declarationId ||
    pending.organizationId !== organizationId
  ) {
    return;
  }
  state.pendingDeclaration = null;
  state.acknowledgedOrganizationId = organizationId;
  // Both outcomes are ordering barriers. An authorization denial deliberately
  // drives the HTTP reconciliation too: its authoritative 403/404 path purges
  // the durable local projection instead of leaving stale roster/grant UI.
  if (organizationId && activeDemandScope(tearleads, state, organizationId)) {
    void scheduleOrganizationReadModelReconciliationAfterActivePass(
      tearleads,
      organizationId,
    );
  }
}

export function handleOrganizationReadModelHint(
  tearleads: Tearleads,
  organizationId: string,
  originatedFromSession: boolean,
): void {
  const state = stateFor(tearleads);
  const subscriptions = state.listenersByOrganizationId.get(organizationId);
  const scope = activeDemandScope(tearleads, state, organizationId);
  const mutationSubscription =
    originatedFromSession && scope
      ? [...(subscriptions ?? [])].find(
          (subscription) =>
            subscription.active &&
            isSameOrganizationReadModelScope(subscription.scope, scope) &&
            subscription.isMutationActive(),
        )
      : undefined;
  if (mutationSubscription && scope) {
    state.deferredSelfHintByOrganizationId.set(organizationId, {
      cursor: mutationSubscription.getReadModelCursor(),
      owner: mutationSubscription,
      scope,
    });
    return;
  }
  void scheduleOrganizationReadModelReconciliationAfterActivePass(
    tearleads,
    organizationId,
  );
}

/**
 * Release author hints held during an Org Manager mutation. A changed cursor
 * proves the mutation's explicit reconciliation already caught up, so active
 * views only repaint from local SQLite; otherwise the feed is reconciled now.
 */
export function releaseDeferredOrganizationReadModelHint(
  tearleads: Tearleads,
  organizationId: string,
  readModelCursor: string | null,
): void {
  const state = stateFor(tearleads);
  const deferredHint =
    state.deferredSelfHintByOrganizationId.get(organizationId);
  if (!deferredHint) {
    return;
  }
  state.deferredSelfHintByOrganizationId.delete(organizationId);
  const activeScope = activeDemandScope(tearleads, state, organizationId);
  if (!isSameOrganizationReadModelScope(deferredHint.scope, activeScope)) {
    return;
  }
  if (deferredHint.cursor !== readModelCursor) {
    void notifyProjectionListeners(state, deferredHint.scope);
    return;
  }
  void scheduleOrganizationReadModelReconciliationAfterActivePass(
    tearleads,
    organizationId,
  );
}
