import type { ExecSql } from "../../data/sqlite/sqlSchema";

interface AccessScopeState {
  denied: boolean;
  generation: number;
}

interface AccessExecutorState {
  generation: number;
  mutationQueue?: Promise<void> | undefined;
  resetDepth: number;
  readonly scopes: Map<string, AccessScopeState>;
}

interface OrganizationDataUsageAccessAttempt {
  readonly executorGeneration: number;
  readonly scopeGeneration: number;
  readonly startedDuringReset: boolean;
}

const accessByExecutor = new WeakMap<ExecSql, AccessExecutorState>();

function accessExecutorState(execSql: ExecSql): AccessExecutorState {
  let state = accessByExecutor.get(execSql);
  if (!state) {
    state = {
      generation: 0,
      resetDepth: 0,
      scopes: new Map(),
    };
    accessByExecutor.set(execSql, state);
  }
  return state;
}

function scopeKey(organizationId: string, requesterUserId: string): string {
  return JSON.stringify([organizationId, requesterUserId]);
}

function accessScopeState(
  executor: AccessExecutorState,
  organizationId: string,
  requesterUserId: string,
): AccessScopeState {
  const key = scopeKey(organizationId, requesterUserId);
  let scope = executor.scopes.get(key);
  if (!scope) {
    scope = { denied: executor.resetDepth > 0, generation: 0 };
    executor.scopes.set(key, scope);
  }
  return scope;
}

export function captureOrganizationDataUsageAccessAttempt(input: {
  readonly execSql: ExecSql;
  readonly organizationId: string;
  readonly requesterUserId: string;
}): OrganizationDataUsageAccessAttempt {
  const executor = accessExecutorState(input.execSql);
  const scope = accessScopeState(
    executor,
    input.organizationId,
    input.requesterUserId,
  );
  return {
    executorGeneration: executor.generation,
    scopeGeneration: scope.generation,
    startedDuringReset: executor.resetDepth > 0,
  };
}

export function isOrganizationDataUsageAccessAttemptCurrent(
  input: {
    readonly execSql: ExecSql;
    readonly organizationId: string;
    readonly requesterUserId: string;
  },
  attempt: OrganizationDataUsageAccessAttempt,
): boolean {
  const executor = accessExecutorState(input.execSql);
  const scope = accessScopeState(
    executor,
    input.organizationId,
    input.requesterUserId,
  );
  return (
    !attempt.startedDuringReset &&
    executor.resetDepth === 0 &&
    executor.generation === attempt.executorGeneration &&
    scope.generation === attempt.scopeGeneration
  );
}

export function isOrganizationDataUsageAccessReadable(input: {
  readonly execSql: ExecSql;
  readonly organizationId: string;
  readonly requesterUserId: string;
}): boolean {
  const executor = accessExecutorState(input.execSql);
  const scope = accessScopeState(
    executor,
    input.organizationId,
    input.requesterUserId,
  );
  return executor.resetDepth === 0 && !scope.denied;
}

export function denyOrganizationDataUsageAccess(input: {
  readonly execSql: ExecSql;
  readonly organizationId: string;
  readonly requesterUserId: string;
}): void {
  const executor = accessExecutorState(input.execSql);
  const scope = accessScopeState(
    executor,
    input.organizationId,
    input.requesterUserId,
  );
  scope.denied = true;
  scope.generation += 1;
}

export function restoreOrganizationDataUsageAccess(
  input: {
    readonly execSql: ExecSql;
    readonly organizationId: string;
    readonly requesterUserId: string;
  },
  attempt: OrganizationDataUsageAccessAttempt,
): boolean {
  if (!isOrganizationDataUsageAccessAttemptCurrent(input, attempt)) {
    return false;
  }
  const executor = accessExecutorState(input.execSql);
  accessScopeState(
    executor,
    input.organizationId,
    input.requesterUserId,
  ).denied = false;
  return true;
}

function beginOrganizationDataUsageAccessReset(execSql: ExecSql): void {
  const executor = accessExecutorState(execSql);
  executor.generation += 1;
  executor.resetDepth += 1;
  for (const scope of executor.scopes.values()) {
    scope.denied = true;
  }
}

function finishOrganizationDataUsageAccessReset(execSql: ExecSql): void {
  const executor = accessExecutorState(execSql);
  executor.resetDepth = Math.max(0, executor.resetDepth - 1);
}

export async function runOrganizationDataUsageAccessMutation<T>(
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

export async function runOrganizationDataUsageAccessReset<T>(
  execSql: ExecSql,
  operation: () => Promise<T>,
): Promise<T> {
  beginOrganizationDataUsageAccessReset(execSql);
  try {
    return await runOrganizationDataUsageAccessMutation(execSql, operation);
  } finally {
    finishOrganizationDataUsageAccessReset(execSql);
  }
}
