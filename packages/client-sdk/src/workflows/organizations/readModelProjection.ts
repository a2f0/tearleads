import type {
  RequestResult,
  RequestResultOptions,
} from "@tearleads/api-client";
import type { OrganizationReadModelResponse } from "@tearleads/validators/response";
import {
  applyOrganizationReadModelResponse,
  loadOrganizationReadModelProjection,
  type OrganizationReadModelProjection,
  purgeOrganizationReadModelProjection,
} from "../../data/persistence/organizations/organizationReadModelPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
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
  };
}

async function loadProjection(
  input: OrganizationReadModelProjectionInput,
): Promise<OrganizationReadModelProjection | null> {
  return loadOrganizationReadModelProjection(
    input.execSql,
    input.organizationId,
    input.currentUserId,
  );
}

function reportRetainedFailure(
  failure: Extract<
    Awaited<
      ReturnType<OrganizationReadModelApi["getOrganizationReadModelResult"]>
    >,
    { ok: false }
  >,
): void {
  failure.report();
}

interface ReconciliationState {
  expectedLocalCursor: string | null;
  projection: OrganizationReadModelProjection | null;
  requestCursor: string | undefined;
  retriedInvalidCursor: boolean;
  staleRetries: number;
}

type ReconciliationStep =
  | { readonly kind: "continue" }
  | {
      readonly kind: "done";
      readonly value: OrganizationDirectoryAndGroups | null;
    };

type PageRequestStep =
  | ReconciliationStep
  | {
      readonly kind: "response";
      readonly response: OrganizationReadModelResponse;
    };

function localResult(state: ReconciliationState): ReconciliationStep {
  return { kind: "done", value: toDirectoryAndGroups(state.projection) };
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
  if (result.status === 403 || result.status === 404) {
    await purgeOrganizationReadModelProjection(
      input.execSql,
      input.organizationId,
    );
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

  reportRetainedFailure(result);
  return localResult(state);
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

async function applyReadModelPage(
  input: ReconcileOrganizationDirectoryAndGroupsInput,
  state: ReconciliationState,
  response: OrganizationReadModelResponse,
): Promise<ReconciliationStep> {
  if (!responseMatchesRequest(input, state, response)) {
    return localResult(state);
  }

  let applyResult: Awaited<
    ReturnType<typeof applyOrganizationReadModelResponse>
  >;
  try {
    applyResult = await applyOrganizationReadModelResponse({
      currentUserId: input.currentUserId,
      execSql: input.execSql,
      requestedCursor: state.expectedLocalCursor,
      response,
    });
  } catch (error) {
    input.logError?.("Failed to apply organization read-model response", error);
    return localResult(state);
  }

  state.projection = await loadProjection(input);
  if (applyResult === "stale") {
    if (state.staleRetries >= MAX_STALE_RETRIES) {
      return localResult(state);
    }
    state.staleRetries += 1;
    resetRequestCursor(state);
    return { kind: "continue" };
  }

  state.expectedLocalCursor = state.projection?.cursor ?? response.nextCursor;
  if (!response.hasMore) {
    return localResult(state);
  }
  state.requestCursor = response.nextCursor;
  return { kind: "continue" };
}

export async function loadLocalOrganizationDirectoryAndGroups(
  input: OrganizationReadModelProjectionInput,
): Promise<OrganizationDirectoryAndGroups | null> {
  return toDirectoryAndGroups(await loadProjection(input));
}

export async function reconcileOrganizationDirectoryAndGroups(
  input: ReconcileOrganizationDirectoryAndGroupsInput,
): Promise<OrganizationDirectoryAndGroups | null> {
  const state: ReconciliationState = {
    expectedLocalCursor: null,
    projection: await loadProjection(input),
    requestCursor: undefined,
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
  return toDirectoryAndGroups(state.projection);
}
