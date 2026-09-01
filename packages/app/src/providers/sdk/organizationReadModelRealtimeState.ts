import type { DomainScope, Tearleads } from "@tearleads/client-sdk";

export type ProjectionListener = () => unknown | Promise<unknown>;

export interface OrganizationReadModelScope {
  readonly domainScope: DomainScope;
  readonly organizationId: string;
  readonly userId: string;
}

export interface ProjectionSubscription {
  active: boolean;
  readonly isMutationActive: () => boolean;
  readonly listener: ProjectionListener;
  readonly scope: OrganizationReadModelScope | null;
}

export interface ReconciliationState {
  pending: boolean;
  promise: Promise<void>;
  requiresSdkBarrier: boolean;
  scope: OrganizationReadModelScope;
  started: boolean;
}

interface DeferredSelfHint {
  readonly owner: ProjectionSubscription;
  readonly scope: OrganizationReadModelScope;
}

export interface OrganizationRealtimeState {
  acknowledgedOrganizationId: string | null | undefined;
  caughtUpScope: OrganizationReadModelScope | null;
  declarationSequence: number;
  declaredOrganizationId: string | null | undefined;
  readonly deferredSelfHintByOrganizationId: Map<string, DeferredSelfHint>;
  readonly disconnectedFallbackByOrganizationId: Map<
    string,
    ReturnType<typeof setTimeout>
  >;
  readonly listenersByOrganizationId: Map<string, Set<ProjectionSubscription>>;
  pendingDeclaration: {
    readonly declarationId: string;
    readonly organizationId: string | null;
    readonly socket: WebSocket;
  } | null;
  readonly reconciliationsByOrganizationId: Map<string, ReconciliationState>;
  socket: WebSocket | null;
}

const realtimeStateByInstance = new WeakMap<
  Tearleads,
  OrganizationRealtimeState
>();

export function stateFor(tearleads: Tearleads): OrganizationRealtimeState {
  let state = realtimeStateByInstance.get(tearleads);
  if (!state) {
    state = {
      acknowledgedOrganizationId: undefined,
      caughtUpScope: null,
      declarationSequence: 0,
      declaredOrganizationId: undefined,
      deferredSelfHintByOrganizationId: new Map(),
      disconnectedFallbackByOrganizationId: new Map(),
      listenersByOrganizationId: new Map(),
      pendingDeclaration: null,
      reconciliationsByOrganizationId: new Map(),
      socket: null,
    };
    realtimeStateByInstance.set(tearleads, state);
  }
  return state;
}

export function hasOpenOrganizationReadModelSocket(
  state: OrganizationRealtimeState,
): boolean {
  return state.socket?.readyState === WebSocket.OPEN;
}

export function isSameOrganizationReadModelScope(
  left: OrganizationReadModelScope | null,
  right: OrganizationReadModelScope | null,
): boolean {
  return (
    left !== null &&
    right !== null &&
    left.domainScope === right.domainScope &&
    left.organizationId === right.organizationId &&
    left.userId === right.userId
  );
}

export function currentOrganizationReadModelScope(
  tearleads: Tearleads,
  organizationId?: string,
): OrganizationReadModelScope | null {
  const runtime = tearleads.runtime.input();
  const activeOrganizationId = runtime.auth.organizationId;
  const userId = runtime.auth.userId;
  if (
    !runtime.state.online ||
    !runtime.auth.isAuthenticated ||
    typeof activeOrganizationId !== "string" ||
    typeof userId !== "string" ||
    (organizationId !== undefined && activeOrganizationId !== organizationId)
  ) {
    return null;
  }
  return {
    domainScope: runtime.state.domainScope,
    organizationId: activeOrganizationId,
    userId,
  };
}

function demandScope(
  tearleads: Tearleads,
  state: OrganizationRealtimeState,
  activeOnly: boolean,
  organizationId?: string,
): OrganizationReadModelScope | null {
  const scope = currentOrganizationReadModelScope(tearleads, organizationId);
  if (!scope) {
    return null;
  }
  const hasExactDemand = [
    ...(state.listenersByOrganizationId.get(scope.organizationId) ?? []),
  ].some(
    (subscription) =>
      (!activeOnly || subscription.active) &&
      isSameOrganizationReadModelScope(subscription.scope, scope),
  );
  return hasExactDemand ? scope : null;
}

export function activeDemandScope(
  tearleads: Tearleads,
  state: OrganizationRealtimeState,
  organizationId?: string,
): OrganizationReadModelScope | null {
  return demandScope(tearleads, state, true, organizationId);
}

function leasedDemandScope(
  tearleads: Tearleads,
  state: OrganizationRealtimeState,
): OrganizationReadModelScope | null {
  return demandScope(tearleads, state, false);
}

export function activeDemandOrganizationId(
  tearleads: Tearleads,
  state: OrganizationRealtimeState,
): string | null {
  return leasedDemandScope(tearleads, state)?.organizationId ?? null;
}
