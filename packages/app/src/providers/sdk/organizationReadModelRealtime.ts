import type { Tearleads } from "@tearleads/client-sdk";

type ProjectionListener = () => unknown | Promise<unknown>;

interface ProjectionSubscription {
  readonly getReadModelCursor: () => string | null;
  readonly isMutationActive: () => boolean;
  readonly listener: ProjectionListener;
}

interface ReconciliationState {
  pending: boolean;
  promise: Promise<void>;
  started: boolean;
}

interface OrganizationRealtimeState {
  declaredOrganizationId: string | null | undefined;
  readonly deferredSelfHintCursorByOrganizationId: Map<string, string | null>;
  hasConnected: boolean;
  readonly listenersByOrganizationId: Map<string, Set<ProjectionSubscription>>;
  readonly reconciliationsByOrganizationId: Map<string, ReconciliationState>;
  socket: WebSocket | null;
}

const realtimeStateByInstance = new WeakMap<
  Tearleads,
  OrganizationRealtimeState
>();

function stateFor(tearleads: Tearleads): OrganizationRealtimeState {
  let state = realtimeStateByInstance.get(tearleads);
  if (!state) {
    state = {
      declaredOrganizationId: undefined,
      deferredSelfHintCursorByOrganizationId: new Map(),
      hasConnected: false,
      listenersByOrganizationId: new Map(),
      reconciliationsByOrganizationId: new Map(),
      socket: null,
    };
    realtimeStateByInstance.set(tearleads, state);
  }
  return state;
}

function activeDemandOrganizationId(
  tearleads: Tearleads,
  state: OrganizationRealtimeState,
): string | null {
  const auth = tearleads.runtime.input().auth;
  const organizationId = auth.organizationId;
  return auth.isAuthenticated &&
    typeof organizationId === "string" &&
    (state.listenersByOrganizationId.get(organizationId)?.size ?? 0) > 0
    ? organizationId
    : null;
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
  ws.send(
    JSON.stringify({
      type: "known_organizations",
      organizationIds: organizationId ? [organizationId] : [],
    }),
  );
  state.declaredOrganizationId = organizationId;
}

async function notifyProjectionListeners(
  state: OrganizationRealtimeState,
  organizationId: string,
): Promise<void> {
  const listeners = [
    ...(state.listenersByOrganizationId.get(organizationId) ?? []),
  ];
  await Promise.allSettled(
    listeners.map((subscription) => subscription.listener()),
  );
}

/**
 * Reconcile one demanded organization projection at a time. Hints that arrive
 * in the same task coalesce before I/O starts; hints that arrive during I/O set
 * one dirty bit, producing a sequential catch-up pass without parallel GETs.
 */
export function scheduleOrganizationReadModelReconciliation(
  tearleads: Tearleads,
  organizationId: string,
): Promise<void> {
  const state = stateFor(tearleads);
  if (
    activeDemandOrganizationId(tearleads, state) !== organizationId ||
    !state.listenersByOrganizationId.has(organizationId)
  ) {
    return Promise.resolve();
  }

  const active = state.reconciliationsByOrganizationId.get(organizationId);
  if (active) {
    if (active.started) {
      active.pending = true;
    }
    return active.promise;
  }

  const reconciliation: ReconciliationState = {
    pending: false,
    promise: Promise.resolve(),
    started: false,
  };
  const run = async (): Promise<void> => {
    // Let a synchronous websocket burst collapse before the first request.
    await Promise.resolve();
    reconciliation.started = true;
    do {
      reconciliation.pending = false;
      if (activeDemandOrganizationId(tearleads, state) !== organizationId) {
        return;
      }
      try {
        await tearleads.organizations.loadDirectoryAndGroups();
        await notifyProjectionListeners(state, organizationId);
      } catch {
        // The durable projection stays last-known-good. Another hint,
        // reconnect, or explicit Org Manager refresh retries the feed.
      }
    } while (reconciliation.pending);
  };
  reconciliation.promise = run().finally(() => {
    if (
      state.reconciliationsByOrganizationId.get(organizationId) ===
      reconciliation
    ) {
      state.reconciliationsByOrganizationId.delete(organizationId);
    }
  });
  state.reconciliationsByOrganizationId.set(organizationId, reconciliation);
  return reconciliation.promise;
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
  const subscription: ProjectionSubscription = {
    getReadModelCursor: options.getReadModelCursor ?? (() => null),
    isMutationActive: options.isMutationActive ?? (() => false),
    listener,
  };
  listeners.add(subscription);
  state.listenersByOrganizationId.set(organizationId, listeners);
  syncOrganizationInterest(tearleads, state);

  return () => {
    listeners.delete(subscription);
    if (listeners.size === 0) {
      state.listenersByOrganizationId.delete(organizationId);
      state.deferredSelfHintCursorByOrganizationId.delete(organizationId);
    }
    syncOrganizationInterest(tearleads, state);
  };
}

/** Bind the currently open socket to the demand registry. Reconnects
 * re-declare demand and perform one feed catch-up for the active consumer. */
export function attachOrganizationReadModelSocket(
  tearleads: Tearleads,
  ws: WebSocket,
): () => void {
  const state = stateFor(tearleads);
  const isReconnect = state.hasConnected;
  state.hasConnected = true;
  state.socket = ws;
  state.declaredOrganizationId = undefined;
  syncOrganizationInterest(tearleads, state);

  const organizationId = activeDemandOrganizationId(tearleads, state);
  if (isReconnect && organizationId) {
    void scheduleOrganizationReadModelReconciliation(tearleads, organizationId);
  }

  return () => {
    if (state.socket === ws) {
      state.socket = null;
      state.declaredOrganizationId = undefined;
    }
  };
}

export function handleOrganizationReadModelHint(
  tearleads: Tearleads,
  organizationId: string,
  originatedFromSession: boolean,
): void {
  const state = stateFor(tearleads);
  const subscriptions = state.listenersByOrganizationId.get(organizationId);
  const mutationSubscription = originatedFromSession
    ? [...(subscriptions ?? [])].find((subscription) =>
        subscription.isMutationActive(),
      )
    : undefined;
  if (mutationSubscription) {
    state.deferredSelfHintCursorByOrganizationId.set(
      organizationId,
      mutationSubscription.getReadModelCursor(),
    );
    return;
  }
  void scheduleOrganizationReadModelReconciliation(tearleads, organizationId);
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
  if (!state.deferredSelfHintCursorByOrganizationId.has(organizationId)) {
    return;
  }
  const previousCursor =
    state.deferredSelfHintCursorByOrganizationId.get(organizationId);
  state.deferredSelfHintCursorByOrganizationId.delete(organizationId);
  if (previousCursor !== readModelCursor) {
    void notifyProjectionListeners(state, organizationId);
    return;
  }
  void scheduleOrganizationReadModelReconciliation(tearleads, organizationId);
}
