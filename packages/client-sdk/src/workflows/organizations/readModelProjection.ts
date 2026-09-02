import type {
  RequestResult,
  RequestResultOptions,
} from "@tearleads/api-client";
import type { OrganizationReadModelResponse } from "@tearleads/validators/response";
import { purgeOrganizationAccessProjection } from "../../data/persistence/organizations/organizationAccessRevocationPersistence";
import { recordOrganizationPresentationDenials } from "../../data/persistence/organizations/organizationPresentationDenialPersistence";
import { loadOrganizationReadModelGroupMembers } from "../../data/persistence/organizations/organizationReadModelMemberLoad";
import { OrganizationReadModelBindingError } from "../../data/persistence/organizations/organizationReadModelMembershipPersistence";
import {
  applyOrganizationReadModelResponse,
  loadOrganizationReadModelProjection,
  type OrganizationReadModelProjection,
  purgeOrganizationReadModelProjection,
} from "../../data/persistence/organizations/organizationReadModelPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  captureOrganizationPresentationAccessAttempt,
  denyOrganizationPresentationAccess,
  isOrganizationPresentationAccessAttemptCurrent,
  isOrganizationPresentationAccessReadable,
  type OrganizationPresentationAccessAttempt,
  type OrganizationPresentationAccessInput,
  restoreOrganizationPresentationAccess,
  runOrganizationPresentationMutation,
  runOrganizationPresentationRead,
} from "./organizationPresentationAccessState";
import { isOrganizationPresentationAccessDeniedFailure } from "./organizationPresentationFailures";
import type { OrganizationDirectoryAndGroups } from "./readModel";

const MAX_READ_MODEL_PAGES = 100;
const MAX_STALE_RETRIES = 1;

interface OrganizationReadModelApi {
  getOrganizationReadModelResult(
    organizationId: string,
    cursor?: string,
    options?: RequestResultOptions,
  ): Promise<RequestResult<OrganizationReadModelResponse>>;
}

interface OrganizationReadModelProjectionInput {
  readonly currentUserId: string;
  readonly execSql: ExecSql;
  readonly organizationId: string;
}

export interface ReconcileOrganizationDirectoryAndGroupsInput
  extends OrganizationReadModelProjectionInput {
  readonly apiClient: OrganizationReadModelApi;
  readonly logError?:
    | ((message: string | Error, cause?: unknown) => void)
    | undefined;
}

function toDirectoryAndGroups(
  projection: OrganizationReadModelProjection | null,
): OrganizationDirectoryAndGroups | null {
  if (!projection?.requester) {
    return null;
  }

  return {
    directory: {
      ...projection.directory,
      currentUser: projection.requester,
    },
    groups: projection.groups.groups,
    memberGroupId: projection.groups.memberGroupId,
    readModelCursor: projection.cursor,
  };
}

async function loadProjection(
  input: OrganizationReadModelProjectionInput,
): Promise<OrganizationReadModelProjection | null> {
  return runOrganizationPresentationRead(
    organizationPresentationAccessInput(input),
    "readModel",
    () => loadRawProjection(input),
  );
}

function loadRawProjection(
  input: OrganizationReadModelProjectionInput,
): Promise<OrganizationReadModelProjection | null> {
  return loadOrganizationReadModelProjection(
    input.execSql,
    input.organizationId,
    input.currentUserId,
  );
}

function organizationPresentationAccessInput(
  input: OrganizationReadModelProjectionInput,
): OrganizationPresentationAccessInput {
  return {
    execSql: input.execSql,
    organizationId: input.organizationId,
    requesterUserId: input.currentUserId,
  };
}

interface ReconciliationState {
  readonly accessAttempt: OrganizationPresentationAccessAttempt;
  expectedLocalCursor: string | null;
  preparedDeniedProjection: boolean;
  projection: OrganizationReadModelProjection | null;
  requestCursor: string | undefined;
  retriedBindingFailure: boolean;
  retriedInvalidCursor: boolean;
  staleRetries: number;
}

type ReconciliationStep =
  | { readonly kind: "continue" }
  | {
      readonly kind: "done";
      readonly value: OrganizationDirectoryAndGroups | null | undefined;
    };

type PageRequestStep =
  | ReconciliationStep
  | {
      readonly kind: "response";
      readonly response: OrganizationReadModelResponse;
    };

function localResult(
  input: ReconcileOrganizationDirectoryAndGroupsInput,
  state: ReconciliationState,
  outcome: { readonly failed: boolean },
): ReconciliationStep {
  const accessInput = organizationPresentationAccessInput(input);
  const readable =
    isOrganizationPresentationAccessAttemptCurrent(
      accessInput,
      state.accessAttempt,
    ) && isOrganizationPresentationAccessReadable(accessInput, "readModel");
  if (!readable) {
    return { kind: "done", value: null };
  }
  const value = toDirectoryAndGroups(state.projection);
  // A failed pass that retained nothing must not read as a completed (null)
  // pass: consumers mark a scope caught up only on completed passes, and this
  // scope still needs a fresh catch-up.
  if (value === null && outcome.failed) {
    return { kind: "done", value: undefined };
  }
  return { kind: "done", value };
}

function resetRequestCursor(state: ReconciliationState): void {
  state.expectedLocalCursor = state.projection?.cursor ?? null;
  state.requestCursor = state.projection?.cursor ?? undefined;
}

async function requestReadModelPage(
  input: ReconcileOrganizationDirectoryAndGroupsInput,
  state: ReconciliationState,
): Promise<PageRequestStep> {
  const result = await input.apiClient.getOrganizationReadModelResult(
    input.organizationId,
    state.requestCursor,
    { reportErrors: false },
  );
  if (result.ok) {
    return { kind: "response", response: result.data };
  }
  if (isOrganizationPresentationAccessDeniedFailure(result)) {
    const accessInput = organizationPresentationAccessInput(input);
    denyOrganizationPresentationAccess(accessInput, ["readModel", "usage"]);
    // The durable marker lands before the purge attempt: if the purge fails,
    // an offline restart must still refuse to serve the revoked projection.
    try {
      await runOrganizationPresentationMutation(input.execSql, () =>
        recordOrganizationPresentationDenials(accessInput, [
          "readModel",
          "usage",
        ]),
      );
    } catch (error) {
      input.logError?.("Failed to record denied organization access", error);
    }
    try {
      await runOrganizationPresentationMutation(input.execSql, () =>
        purgeOrganizationAccessProjection({
          execSql: input.execSql,
          organizationId: input.organizationId,
          requesterUserId: input.currentUserId,
        }),
      );
    } catch (error) {
      input.logError?.("Failed to purge denied organization access", error);
    }
    return { kind: "done", value: null };
  }
  if (
    result.status === 400 &&
    state.requestCursor !== undefined &&
    !state.retriedInvalidCursor
  ) {
    state.requestCursor = undefined;
    state.retriedInvalidCursor = true;
    return { kind: "continue" };
  }

  result.report();
  return localResult(input, state, { failed: true });
}

function responseMatchesRequest(
  input: ReconcileOrganizationDirectoryAndGroupsInput,
  state: ReconciliationState,
  response: OrganizationReadModelResponse,
): boolean {
  if (response.organizationId !== input.organizationId) {
    input.logError?.(
      `Organization read-model response scope does not match ${input.organizationId}`,
    );
    return false;
  }
  if (response.hasMore && response.nextCursor === state.expectedLocalCursor) {
    input.logError?.("Organization read-model page did not advance its cursor");
    return false;
  }
  return true;
}

function reconciliationIsCurrent(
  input: ReconcileOrganizationDirectoryAndGroupsInput,
  state: ReconciliationState,
): boolean {
  return isOrganizationPresentationAccessAttemptCurrent(
    organizationPresentationAccessInput(input),
    state.accessAttempt,
  );
}

type ApplyResponseStep =
  | ReconciliationStep
  | {
      readonly kind: "applied";
      readonly result: Awaited<
        ReturnType<typeof applyOrganizationReadModelResponse>
      >;
    };

async function applyResponse(
  input: ReconcileOrganizationDirectoryAndGroupsInput,
  state: ReconciliationState,
  response: OrganizationReadModelResponse,
): Promise<ApplyResponseStep> {
  try {
    return {
      kind: "applied",
      result: await applyOrganizationReadModelResponse({
        currentUserId: input.currentUserId,
        execSql: input.execSql,
        requestedCursor: state.expectedLocalCursor,
        response,
      }),
    };
  } catch (error) {
    input.logError?.("Failed to apply organization read-model response", error);
    if (
      !(error instanceof OrganizationReadModelBindingError) ||
      state.retriedBindingFailure
    ) {
      return localResult(input, state, { failed: true });
    }
    state.retriedBindingFailure = true;
    await purgeOrganizationReadModelProjection(
      input.execSql,
      input.organizationId,
    );
    if (!reconciliationIsCurrent(input, state)) {
      return { kind: "done", value: null };
    }
    state.projection = null;
    resetRequestCursor(state);
    return { kind: "continue" };
  }
}

async function prepareDeniedProjectionForApply(
  input: ReconcileOrganizationDirectoryAndGroupsInput,
  state: ReconciliationState,
): Promise<ReconciliationStep | null> {
  if (state.preparedDeniedProjection) {
    return null;
  }
  try {
    // The apply that follows replaces the shared rows authoritatively, so
    // only this requester's row is dropped: another local identity sharing
    // the database keeps its access and reads the replacement.
    await purgeOrganizationReadModelProjection(
      input.execSql,
      input.organizationId,
      { onlyRequesterUserId: input.currentUserId },
    );
  } catch (error) {
    input.logError?.("Failed to replace denied organization read model", error);
    return { kind: "done", value: null };
  }
  if (!reconciliationIsCurrent(input, state)) {
    return { kind: "done", value: null };
  }
  state.expectedLocalCursor = null;
  state.preparedDeniedProjection = true;
  state.projection = null;
  return null;
}

async function applyReadModelPage(
  input: ReconcileOrganizationDirectoryAndGroupsInput,
  state: ReconciliationState,
  response: OrganizationReadModelResponse,
): Promise<ReconciliationStep> {
  if (!responseMatchesRequest(input, state, response)) {
    return localResult(input, state, { failed: true });
  }

  const accessInput = organizationPresentationAccessInput(input);
  return runOrganizationPresentationMutation(input.execSql, async () => {
    if (!reconciliationIsCurrent(input, state)) {
      return { kind: "done", value: null };
    }
    const preparation = await prepareDeniedProjectionForApply(input, state);
    if (preparation) {
      return preparation;
    }

    const applied = await applyResponse(input, state, response);
    if (applied.kind !== "applied") {
      return applied;
    }

    state.projection = await loadRawProjection(input);
    if (!reconciliationIsCurrent(input, state)) {
      return { kind: "done", value: null };
    }
    if (applied.result === "stale") {
      if (state.staleRetries >= MAX_STALE_RETRIES) {
        return localResult(input, state, { failed: true });
      }
      state.staleRetries += 1;
      resetRequestCursor(state);
      return { kind: "continue" };
    }

    state.expectedLocalCursor = state.projection?.cursor ?? response.nextCursor;
    if (!response.hasMore) {
      return restoreOrganizationPresentationAccess(
        accessInput,
        state.accessAttempt,
      )
        ? localResult(input, state, { failed: false })
        : { kind: "done", value: null };
    }
    state.requestCursor = response.nextCursor;
    return { kind: "continue" };
  });
}

export async function loadLocalOrganizationDirectoryAndGroups(
  input: OrganizationReadModelProjectionInput,
): Promise<OrganizationDirectoryAndGroups | null> {
  return toDirectoryAndGroups(await loadProjection(input));
}

export async function loadLocalOrganizationGroupMembers(
  input: OrganizationReadModelProjectionInput & { readonly groupId: string },
) {
  return runOrganizationPresentationRead(
    organizationPresentationAccessInput(input),
    "readModel",
    () =>
      loadOrganizationReadModelGroupMembers(
        input.execSql,
        input.organizationId,
        input.groupId,
        input.currentUserId,
      ),
  );
}

/**
 * Resolves the reconciled projection, `null` when the pass completed
 * authoritatively with nothing presentable (including a denial that purged
 * the projection), or `undefined` when the feed failed and no local
 * projection was retained — a pass that must not count as caught up.
 */
export async function reconcileOrganizationDirectoryAndGroups(
  input: ReconcileOrganizationDirectoryAndGroupsInput,
): Promise<OrganizationDirectoryAndGroups | null | undefined> {
  const accessInput = organizationPresentationAccessInput(input);
  const accessAttempt = captureOrganizationPresentationAccessAttempt(
    accessInput,
    "readModel",
  );
  const state: ReconciliationState = {
    accessAttempt,
    expectedLocalCursor: null,
    preparedDeniedProjection: !accessAttempt.startedDenied,
    projection: await loadProjection(input),
    requestCursor: undefined,
    retriedBindingFailure: false,
    retriedInvalidCursor: false,
    staleRetries: 0,
  };
  resetRequestCursor(state);

  for (let page = 0; page < MAX_READ_MODEL_PAGES; page += 1) {
    const request = await requestReadModelPage(input, state);
    if (request.kind === "done") {
      return request.value;
    }
    if (request.kind === "continue") {
      continue;
    }
    const applied = await applyReadModelPage(input, state, request.response);
    if (applied.kind === "done") {
      return applied.value;
    }
  }

  input.logError?.(
    "Organization read-model reconciliation exceeded page limit",
  );
  const retained = localResult(input, state, { failed: true });
  return retained.kind === "done" ? retained.value : null;
}
