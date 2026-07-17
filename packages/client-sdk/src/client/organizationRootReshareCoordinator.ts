import { isKeyingVerificationError } from "../data/keyingProjectionVerification/error";
import type { ContainerContents } from "./containerContents";
import { logErrorSafely, logErrorToConsole } from "./logger";
import type { PreparedOrganizationRootRewrap } from "./organizationRootReshare";

const INITIAL_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 60_000;

export type PrepareOrganizationRootRewrapForGroup = (input: {
  containerContents: ContainerContents;
  groupId: string;
  organizationId: string;
}) => Promise<PreparedOrganizationRootRewrap | null>;

export interface OrganizationRootReshareCoordinator {
  /**
   * Capture root key material only when the signed root manifest directly
   * grants the mutated group admin access. An unrelated group is a no-op.
   */
  prepareForGroupMutation(input: {
    mutatedGroupId: string;
    organizationId: string;
  }): Promise<PreparedOrganizationRootRewrap>;
}

interface ActiveOrganizationRootRewrap {
  prepared: PreparedOrganizationRootRewrap;
  promise: Promise<void>;
}

interface ScheduledOrganizationRootRewrap {
  nextDelayMs: number;
  prepared: PreparedOrganizationRootRewrap;
  scheduled: boolean;
}

interface OrganizationRootReshareCoordinatorDependencies {
  containerContents: ContainerContents;
  logError?: ((message: string | Error, cause?: unknown) => void) | undefined;
  prepare: PrepareOrganizationRootRewrapForGroup;
  scheduleRetry?:
    | ((retry: () => Promise<void>, delayMs: number) => void)
    | undefined;
}

interface OrganizationRootReshareCoordinatorState {
  activeByOrganization: Map<string, ActiveOrganizationRootRewrap>;
  deps: OrganizationRootReshareCoordinatorDependencies;
  logError: (message: string | Error, cause?: unknown) => void;
  pendingByOrganization: Map<string, PreparedOrganizationRootRewrap>;
  scheduleRetry: (retry: () => Promise<void>, delayMs: number) => void;
  scheduledByOrganization: Map<string, ScheduledOrganizationRootRewrap>;
  terminalErrorByOrganization: Map<string, Error>;
}

const NOOP_REWRAP: PreparedOrganizationRootRewrap = {
  hasExpectedGroupPolicyHead: () => false,
  rewrap: async () => undefined,
  setExpectedGroupPolicyHead: () => undefined,
};

function defaultScheduleRetry(
  retry: () => Promise<void>,
  delayMs: number,
): void {
  setTimeout(() => void retry(), delayMs);
}

function createCoordinatorState(
  deps: OrganizationRootReshareCoordinatorDependencies,
): OrganizationRootReshareCoordinatorState {
  const logError = deps.logError ?? logErrorToConsole;
  return {
    activeByOrganization: new Map(),
    deps,
    logError: (message, cause) => logErrorSafely(logError, message, cause),
    pendingByOrganization: new Map(),
    scheduleRetry: deps.scheduleRetry ?? defaultScheduleRetry,
    scheduledByOrganization: new Map(),
    terminalErrorByOrganization: new Map(),
  };
}

function keyingVerificationError(error: unknown): Error | null {
  return isKeyingVerificationError(error) && error instanceof Error
    ? error
    : null;
}

function markTerminalRewrapFailure(
  state: OrganizationRootReshareCoordinatorState,
  organizationId: string,
  prepared: PreparedOrganizationRootRewrap,
  error: Error,
): void {
  state.terminalErrorByOrganization.set(organizationId, error);
  if (state.pendingByOrganization.get(organizationId) === prepared) {
    state.pendingByOrganization.delete(organizationId);
  }
  if (
    state.scheduledByOrganization.get(organizationId)?.prepared === prepared
  ) {
    state.scheduledByOrganization.delete(organizationId);
  }
}

function rethrowTerminalRewrapFailure(
  state: OrganizationRootReshareCoordinatorState,
  organizationId: string,
  prepared: PreparedOrganizationRootRewrap,
  error: unknown,
): void {
  const verificationError = keyingVerificationError(error);
  if (!verificationError) {
    return;
  }
  markTerminalRewrapFailure(state, organizationId, prepared, verificationError);
  throw verificationError;
}

function throwTerminalOrganizationError(
  state: OrganizationRootReshareCoordinatorState,
  organizationId: string,
): void {
  const terminalError = state.terminalErrorByOrganization.get(organizationId);
  if (terminalError) {
    throw terminalError;
  }
}

async function applyOrganizationRootRewrap(
  state: OrganizationRootReshareCoordinatorState,
  organizationId: string,
  prepared: PreparedOrganizationRootRewrap,
): Promise<void> {
  if (state.pendingByOrganization.get(organizationId) !== prepared) {
    return;
  }

  const active = state.activeByOrganization.get(organizationId);
  if (active) {
    await active.promise;
    if (active.prepared === prepared) {
      return;
    }
    return applyOrganizationRootRewrap(state, organizationId, prepared);
  }

  const promise = (async () => {
    await prepared.rewrap();
    if (state.pendingByOrganization.get(organizationId) === prepared) {
      state.pendingByOrganization.delete(organizationId);
    }
  })();
  state.activeByOrganization.set(organizationId, { prepared, promise });
  try {
    await promise;
  } finally {
    if (state.activeByOrganization.get(organizationId)?.promise === promise) {
      state.activeByOrganization.delete(organizationId);
    }
  }
}

async function applyPendingRewrap(
  state: OrganizationRootReshareCoordinatorState,
  organizationId: string,
  prepared: PreparedOrganizationRootRewrap,
): Promise<void> {
  await applyOrganizationRootRewrap(state, organizationId, prepared);
  const scheduled = state.scheduledByOrganization.get(organizationId);
  if (
    scheduled?.prepared === prepared &&
    state.pendingByOrganization.get(organizationId) !== prepared
  ) {
    state.scheduledByOrganization.delete(organizationId);
  }
}

function retryPendingRewrap(
  state: OrganizationRootReshareCoordinatorState,
  organizationId: string,
  prepared: PreparedOrganizationRootRewrap,
): void {
  if (state.pendingByOrganization.get(organizationId) !== prepared) {
    return;
  }

  const current = state.scheduledByOrganization.get(organizationId);
  if (current?.prepared === prepared && current.scheduled) {
    return;
  }

  const delayMs =
    current?.prepared === prepared
      ? current.nextDelayMs
      : INITIAL_RETRY_DELAY_MS;
  const scheduled: ScheduledOrganizationRootRewrap = {
    nextDelayMs: Math.min(delayMs * 2, MAX_RETRY_DELAY_MS),
    prepared,
    scheduled: true,
  };
  state.scheduledByOrganization.set(organizationId, scheduled);
  state.scheduleRetry(async () => {
    if (
      state.scheduledByOrganization.get(organizationId) !== scheduled ||
      state.pendingByOrganization.get(organizationId) !== prepared
    ) {
      return;
    }

    scheduled.scheduled = false;
    try {
      await applyPendingRewrap(state, organizationId, prepared);
    } catch (error) {
      const verificationError = keyingVerificationError(error);
      if (verificationError) {
        markTerminalRewrapFailure(
          state,
          organizationId,
          prepared,
          verificationError,
        );
        state.logError(
          `Stopped organization root re-wrap retries for ${organizationId} after an identity verification failure`,
          verificationError,
        );
        return;
      }
      retryPendingRewrap(state, organizationId, prepared);
      state.logError(
        `Failed to re-wrap organization root for ${organizationId}; retrying`,
        error,
      );
    }
  }, delayMs);
}

async function flushPendingRewrap(
  state: OrganizationRootReshareCoordinatorState,
  organizationId: string,
): Promise<void> {
  const pending = state.pendingByOrganization.get(organizationId);
  if (!pending) {
    return;
  }
  try {
    await applyPendingRewrap(state, organizationId, pending);
  } catch (error) {
    rethrowTerminalRewrapFailure(state, organizationId, pending, error);
    retryPendingRewrap(state, organizationId, pending);
    throw error;
  }
}

async function applyPreparedRewrap(
  state: OrganizationRootReshareCoordinatorState,
  organizationId: string,
  prepared: PreparedOrganizationRootRewrap,
): Promise<void> {
  throwTerminalOrganizationError(state, organizationId);
  await flushPendingRewrap(state, organizationId);
  state.pendingByOrganization.set(organizationId, prepared);
  try {
    await applyPendingRewrap(state, organizationId, prepared);
  } catch (error) {
    rethrowTerminalRewrapFailure(state, organizationId, prepared, error);
    retryPendingRewrap(state, organizationId, prepared);
    throw error;
  }
}

function wrapPreparedRewrap(
  state: OrganizationRootReshareCoordinatorState,
  organizationId: string,
  captured: PreparedOrganizationRootRewrap,
): PreparedOrganizationRootRewrap {
  const prepared: PreparedOrganizationRootRewrap = {
    hasExpectedGroupPolicyHead: () => captured.hasExpectedGroupPolicyHead(),
    rewrap: () => captured.rewrap(),
    setExpectedGroupPolicyHead: (head) =>
      captured.setExpectedGroupPolicyHead(head),
  };
  return {
    hasExpectedGroupPolicyHead: () => prepared.hasExpectedGroupPolicyHead(),
    rewrap: () => applyPreparedRewrap(state, organizationId, prepared),
    setExpectedGroupPolicyHead: (head) =>
      prepared.setExpectedGroupPolicyHead(head),
  };
}

async function prepareForGroupMutation(
  state: OrganizationRootReshareCoordinatorState,
  mutatedGroupId: string,
  organizationId: string,
): Promise<PreparedOrganizationRootRewrap> {
  const captured = await state.deps.prepare({
    containerContents: state.deps.containerContents,
    groupId: mutatedGroupId,
    organizationId,
  });
  if (!captured) {
    return NOOP_REWRAP;
  }
  throwTerminalOrganizationError(state, organizationId);
  await flushPendingRewrap(state, organizationId);
  return wrapPreparedRewrap(state, organizationId, captured);
}

export function createOrganizationRootReshareCoordinator(
  deps: OrganizationRootReshareCoordinatorDependencies,
): OrganizationRootReshareCoordinator {
  const state = createCoordinatorState(deps);
  return {
    prepareForGroupMutation: ({ mutatedGroupId, organizationId }) =>
      prepareForGroupMutation(state, mutatedGroupId, organizationId),
  };
}
