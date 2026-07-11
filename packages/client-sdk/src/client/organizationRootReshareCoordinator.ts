import type { ContainerContents } from "./containerContents";
import { logErrorSafely, logErrorToConsole } from "./logger";
import type { PreparedOrganizationRootRewrap } from "./organizationRootReshare";

const INITIAL_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 60_000;

export interface OrganizationDirectoryForRootReshare {
  adminGroupId: string | null;
}

export type LoadOrganizationDirectoryForRootReshare = (
  organizationId: string,
) => Promise<OrganizationDirectoryForRootReshare | null>;

export type ReshareOrganizationRootToAdmins = (input: {
  adminGroupId: string;
  containerContents: ContainerContents;
  organizationId: string;
}) => Promise<void>;

export type PrepareOrganizationRootRewrapToAdmins = (input: {
  adminGroupId: string;
  containerContents: ContainerContents;
  organizationId: string;
}) => Promise<PreparedOrganizationRootRewrap>;

export interface OrganizationRootReshareCoordinator {
  /**
   * Repair or refresh root access when the changed group is Admins.
   *
   * Admins failures intentionally reject. A pending repair does not block an
   * unrelated group mutation, but remains scheduled because the old cached
   * Admins policy may be the only way to unwrap root's stale KEK.
   */
  prepareIfAdminsGroup(input: {
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
  loadDirectory: LoadOrganizationDirectoryForRootReshare;
  logError?: ((message: string | Error, cause?: unknown) => void) | undefined;
  prepare: PrepareOrganizationRootRewrapToAdmins;
  reshare: ReshareOrganizationRootToAdmins;
  scheduleRetry?:
    | ((retry: () => Promise<void>, delayMs: number) => void)
    | undefined;
}

interface OrganizationRootReshareCoordinatorState {
  activeByOrganization: Map<string, ActiveOrganizationRootRewrap>;
  adminGroupIdByOrganization: Map<string, string>;
  deps: OrganizationRootReshareCoordinatorDependencies;
  logError: (message: string | Error, cause?: unknown) => void;
  pendingByOrganization: Map<string, PreparedOrganizationRootRewrap>;
  scheduleRetry: (retry: () => Promise<void>, delayMs: number) => void;
  scheduledByOrganization: Map<string, ScheduledOrganizationRootRewrap>;
}

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
    adminGroupIdByOrganization: new Map(),
    deps,
    logError: (message, cause) => logErrorSafely(logError, message, cause),
    pendingByOrganization: new Map(),
    scheduleRetry: deps.scheduleRetry ?? defaultScheduleRetry,
    scheduledByOrganization: new Map(),
  };
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
  state.activeByOrganization.set(organizationId, {
    prepared,
    promise,
  });
  try {
    await promise;
  } finally {
    const current = state.activeByOrganization.get(organizationId);
    if (current?.promise === promise) {
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
      retryPendingRewrap(state, organizationId, prepared);
      state.logError(
        `Failed to re-wrap organization root for ${organizationId}; retrying`,
        error,
      );
    }
  }, delayMs);
}

async function resolveAdminGroupId(
  state: OrganizationRootReshareCoordinatorState,
  organizationId: string,
): Promise<string> {
  const cached = state.adminGroupIdByOrganization.get(organizationId);
  if (cached) {
    return cached;
  }

  const directory = await state.deps.loadDirectory(organizationId);
  const adminGroupId = directory?.adminGroupId ?? null;
  if (!adminGroupId) {
    throw new Error(
      `Admins group could not be resolved for organization ${organizationId}`,
    );
  }
  state.adminGroupIdByOrganization.set(organizationId, adminGroupId);
  return adminGroupId;
}

async function flushPendingRewrap(input: {
  adminGroupId: string;
  mutatedGroupId: string;
  organizationId: string;
  state: OrganizationRootReshareCoordinatorState;
}): Promise<void> {
  const { adminGroupId, mutatedGroupId, organizationId, state } = input;
  const pending = state.pendingByOrganization.get(organizationId);
  if (!pending) {
    return;
  }

  try {
    await applyPendingRewrap(state, organizationId, pending);
  } catch (error) {
    retryPendingRewrap(state, organizationId, pending);
    if (mutatedGroupId === adminGroupId) {
      throw error;
    }
    state.logError(
      `Failed to re-wrap organization root for ${organizationId}; allowing unrelated group mutation`,
      error,
    );
  }
}

async function applyPreparedRewrap(
  state: OrganizationRootReshareCoordinatorState,
  organizationId: string,
  prepared: PreparedOrganizationRootRewrap,
): Promise<void> {
  const pending = state.pendingByOrganization.get(organizationId);
  if (pending && pending !== prepared) {
    try {
      await applyPendingRewrap(state, organizationId, pending);
    } catch (error) {
      retryPendingRewrap(state, organizationId, pending);
      throw error;
    }
  }

  state.pendingByOrganization.set(organizationId, prepared);
  try {
    await applyPendingRewrap(state, organizationId, prepared);
  } catch (error) {
    retryPendingRewrap(state, organizationId, prepared);
    throw error;
  }
}

async function prepareAdminsRewrap(
  state: OrganizationRootReshareCoordinatorState,
  organizationId: string,
  adminGroupId: string,
): Promise<PreparedOrganizationRootRewrap> {
  const dependencyInput = {
    adminGroupId,
    containerContents: state.deps.containerContents,
    organizationId,
  };
  await state.deps.reshare(dependencyInput);
  const captured = await state.deps.prepare(dependencyInput);
  const prepared: PreparedOrganizationRootRewrap = {
    hasExpectedGroupPolicyHead: () => captured.hasExpectedGroupPolicyHead(),
    rewrap: () => captured.rewrap(),
    setExpectedGroupPolicyHead(head) {
      captured.setExpectedGroupPolicyHead(head);
    },
  };
  return {
    hasExpectedGroupPolicyHead: () => prepared.hasExpectedGroupPolicyHead(),
    async rewrap() {
      // A captured key must not be flushable before the group commit. Activate
      // it only when the post-commit bridge (or ambiguous-failure recovery)
      // invokes this operation.
      await applyPreparedRewrap(state, organizationId, prepared);
    },
    setExpectedGroupPolicyHead: (head) =>
      prepared.setExpectedGroupPolicyHead(head),
  };
}

async function prepareIfAdminsGroup(
  state: OrganizationRootReshareCoordinatorState,
  mutatedGroupId: string,
  organizationId: string,
): Promise<PreparedOrganizationRootRewrap> {
  const adminGroupId = await resolveAdminGroupId(state, organizationId);
  await flushPendingRewrap({
    adminGroupId,
    mutatedGroupId,
    organizationId,
    state,
  });
  if (mutatedGroupId !== adminGroupId) {
    return {
      hasExpectedGroupPolicyHead: () => false,
      rewrap: async () => undefined,
      setExpectedGroupPolicyHead: () => undefined,
    };
  }
  return prepareAdminsRewrap(state, organizationId, adminGroupId);
}

export function createOrganizationRootReshareCoordinator(
  deps: OrganizationRootReshareCoordinatorDependencies,
): OrganizationRootReshareCoordinator {
  const state = createCoordinatorState(deps);
  return {
    prepareIfAdminsGroup: ({ mutatedGroupId, organizationId }) =>
      prepareIfAdminsGroup(state, mutatedGroupId, organizationId),
  };
}
