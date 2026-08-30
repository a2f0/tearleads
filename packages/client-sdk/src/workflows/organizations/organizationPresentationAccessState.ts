import { hasOrganizationPresentationDenial } from "../../data/persistence/organizations/organizationPresentationDenialPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";

export type OrganizationPresentationProjection = "readModel" | "usage";

export interface OrganizationPresentationAccessInput {
  readonly execSql: ExecSql;
  readonly organizationId: string;
  readonly requesterUserId: string;
}

interface ProjectionAccessState {
  denied: boolean;
  /**
   * True only when the server itself denied the projection (a 403/404 read).
   * A session reset also flips `denied`, but that is a local lifecycle event —
   * consumers reacting specifically to lost-then-regained org access (e.g.
   * re-arming write lanes) must not treat a routine reset as a denial.
   */
  deniedByServer: boolean;
  generation: number;
}

interface AccessScopeState {
  readonly organizationId: string;
  readonly readModel: ProjectionAccessState;
  readonly usage: ProjectionAccessState;
}

interface AccessExecutorState {
  readonly generationByOrganization: Map<string, number>;
  mutationQueue?: Promise<void> | undefined;
  readonly resetDepthByOrganization: Map<string, number>;
  readonly scopes: Map<string, AccessScopeState>;
}

export interface OrganizationPresentationAccessAttempt {
  readonly executorGeneration: number;
  readonly projection: OrganizationPresentationProjection;
  readonly projectionGeneration: number;
  readonly startedDenied: boolean;
  readonly startedDuringReset: boolean;
}

const accessByExecutor = new WeakMap<ExecSql, AccessExecutorState>();

export function organizationAccessScopeKey(
  organizationId: string,
  requesterUserId: string,
): string {
  return JSON.stringify([organizationId, requesterUserId]);
}

function accessExecutorState(execSql: ExecSql): AccessExecutorState {
  let state = accessByExecutor.get(execSql);
  if (!state) {
    state = {
      generationByOrganization: new Map(),
      resetDepthByOrganization: new Map(),
      scopes: new Map(),
    };
    accessByExecutor.set(execSql, state);
  }
  return state;
}

function newProjectionState(denied: boolean): ProjectionAccessState {
  return { denied, deniedByServer: false, generation: 0 };
}

function organizationResetDepth(
  executor: AccessExecutorState,
  organizationId: string,
): number {
  return executor.resetDepthByOrganization.get(organizationId) ?? 0;
}

function organizationGeneration(
  executor: AccessExecutorState,
  organizationId: string,
): number {
  return executor.generationByOrganization.get(organizationId) ?? 0;
}

function accessScopeState(
  executor: AccessExecutorState,
  organizationId: string,
  requesterUserId: string,
): AccessScopeState {
  const key = organizationAccessScopeKey(organizationId, requesterUserId);
  let scope = executor.scopes.get(key);
  if (!scope) {
    const denied = organizationResetDepth(executor, organizationId) > 0;
    scope = {
      organizationId,
      readModel: newProjectionState(denied),
      usage: newProjectionState(denied),
    };
    executor.scopes.set(key, scope);
  }
  return scope;
}

function projectionState(
  scope: AccessScopeState,
  projection: OrganizationPresentationProjection,
): ProjectionAccessState {
  return scope[projection];
}

export function captureOrganizationPresentationAccessAttempt(
  input: OrganizationPresentationAccessInput,
  projection: OrganizationPresentationProjection,
): OrganizationPresentationAccessAttempt {
  const executor = accessExecutorState(input.execSql);
  const state = projectionState(
    accessScopeState(executor, input.organizationId, input.requesterUserId),
    projection,
  );
  return {
    executorGeneration: organizationGeneration(executor, input.organizationId),
    projection,
    projectionGeneration: state.generation,
    startedDenied: state.denied,
    startedDuringReset:
      organizationResetDepth(executor, input.organizationId) > 0,
  };
}

export function isOrganizationPresentationAccessAttemptCurrent(
  input: OrganizationPresentationAccessInput,
  attempt: OrganizationPresentationAccessAttempt,
): boolean {
  const executor = accessExecutorState(input.execSql);
  const state = projectionState(
    accessScopeState(executor, input.organizationId, input.requesterUserId),
    attempt.projection,
  );
  return (
    !attempt.startedDuringReset &&
    organizationResetDepth(executor, input.organizationId) === 0 &&
    organizationGeneration(executor, input.organizationId) ===
      attempt.executorGeneration &&
    state.generation === attempt.projectionGeneration
  );
}

export function isOrganizationPresentationAccessReadable(
  input: OrganizationPresentationAccessInput,
  projection: OrganizationPresentationProjection,
): boolean {
  const executor = accessExecutorState(input.execSql);
  const state = projectionState(
    accessScopeState(executor, input.organizationId, input.requesterUserId),
    projection,
  );
  return (
    organizationResetDepth(executor, input.organizationId) === 0 &&
    !state.denied
  );
}

export function denyOrganizationPresentationAccess(
  input: OrganizationPresentationAccessInput,
  projections: readonly OrganizationPresentationProjection[],
): void {
  const executor = accessExecutorState(input.execSql);
  const scope = accessScopeState(
    executor,
    input.organizationId,
    input.requesterUserId,
  );
  for (const projection of new Set(projections)) {
    const state = projectionState(scope, projection);
    state.denied = true;
    state.deniedByServer = true;
    state.generation += 1;
  }
}

/**
 * Whether the scope's projection is currently denied because the server
 * refused it (as opposed to a local session reset). The flip back to readable
 * after this returns true is the "org access was just restored" edge.
 */
export function wasOrganizationPresentationAccessDeniedByServer(
  input: OrganizationPresentationAccessInput,
  projection: OrganizationPresentationProjection,
): boolean {
  const executor = accessExecutorState(input.execSql);
  const state = projectionState(
    accessScopeState(executor, input.organizationId, input.requesterUserId),
    projection,
  );
  return state.denied && state.deniedByServer;
}

export function restoreOrganizationPresentationAccess(
  input: OrganizationPresentationAccessInput,
  attempt: OrganizationPresentationAccessAttempt,
): boolean {
  if (!isOrganizationPresentationAccessAttemptCurrent(input, attempt)) {
    return false;
  }
  const executor = accessExecutorState(input.execSql);
  const state = projectionState(
    accessScopeState(executor, input.organizationId, input.requesterUserId),
    attempt.projection,
  );
  state.denied = false;
  state.deniedByServer = false;
  return true;
}

export async function runOrganizationPresentationRead<T>(
  input: OrganizationPresentationAccessInput,
  projection: OrganizationPresentationProjection,
  operation: () => Promise<T>,
): Promise<T | null> {
  const attempt = captureOrganizationPresentationAccessAttempt(
    input,
    projection,
  );
  if (!isOrganizationPresentationAccessReadable(input, projection)) {
    return null;
  }
  // In-memory denial dies with the process. The durable marker keeps a
  // revoked projection unreadable when its purge failed and the app
  // restarted; a successful reconcile clears it.
  if (await hasOrganizationPresentationDenial(input, projection)) {
    return null;
  }
  const value = await operation();
  return isOrganizationPresentationAccessAttemptCurrent(input, attempt) &&
    isOrganizationPresentationAccessReadable(input, projection)
    ? value
    : null;
}

function beginOrganizationPresentationAccessReset(
  execSql: ExecSql,
  organizationId: string,
): void {
  const executor = accessExecutorState(execSql);
  executor.generationByOrganization.set(
    organizationId,
    organizationGeneration(executor, organizationId) + 1,
  );
  executor.resetDepthByOrganization.set(
    organizationId,
    organizationResetDepth(executor, organizationId) + 1,
  );
  for (const scope of executor.scopes.values()) {
    if (scope.organizationId !== organizationId) continue;
    // A reset denies presentation locally but is not a server denial: the next
    // session re-derives server state, and startup sync already re-drives the
    // lanes, so the lost-access memory must not survive into it.
    scope.readModel.denied = true;
    scope.readModel.deniedByServer = false;
    scope.usage.denied = true;
    scope.usage.deniedByServer = false;
  }
}

function finishOrganizationPresentationAccessReset(
  execSql: ExecSql,
  organizationId: string,
): void {
  const executor = accessExecutorState(execSql);
  const nextDepth = Math.max(
    0,
    organizationResetDepth(executor, organizationId) - 1,
  );
  if (nextDepth === 0) {
    executor.resetDepthByOrganization.delete(organizationId);
  } else {
    executor.resetDepthByOrganization.set(organizationId, nextDepth);
  }
}

export async function runOrganizationPresentationMutation<T>(
  execSql: ExecSql,
  operation: () => Promise<T>,
): Promise<T> {
  const executor = accessExecutorState(execSql);
  const previous = executor.mutationQueue ?? Promise.resolve();
  let releaseCurrent = () => {};
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  const waitForPrevious = previous.catch(() => undefined);
  const queuedCurrent = waitForPrevious.then(() => current);
  executor.mutationQueue = queuedCurrent;
  await waitForPrevious;

  try {
    return await operation();
  } finally {
    releaseCurrent();
    if (executor.mutationQueue === queuedCurrent) {
      executor.mutationQueue = undefined;
    }
  }
}

export async function runOrganizationPresentationReset<T>(
  execSql: ExecSql,
  organizationId: string,
  operation: () => Promise<T>,
): Promise<T> {
  beginOrganizationPresentationAccessReset(execSql, organizationId);
  try {
    return await runOrganizationPresentationMutation(execSql, operation);
  } finally {
    finishOrganizationPresentationAccessReset(execSql, organizationId);
  }
}
