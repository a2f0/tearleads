import type { SymCrypt } from "@symcrypt/client-sdk";
import {
  activeDemandScope,
  hasOpenOrganizationReadModelSocket,
  isSameOrganizationReadModelScope,
  type OrganizationReadModelScope,
  type OrganizationRealtimeState,
  type ReconciliationState,
  stateFor,
} from "./organizationReadModelRealtimeState";

async function notifyProjectionListeners(
  state: OrganizationRealtimeState,
  scope: OrganizationReadModelScope,
): Promise<void> {
  const listeners = [
    ...(state.listenersByOrganizationId.get(scope.organizationId) ?? []),
  ].filter(
    (subscription) =>
      subscription.active &&
      isSameOrganizationReadModelScope(subscription.scope, scope),
  );
  await Promise.allSettled(
    listeners.map((subscription) => subscription.listener()),
  );
}

/** Record a same-scope pass outcome. A reconciled pass marks the acked scope
 * caught up and repaints listeners; a declined or failed pass consumed its
 * hint without reconciling, so the scope is no longer provably caught up and
 * the next exact-scope subscription must schedule a fresh catch-up. */
async function settleSameScopePass(
  state: OrganizationRealtimeState,
  passScope: OrganizationReadModelScope,
  reconciled: boolean,
): Promise<void> {
  if (!reconciled) {
    if (isSameOrganizationReadModelScope(state.caughtUpScope, passScope)) {
      state.caughtUpScope = null;
    }
    return;
  }
  if (
    hasOpenOrganizationReadModelSocket(state) &&
    state.acknowledgedOrganizationId === passScope.organizationId
  ) {
    state.caughtUpScope = passScope;
  }
  await notifyProjectionListeners(state, passScope);
}

/** Undefined means the SDK declined without I/O (offline or database not
 * ready): the scope is not caught up and must stay eligible for the next
 * trigger. Null still counts as a completed pass — an authoritative denial
 * purged the projection and mounted consumers must repaint the loss. */
async function reconcileFeed(
  symcrypt: SymCrypt,
  useSdkBarrier: boolean,
): Promise<boolean> {
  const result = useSdkBarrier
    ? await symcrypt.organizations.loadDirectoryAndGroupsAfterMutation()
    : await symcrypt.organizations.loadDirectoryAndGroups();
  return result !== undefined;
}

/**
 * Reconcile one demanded organization projection at a time. Hints that arrive
 * in the same task coalesce before I/O starts; hints that arrive during I/O set
 * one dirty bit, producing a sequential catch-up pass without parallel GETs.
 */
function scheduleOrganizationReadModelReconciliationPass(
  symcrypt: SymCrypt,
  organizationId: string,
  requiresSdkBarrier: boolean,
): Promise<void> {
  const state = stateFor(symcrypt);
  const requestedScope = activeDemandScope(symcrypt, state, organizationId);
  if (!requestedScope) {
    return Promise.resolve();
  }

  const active = state.reconciliationsByOrganizationId.get(organizationId);
  if (active) {
    active.requiresSdkBarrier ||= requiresSdkBarrier;
    if (active.started) {
      active.pending = true;
    } else if (
      !isSameOrganizationReadModelScope(active.scope, requestedScope)
    ) {
      active.scope = requestedScope;
    }
    return active.promise;
  }

  const reconciliation: ReconciliationState = {
    pending: false,
    promise: Promise.resolve(),
    requiresSdkBarrier,
    scope: requestedScope,
    started: false,
  };
  const run = async (): Promise<void> => {
    // Let a synchronous websocket burst collapse before the first request.
    await Promise.resolve();
    reconciliation.started = true;
    do {
      reconciliation.pending = false;
      const passScope = activeDemandScope(symcrypt, state, organizationId);
      if (!passScope) {
        return;
      }
      reconciliation.scope = passScope;
      const useSdkBarrier = reconciliation.requiresSdkBarrier;
      reconciliation.requiresSdkBarrier = false;
      let reconciled = false;
      try {
        reconciled = await reconcileFeed(symcrypt, useSdkBarrier);
      } catch {
        // The durable projection stays last-known-good. Another hint,
        // reconnect, or explicit Org Manager refresh retries the feed.
      }
      const currentScope = activeDemandScope(symcrypt, state, organizationId);
      if (!isSameOrganizationReadModelScope(passScope, currentScope)) {
        // An identity transition cannot consume or repaint from the stale pass.
        // One dirty bit catches up the current exact scope sequentially.
        reconciliation.pending ||= currentScope !== null;
      } else {
        await settleSameScopePass(state, passScope, reconciled);
      }
    } while (reconciliation.pending);
  };
  reconciliation.promise = run().finally(async () => {
    if (
      state.reconciliationsByOrganizationId.get(organizationId) !==
      reconciliation
    ) {
      return;
    }
    state.reconciliationsByOrganizationId.delete(organizationId);
    // A subscription or hint can land after run() has chosen to return but
    // before this finalizer removes the active state. Hand that captured dirty
    // bit to a new state instead of letting the already-settled promise absorb
    // the request.
    if (
      reconciliation.pending &&
      activeDemandScope(symcrypt, state, organizationId)
    ) {
      await scheduleOrganizationReadModelReconciliationPass(
        symcrypt,
        organizationId,
        reconciliation.requiresSdkBarrier,
      );
    }
  });
  state.reconciliationsByOrganizationId.set(organizationId, reconciliation);
  return reconciliation.promise;
}

export function scheduleOrganizationReadModelReconciliation(
  symcrypt: SymCrypt,
  organizationId: string,
): Promise<void> {
  return scheduleOrganizationReadModelReconciliationPass(
    symcrypt,
    organizationId,
    false,
  );
}

/** Queue a pass that cannot join SDK reconciliation begun before the event or
 * organization-interest declaration that requires this catch-up. */
export function scheduleOrganizationReadModelReconciliationAfterActivePass(
  symcrypt: SymCrypt,
  organizationId: string,
): Promise<void> {
  return scheduleOrganizationReadModelReconciliationPass(
    symcrypt,
    organizationId,
    true,
  );
}

/** Ensure initial consumer catch-up without turning an already-running pass
 * into a dirty hint that schedules a second request. */
export function ensureOrganizationReadModelReconciliation(
  symcrypt: SymCrypt,
  organizationId: string,
): Promise<void> {
  const state = stateFor(symcrypt);
  const requestedScope = activeDemandScope(symcrypt, state, organizationId);
  const active = state.reconciliationsByOrganizationId.get(organizationId);
  return requestedScope &&
    active &&
    isSameOrganizationReadModelScope(active.scope, requestedScope)
    ? active.promise
    : scheduleOrganizationReadModelReconciliation(symcrypt, organizationId);
}
