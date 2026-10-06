import { serializeKeyingCanonicalJson } from "@tearleads/crypto";
import { getPrincipalPolicyOperation } from "@tearleads/validators/operation";
import type {
  PrincipalPolicyBundleResponse,
  PrincipalPolicyPageResponse,
} from "@tearleads/validators/response";
import type { ApiRequestRuntime } from "./apiRequestRuntime";
import { principalHistoryRequest } from "./principalHistoryRequest";
import { PrincipalHistoryRequestContext } from "./principalHistoryRequestContext";
import { getPrincipalPolicy } from "./routes/principals/policy";
import type { RequestResult, RequestResultOptions } from "./types";

export type PrincipalPolicyPageCurrent = Omit<
  PrincipalPolicyBundleResponse,
  "previousStates"
>;

/** A transport position. Only the caller can authenticate the saved prefix. */
export interface PrincipalPolicyPageResume {
  readonly current: PrincipalPolicyPageCurrent;
  readonly afterVersion: number;
}

export interface PrincipalPolicyPageReadOptions extends RequestResultOptions {
  /** Select an exact signed head even before its first page has been read. */
  readonly stateHash?: string | undefined;
  readonly resume?: PrincipalPolicyPageResume | undefined;
}

function currentArtifacts(page: PrincipalPolicyPageResponse) {
  return {
    currentState: page.currentState,
    currentPayload: page.currentPayload,
    currentProjection: page.currentProjection,
    currentGrants: page.currentGrants,
    currentMemberEnvelopes: page.currentMemberEnvelopes,
  };
}

function validResume(
  principalType: "group" | "organization",
  principalId: string,
  resume: PrincipalPolicyPageResume,
  stateHash: string | undefined,
): boolean {
  const state = resume.current.currentState;
  return (
    Number.isSafeInteger(resume.afterVersion) &&
    resume.afterVersion >= 0 &&
    resume.afterVersion < state.version &&
    state.principalType === principalType &&
    state.principalId === principalId &&
    (stateHash === undefined || state.stateHash === stateHash)
  );
}

function validPage(
  page: PrincipalPolicyPageResponse,
  expected: {
    principalType: "group" | "organization";
    principalId: string;
    stateHash: string | undefined;
    pinnedBytes: string | undefined;
    bytes: string;
    afterVersion: number;
  },
): boolean {
  const { afterVersion } = expected;
  const lastVersion = afterVersion + page.previousStates.length;
  return (
    page.currentState.principalType === expected.principalType &&
    page.currentState.principalId === expected.principalId &&
    (expected.stateHash === undefined ||
      page.currentState.stateHash === expected.stateHash) &&
    (expected.pinnedBytes === undefined ||
      expected.bytes === expected.pinnedBytes) &&
    page.historyPage.afterVersion === afterVersion &&
    lastVersion < page.currentState.version &&
    page.previousStates.every(
      ({ state }, index) =>
        state.version === afterVersion + index + 1 &&
        state.principalId === expected.principalId &&
        state.principalType === expected.principalType,
    ) &&
    (page.historyPage.nextAfterVersion === null
      ? lastVersion === page.currentState.version - 1
      : lastVersion > afterVersion &&
        lastVersion < page.currentState.version - 1 &&
        page.historyPage.nextAfterVersion === lastVersion)
  );
}

/** Pull one page at a time; the caller owns verification and durable admission. */
export async function* readPrincipalPolicyPages(
  runtime: ApiRequestRuntime,
  principalType: "group" | "organization",
  principalId: string,
  options: PrincipalPolicyPageReadOptions,
): AsyncGenerator<RequestResult<PrincipalPolicyPageResponse>, void> {
  const firstPath = getPrincipalPolicy.path(
    principalType,
    principalId,
    options.stateHash
      ? { afterVersion: 0, stateHash: options.stateHash }
      : undefined,
  );
  const context = new PrincipalHistoryRequestContext(
    runtime,
    "GET",
    firstPath,
    options,
  );
  let pinned = options.resume
    ? structuredClone(options.resume.current)
    : undefined;
  let pinnedBytes = pinned ? serializeKeyingCanonicalJson(pinned) : undefined;
  let afterVersion = options.resume?.afterVersion ?? 0;
  if (
    options.resume &&
    !validResume(principalType, principalId, options.resume, options.stateHash)
  ) {
    yield pageFailure(
      runtime,
      firstPath,
      options,
      "Invalid saved principal history position",
      null,
    );
    return;
  }
  while (true) {
    const path = pinned
      ? getPrincipalPolicy.path(principalType, principalId, {
          afterVersion,
          stateHash: pinned.currentState.stateHash,
        })
      : firstPath;
    const result = await principalHistoryRequest(runtime, {
      path,
      validator: getPrincipalPolicy.isResponse,
      method: "GET",
      operation: getPrincipalPolicyOperation,
      options,
      context,
    });
    if (!result.ok) {
      yield result;
      return;
    }
    const page = result.data;
    const artifacts = currentArtifacts(page);
    const bytes = serializeKeyingCanonicalJson(artifacts);
    const valid = validPage(page, {
      principalType,
      principalId,
      stateHash: options.stateHash,
      pinnedBytes,
      bytes,
      afterVersion,
    });
    if (!valid) {
      yield pageFailure(
        runtime,
        path,
        options,
        "Principal history page changed its head, order, or cursor",
        200,
      );
      return;
    }
    pinned ??= structuredClone(artifacts);
    pinnedBytes ??= bytes;
    context.afterReadPage();
    const nextAfterVersion = page.historyPage.nextAfterVersion;
    yield result;
    // A page consumer may await verification or storage while its session ends.
    if (context.cancelled()) {
      yield context.failure();
      return;
    }
    if (nextAfterVersion === null) return;
    afterVersion = nextAfterVersion;
  }
}

/** Full-bundle adapter for consumers that have not adopted durable staging. */
export async function collectPrincipalPolicyPages(
  runtime: ApiRequestRuntime,
  principalType: "group" | "organization",
  principalId: string,
  options: RequestResultOptions,
): Promise<PrincipalPolicyBundleResponse | null> {
  let current: PrincipalPolicyPageCurrent | undefined;
  const previousStates: PrincipalPolicyBundleResponse["previousStates"] = [];
  for await (const result of readPrincipalPolicyPages(
    runtime,
    principalType,
    principalId,
    options,
  )) {
    if (!result.ok) return null;
    current ??= currentArtifacts(result.data);
    previousStates.push(...result.data.previousStates);
  }
  return current ? { ...current, previousStates } : null;
}

function pageFailure(
  runtime: ApiRequestRuntime,
  path: string,
  options: RequestResultOptions,
  message: string,
  status: number | null,
) {
  return runtime.responseRequest.reportFailure({
    kind: "shape",
    message,
    method: "GET",
    options,
    path,
    status,
    statusText: "",
  });
}
