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

/** One pass owner per organization. `demanded` owes an unconditional pass;
 * a pass owed only to a hint reads only when the pending hint is ahead of the
 * applied cursor. `phase` is where the current pass is: queued before its
 * first iteration, checking a hint against the applied cursor, or reading. */
export interface ReconciliationState {
  demanded: boolean;
  phase: "checking" | "queued" | "reading";
  promise: Promise<void>;
  requiresSdkBarrier: boolean;
  scope: OrganizationReadModelScope;
}

/** The highest committed cursor position realtime hints named for one scope
 * that no pass has consumed yet. */
export interface PendingReadModelHint {
  readonly position: bigint;
  readonly scope: OrganizationReadModelScope;
}

export interface OrganizationRealtimeState {
  acknowledgedOrganizationId: string | null | undefined;
  caughtUpScope: OrganizationReadModelScope | null;
  declarationSequence: number;
  declaredOrganizationId: string | null | undefined;
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
  readonly pendingHintByOrganizationId: Map<string, PendingReadModelHint>;
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
      disconnectedFallbackByOrganizationId: new Map(),
      listenersByOrganizationId: new Map(),
      pendingDeclaration: null,
      pendingHintByOrganizationId: new Map(),
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

/** A hint only raises the pending position for its scope; a pending hint
 * from another scope is irrelevant to the new one and is replaced. */
export function raisePendingReadModelHint(
  current: PendingReadModelHint | undefined,
  hint: PendingReadModelHint,
): PendingReadModelHint {
  return current &&
    isSameOrganizationReadModelScope(current.scope, hint.scope) &&
    current.position >= hint.position
    ? current
    : hint;
}

/** An Org Manager mutation in this exact scope is still running; it ends
 * with its own post-commit read. */
export function hasActiveOrganizationMutation(
  state: OrganizationRealtimeState,
  scope: OrganizationReadModelScope,
): boolean {
  return [
    ...(state.listenersByOrganizationId.get(scope.organizationId) ?? []),
  ].some(
    (subscription) =>
      subscription.active &&
      isSameOrganizationReadModelScope(subscription.scope, scope) &&
      subscription.isMutationActive(),
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
