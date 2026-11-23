import type {
  RequestResult,
  RequestResultOptions,
} from "@tearleads/api-client";
import {
  ORGANIZATION_READ_MODEL_ERROR_CODES,
  type OrganizationReadModelResponse,
} from "@tearleads/validators/response";
import type { OrganizationReadModelGroupMembers } from "../../../data/persistence/organizations/organizationReadModelMemberLoad";
import { OrganizationReadModelBindingError } from "../../../data/persistence/organizations/organizationReadModelMembershipPersistence";
import type {
  ApplyOrganizationReadModelResponseResult,
  OrganizationReadModelProjection,
} from "../../../data/persistence/organizations/organizationReadModelPersistence";
import { OrganizationReadModelRepository } from "../../../data/persistence/organizations/organizationReadModelRepository";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import type { OrganizationDirectoryAndGroups } from "./index";
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

/** Applying a page needs no API; `stillCurrent` is rechecked in the write. */
interface ApplyReadModelPageInput extends OrganizationReadModelProjectionInput {
  readonly logError?:
    | ((message: string | Error, cause?: unknown) => void)
    | undefined;
  readonly stillCurrent?: (() => boolean) | undefined;
}

export interface ReconcileOrganizationDirectoryAndGroupsInput
  extends ApplyReadModelPageInput {
  readonly apiClient: OrganizationReadModelApi;
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
    // Hydration decides whether a name is unreadable; a stored blank name may
    // only mean the group has not been hydrated yet.
    groups: projection.groups.groups.map((group) => ({
      ...group,
      nameUnreadable: false,
    })),
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
  return new OrganizationReadModelRepository(
    input.execSql,
  ).loadOrganizationReadModelProjection(
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
  input: ApplyReadModelPageInput,
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
  // Retained rows are available through the local loader, but are not proof
  // that this pass caught up. Returning them after a failed post-commit read
  // makes mutation callers skip their retry and repaint pre-mutation status.
  if (outcome.failed) {
    return { kind: "done", value: undefined };
  }
  return { kind: "done", value: toDirectoryAndGroups(state.projection) };
}

function resetRequestCursor(state: ReconciliationState): void {
  state.expectedLocalCursor = state.projection?.cursor ?? null;
  state.requestCursor = state.projection?.cursor ?? undefined;
}

/** Replays a page that applied stale, up to the retry budget. */
function retryStaleApply(
  input: ApplyReadModelPageInput,
  state: ReconciliationState,
): ReconciliationStep {
  if (state.staleRetries >= MAX_STALE_RETRIES) {
    return localResult(input, state, { failed: true });
  }
  state.staleRetries += 1;
  resetRequestCursor(state);
  return { kind: "continue" };
}

function isInvalidReadModelCursorFailure(
  result: RequestResult<OrganizationReadModelResponse>,
): boolean {
  return (
    !result.ok &&
    result.kind === "http" &&
    result.status === 400 &&
    result.code === ORGANIZATION_READ_MODEL_ERROR_CODES.cursorInvalid
  );
}

async function requestReadModelPage(
  input: ReconcileOrganizationDirectoryAndGroupsInput,
  state: ReconciliationState,
): Promise<PageRequestStep> {
  const result = await input.apiClient.getOrganizationReadModelResult(
    input.organizationId,
    state.requestCursor,
    { reportErrors: false, stillCurrent: input.stillCurrent },
  );
  if (input.stillCurrent?.() === false)
    return { kind: "done", value: undefined };
  if (result.ok) {
    return { kind: "response", response: result.data };
  }
  if (isOrganizationPresentationAccessDeniedFailure(result)) {
    const accessInput = organizationPresentationAccessInput(input);
    denyOrganizationPresentationAccess(accessInput, ["readModel", "usage"]);
    const repository = new OrganizationReadModelRepository(input.execSql);
    // The durable marker lands before the purge attempt: if the purge fails,
    // an offline restart must still refuse to serve the revoked projection.
    try {
      await runOrganizationPresentationMutation(input.execSql, () =>
        repository.recordOrganizationPresentationDenials(accessInput, [
          "readModel",
          "usage",
        ]),
      );
    } catch (error) {
      input.logError?.("Failed to record denied organization access", error);
    }
    try {
      await runOrganizationPresentationMutation(input.execSql, () =>
        repository.purgeOrganizationAccessProjection({
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
    isInvalidReadModelCursorFailure(result) &&
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
  input: ApplyReadModelPageInput,
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
  input: ApplyReadModelPageInput,
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
      readonly result: ApplyOrganizationReadModelResponseResult;
    };

async function applyResponse(
  input: ApplyReadModelPageInput,
  state: ReconciliationState,
  response: OrganizationReadModelResponse,
): Promise<ApplyResponseStep> {
  const repository = new OrganizationReadModelRepository(input.execSql);
  try {
    return {
      kind: "applied",
      result: await repository.applyOrganizationReadModelResponse({
        canCommit: input.stillCurrent,
        currentUserId: input.currentUserId,
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
    await repository.purgeOrganizationReadModelProjection(input.organizationId);
    if (!reconciliationIsCurrent(input, state)) {
      return { kind: "done", value: null };
    }
    state.projection = null;
    resetRequestCursor(state);
    return { kind: "continue" };
  }
}

async function prepareDeniedProjectionForApply(
  input: ApplyReadModelPageInput,
  state: ReconciliationState,
): Promise<ReconciliationStep | null> {
  if (state.preparedDeniedProjection) {
    return null;
  }
  try {
    // The apply that follows replaces the shared rows authoritatively, so
    // only this requester's row is dropped: another local identity sharing
    // the database keeps its access and reads the replacement.
    await new OrganizationReadModelRepository(
      input.execSql,
    ).purgeOrganizationReadModelProjection(input.organizationId, {
      onlyRequesterUserId: input.currentUserId,
    });
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

/** The last page settles only if presentation access is still restorable. */
function finalPageStep(
  input: ApplyReadModelPageInput,
  state: ReconciliationState,
  accessInput: OrganizationPresentationAccessInput,
): ReconciliationStep {
  return restoreOrganizationPresentationAccess(accessInput, state.accessAttempt)
    ? localResult(input, state, { failed: false })
    : { kind: "done", value: null };
}

async function applyReadModelPage(
  input: ApplyReadModelPageInput,
  state: ReconciliationState,
  response: OrganizationReadModelResponse,
): Promise<ReconciliationStep> {
  if (!responseMatchesRequest(input, state, response)) {
    return localResult(input, state, { failed: true });
  }

  const accessInput = organizationPresentationAccessInput(input);
  return runOrganizationPresentationMutation(input.execSql, async () => {
    if (
      !reconciliationIsCurrent(input, state) ||
      input.stillCurrent?.() === false
    )
      return { kind: "done", value: null };
    const preparation = await prepareDeniedProjectionForApply(input, state);
    if (preparation) return preparation;
    const applied = await applyResponse(input, state, response);
    if (applied.kind !== "applied") {
      return applied;
    }

    state.projection = await loadRawProjection(input);
    if (!reconciliationIsCurrent(input, state)) {
      return { kind: "done", value: null };
    }
    if (applied.result === "stale") {
      return retryStaleApply(input, state);
    }

    state.expectedLocalCursor = state.projection?.cursor ?? response.nextCursor;
    if (!response.hasMore) {
      return finalPageStep(input, state, accessInput);
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
): Promise<OrganizationReadModelGroupMembers | null> {
  return runOrganizationPresentationRead(
    organizationPresentationAccessInput(input),
    "readModel",
    () =>
      new OrganizationReadModelRepository(
        input.execSql,
      ).loadOrganizationReadModelGroupMembers(
        input.organizationId,
        input.groupId,
        input.currentUserId,
      ),
  );
}

/**
 * Apply one page as a feed read from `requestedCursor` returns it, with no
 * request, while the projection still holds that cursor. Resolves `undefined`
 * when it is not applied; it is never retried.
 */
export async function applyOrganizationReadModelPageAt(
  input: ApplyReadModelPageInput & {
    readonly requestedCursor: string;
    readonly response: OrganizationReadModelResponse;
  },
): Promise<OrganizationDirectoryAndGroups | null | undefined> {
  const accessAttempt = captureOrganizationPresentationAccessAttempt(
    organizationPresentationAccessInput(input),
    "readModel",
  );
  const projection = await loadProjection(input);
  if (projection?.cursor !== input.requestedCursor) return undefined;
  const applied = await applyReadModelPage(
    input,
    {
      accessAttempt,
      expectedLocalCursor: projection.cursor,
      preparedDeniedProjection: true,
      projection,
      requestCursor: projection.cursor,
      retriedBindingFailure: true,
      retriedInvalidCursor: true,
      staleRetries: MAX_STALE_RETRIES,
    },
    input.response,
  );
  return applied.kind === "done" ? applied.value : undefined;
}

/**
 * Resolves the reconciled projection, `null` when the pass completed
 * authoritatively with nothing presentable (including a denial that purged
 * the projection), or `undefined` when the feed failed — even when local
 * rows remain available. A failed pass must not count as caught up.
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
