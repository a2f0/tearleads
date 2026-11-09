import type { Tearleads } from "@tearleads/client-sdk";
import { organizationReadModelCursorPosition } from "@tearleads/validators/organizationReadModelCursor";
import {
  activeDemandScope,
  hasActiveOrganizationMutation,
  hasOpenOrganizationReadModelSocket,
  isSameOrganizationReadModelScope,
  type OrganizationReadModelScope,
  type OrganizationRealtimeState,
  type PendingReadModelHint,
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
  tearleads: Tearleads,
  useSdkBarrier: boolean,
): Promise<boolean> {
  const result = useSdkBarrier
    ? await tearleads.organizations.loadDirectoryAndGroupsAfterMutation()
    : await tearleads.organizations.loadDirectoryAndGroups();
  return result !== undefined;
}

/**
 * The pending hint a pass may consume. An Org Manager mutation in the same
 * scope holds it: the mutation ends with its own post-commit read, after which
 * the hint usually names a cursor already applied. A hint from a previous
 * scope is dropped; the new scope runs its own catch-up.
 */
function releasedHint(
  state: OrganizationRealtimeState,
  scope: OrganizationReadModelScope,
): PendingReadModelHint | null {
  const pending = state.pendingHintByOrganizationId.get(scope.organizationId);
  if (!pending) {
    return null;
  }
  if (!isSameOrganizationReadModelScope(pending.scope, scope)) {
    state.pendingHintByOrganizationId.delete(scope.organizationId);
    return null;
  }
  return hasActiveOrganizationMutation(state, scope) ? null : pending;
}

/** Whether the applied projection already reaches the hint's committed
 * cursor, compared by the server's monotone cursor position. An unreadable or
 * absent applied cursor proves nothing, so the pass reads. */
async function appliedCursorCovers(
  tearleads: Tearleads,
  hint: PendingReadModelHint,
): Promise<boolean> {
  let applied: string | null;
  try {
    applied = await tearleads.organizations.loadAppliedReadModelCursor();
  } catch {
    return false;
  }
  const appliedPosition =
    applied === null
      ? null
      : organizationReadModelCursorPosition(applied, hint.scope.organizationId);
  return appliedPosition !== null && appliedPosition >= hint.position;
}

/** Start one pass iteration: consume the demand bit and any released hint.
 * A pass owed only to a hint whose cursor is already applied repaints
 * consumers from the local projection instead of reading. */
async function passNeedsRead(
  tearleads: Tearleads,
  state: OrganizationRealtimeState,
  reconciliation: ReconciliationState,
  passScope: OrganizationReadModelScope,
): Promise<boolean> {
  reconciliation.phase = "checking";
  reconciliation.scope = passScope;
  const demanded = reconciliation.demanded;
  reconciliation.demanded = false;
  const hint = releasedHint(state, passScope);
  if (hint) {
    state.pendingHintByOrganizationId.delete(passScope.organizationId);
  }
  if (demanded) {
    return true;
  }
  if (!hint) {
    return false;
  }
  const covered = await appliedCursorCovers(tearleads, hint);
  // The check is tagged with its scope: an identity or domain transition
  // during the await must neither repaint nor read for the stale scope. The
  // current scope, if any, owes its own catch-up.
  const currentScope = activeDemandScope(
    tearleads,
    state,
    passScope.organizationId,
  );
  if (!isSameOrganizationReadModelScope(passScope, currentScope)) {
    reconciliation.demanded ||= currentScope !== null;
    return false;
  }
  if (!covered) {
    return true;
  }
  // The hint names a cursor already applied, possibly by a read this pass
  // did not own.
  await notifyProjectionListeners(state, passScope);
  return false;
}

async function readPass(
  tearleads: Tearleads,
  state: OrganizationRealtimeState,
  reconciliation: ReconciliationState,
  passScope: OrganizationReadModelScope,
): Promise<void> {
  reconciliation.phase = "reading";
  const useSdkBarrier = reconciliation.requiresSdkBarrier;
  reconciliation.requiresSdkBarrier = false;
  let reconciled = false;
  try {
    reconciled = await reconcileFeed(tearleads, useSdkBarrier);
  } catch {
    // The durable projection stays last-known-good. Another hint,
    // reconnect, or explicit Org Manager refresh retries the feed.
  }
  const currentScope = activeDemandScope(
    tearleads,
    state,
    passScope.organizationId,
  );
  if (!isSameOrganizationReadModelScope(passScope, currentScope)) {
    // An identity transition cannot consume or repaint from the stale pass.
    // One dirty bit catches up the current exact scope sequentially.
    reconciliation.demanded ||= currentScope !== null;
  } else {
    await settleSameScopePass(state, passScope, reconciled);
  }
}

interface ReconciliationRequest {
  /** Owe an unconditional pass rather than one gated on a pending hint. */
  readonly demanded: boolean;
  readonly requiresSdkBarrier: boolean;
}

/**
 * Reconcile one demanded organization projection at a time. Requests that
 * arrive in the same task coalesce before I/O starts; requests that arrive
 * during I/O set one dirty bit, and hints raise one pending cursor, producing
 * at most one sequential follow-up pass without parallel GETs. A pass owed
 * only to a hint reads only when the hint is ahead of the applied cursor.
 */
function scheduleOrganizationReadModelReconciliationPass(
  tearleads: Tearleads,
  organizationId: string,
  request: ReconciliationRequest,
): Promise<void> {
  const state = stateFor(tearleads);
  const requestedScope = activeDemandScope(tearleads, state, organizationId);
  if (!requestedScope) {
    return Promise.resolve();
  }

  const active = state.reconciliationsByOrganizationId.get(organizationId);
  if (active) {
    active.requiresSdkBarrier ||= request.requiresSdkBarrier;
    active.demanded ||= request.demanded;
    if (
      active.phase === "queued" &&
      !isSameOrganizationReadModelScope(active.scope, requestedScope)
    ) {
      active.scope = requestedScope;
    }
    return active.promise;
  }

  const reconciliation: ReconciliationState = {
    demanded: request.demanded,
    promise: Promise.resolve(),
    requiresSdkBarrier: request.requiresSdkBarrier,
    scope: requestedScope,
    phase: "queued",
  };
  const followUpOwed = (): boolean => {
    const scope = activeDemandScope(tearleads, state, organizationId);
    return (
      scope !== null &&
      (reconciliation.demanded || releasedHint(state, scope) !== null)
    );
  };
  const run = async (): Promise<void> => {
    // Let a synchronous websocket burst collapse before the first request.
    await Promise.resolve();
    do {
      const passScope = activeDemandScope(tearleads, state, organizationId);
      if (!passScope) {
        return;
      }
      if (await passNeedsRead(tearleads, state, reconciliation, passScope)) {
        await readPass(tearleads, state, reconciliation, passScope);
      }
    } while (followUpOwed());
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
    // before this finalizer removes the active state. Hand that captured
    // request to a new state instead of letting the already-settled promise
    // absorb it.
    if (followUpOwed()) {
      await scheduleOrganizationReadModelReconciliationPass(
        tearleads,
        organizationId,
        {
          demanded: reconciliation.demanded,
          requiresSdkBarrier: reconciliation.requiresSdkBarrier,
        },
      );
    }
  });
  state.reconciliationsByOrganizationId.set(organizationId, reconciliation);
  return reconciliation.promise;
}

export function scheduleOrganizationReadModelReconciliation(
  tearleads: Tearleads,
  organizationId: string,
): Promise<void> {
  return scheduleOrganizationReadModelReconciliationPass(
    tearleads,
    organizationId,
    { demanded: true, requiresSdkBarrier: false },
  );
}

/** Queue a pass that cannot join SDK reconciliation begun before the event or
 * organization-interest declaration that requires this catch-up. */
export function scheduleOrganizationReadModelReconciliationAfterActivePass(
  tearleads: Tearleads,
  organizationId: string,
): Promise<void> {
  return scheduleOrganizationReadModelReconciliationPass(
    tearleads,
    organizationId,
    { demanded: true, requiresSdkBarrier: true },
  );
}

/** Queue a pass for the pending hint cursor. It reads only when that cursor
 * is ahead of the applied one, once any in-flight SDK read settles. */
export function scheduleOrganizationReadModelHintReconciliation(
  tearleads: Tearleads,
  organizationId: string,
): Promise<void> {
  return scheduleOrganizationReadModelReconciliationPass(
    tearleads,
    organizationId,
    { demanded: false, requiresSdkBarrier: true },
  );
}

/** Ensure initial consumer catch-up without turning an already-reading pass
 * into a dirty bit that schedules a second request. A pass still queued or
 * checking a hint is made to read instead. */
export function ensureOrganizationReadModelReconciliation(
  tearleads: Tearleads,
  organizationId: string,
): Promise<void> {
  const state = stateFor(tearleads);
  const requestedScope = activeDemandScope(tearleads, state, organizationId);
  const active = state.reconciliationsByOrganizationId.get(organizationId);
  if (
    !requestedScope ||
    !active ||
    !isSameOrganizationReadModelScope(active.scope, requestedScope)
  ) {
    return scheduleOrganizationReadModelReconciliation(
      tearleads,
      organizationId,
    );
  }
  if (active.phase !== "reading") {
    active.demanded = true;
  }
  return active.promise;
}
