import { serializeKeyingCanonicalJson } from "@tearleads/crypto";
import { getPrincipalPolicyOperation } from "@tearleads/validators/operation";
import {
  isPrincipalPolicyPageResponse,
  isPrincipalPolicyUnchangedResponse,
  type PrincipalPolicyBundleResponse,
  type PrincipalPolicyPageCurrent,
  type PrincipalPolicyPageResponse,
  type PrincipalPolicyReadResponse,
} from "@tearleads/validators/response";
import type { ApiRequestRuntime } from "./apiRequestRuntime";
import {
  principalPolicyPageCurrent,
  readPrincipalPolicyResume,
  validPrincipalPolicyPage,
  validPrincipalPolicyResume,
} from "./policyHistoryPageChecks";
import { principalHistoryRequest } from "./principalHistoryRequest";
import { PrincipalHistoryRequestContext } from "./principalHistoryRequestContext";
import { getPrincipalPolicy } from "./routes/principals/policy";
import type { RequestResult, RequestResultOptions } from "./types";

/** A transport position. Only the caller can authenticate the saved prefix. */
export interface PrincipalPolicyPageResume {
  readonly current: PrincipalPolicyPageCurrent;
  readonly afterVersion: number;
}

export interface PrincipalPolicyPageReadOptions extends RequestResultOptions {
  /** Select an exact signed head even before its first page has been read. */
  readonly stateHash?: string | undefined;
  /** Transport offset for a caller-authenticated prefix; requires stateHash. */
  readonly afterVersion?: number | undefined;
  readonly resume?: PrincipalPolicyPageResume | undefined;
}

function preparePrincipalPolicyRead(
  runtime: ApiRequestRuntime,
  principalType: "group" | "organization",
  principalId: string,
  options: PrincipalPolicyPageReadOptions,
) {
  const query =
    options.stateHash === undefined
      ? {}
      : {
          afterVersion: options.afterVersion ?? 0,
          stateHash: options.stateHash,
        };
  const basePath = getPrincipalPolicy.path(principalType, principalId);
  const failure = (message: string) => ({
    ok: false as const,
    failure: pageFailure(runtime, basePath, options, message, null),
  });
  if (
    options.afterVersion !== undefined &&
    (options.stateHash === undefined ||
      options.resume !== undefined ||
      !Number.isSafeInteger(options.afterVersion))
  )
    return failure("Initial principal history cursor requires one exact head");
  if (!getPrincipalPolicyOperation.query.safeParse(query).success)
    return failure("Invalid requested principal history head");
  const resume = readPrincipalPolicyResume(options.resume);
  if (
    options.resume !== undefined &&
    (!resume ||
      !validPrincipalPolicyResume(
        principalType,
        principalId,
        resume,
        options.stateHash,
      ))
  )
    return failure("Invalid saved principal history position");
  return {
    ok: true as const,
    firstPath: getPrincipalPolicy.path(principalType, principalId, query),
    afterVersion: options.afterVersion ?? 0,
    resume,
  };
}

/** Pull one page at a time; the caller owns verification and durable admission. */
export async function* readPrincipalPolicyPages(
  runtime: ApiRequestRuntime,
  principalType: "group" | "organization",
  principalId: string,
  options: PrincipalPolicyPageReadOptions,
  // Default parameters run when the iterator is created, before its first pull.
  identity = PrincipalHistoryRequestContext.captureIdentity(runtime),
): AsyncGenerator<RequestResult<PrincipalPolicyPageResponse>, void> {
  const position = preparePrincipalPolicyRead(
    runtime,
    principalType,
    principalId,
    options,
  );
  if (!position.ok) {
    yield position.failure;
    return;
  }
  const { firstPath, resume } = position;
  const context = new PrincipalHistoryRequestContext(
    runtime,
    "GET",
    firstPath,
    options,
    identity,
  );
  let pinned = resume?.current;
  let pinnedBytes = resume?.bytes;
  let afterVersion = resume?.afterVersion ?? position.afterVersion;
  while (true) {
    const path = pinned
      ? getPrincipalPolicy.path(principalType, principalId, {
          afterVersion,
          stateHash: pinned.currentState.stateHash,
        })
      : firstPath;
    const result = await principalHistoryRequest(runtime, {
      path,
      validator: isPrincipalPolicyPageResponse,
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
    const artifacts = principalPolicyPageCurrent(page);
    const bytes = serializeKeyingCanonicalJson(artifacts);
    const valid =
      validPrincipalPolicyPage(page, {
        principalType,
        principalId,
        stateHash: options.stateHash,
        afterVersion,
      }) &&
      (pinnedBytes === undefined || bytes === pinnedBytes);
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

/** A head the caller already holds and has authenticated. */
export interface PrincipalPolicyHeldHead {
  readonly version: number;
  readonly stateHash: string;
}

export interface PrincipalPolicyDiscoveryOptions extends RequestResultOptions {
  readonly ifHead?: PrincipalPolicyHeldHead | undefined;
}

/**
 * One unpinned discovery read. With `ifHead`, a server whose live head is
 * exactly that head answers `{ unchanged, head }` instead of the first page.
 * The reply is untrusted: the caller must check the head is the one it holds.
 */
export async function readPrincipalPolicyDiscovery(
  runtime: ApiRequestRuntime,
  principalType: "group" | "organization",
  principalId: string,
  options: PrincipalPolicyDiscoveryOptions,
): Promise<RequestResult<PrincipalPolicyReadResponse>> {
  const { ifHead, ...requestOptions } = options;
  const query = ifHead
    ? { ifVersion: ifHead.version, ifStateHash: ifHead.stateHash }
    : {};
  if (!getPrincipalPolicyOperation.query.safeParse(query).success)
    return pageFailure(
      runtime,
      getPrincipalPolicy.path(principalType, principalId),
      requestOptions,
      "Invalid held principal history head",
      null,
    );
  const path = getPrincipalPolicy.path(principalType, principalId, query);
  const result = await principalHistoryRequest(runtime, {
    path,
    validator: getPrincipalPolicy.isResponse,
    method: "GET",
    operation: getPrincipalPolicyOperation,
    options: requestOptions,
  });
  if (!result.ok) return result;
  const response = result.data;
  // Exactly one variant: the strict bare-head reply, only to a conditional
  // read and only for the requested principal, or a valid first page.
  const unchanged = isPrincipalPolicyUnchangedResponse(response);
  const page = isPrincipalPolicyPageResponse(response);
  const valid = unchanged
    ? !page &&
      ifHead !== undefined &&
      response.head.principalType === principalType &&
      response.head.principalId === principalId
    : page &&
      validPrincipalPolicyPage(response, {
        principalType,
        principalId,
        stateHash: undefined,
        afterVersion: 0,
      });
  return valid
    ? result
    : pageFailure(
        runtime,
        path,
        requestOptions,
        "Principal discovery reply does not match its request",
        200,
      );
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
    current ??= principalPolicyPageCurrent(result.data);
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
