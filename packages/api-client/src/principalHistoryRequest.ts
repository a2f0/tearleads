import type { JsonOperation } from "@tearleads/validators/operation";
import type { ApiRequestRuntime } from "./apiRequestRuntime";
import { decodeJsonOperationResponse } from "./operationResponse";
import { PrincipalHistoryRequestContext } from "./principalHistoryRequestContext";
import { requestDeadline } from "./requestDeadline";
import { resourceRequestActivity } from "./resourceRequestActivity";
import type {
  HttpMethod,
  RequestFailure,
  RequestResult,
  RequestResultOptions,
} from "./types";

const PRINCIPAL_HISTORY_READ_TIMEOUT_MS = 15_000;

function requestContext(
  runtime: ApiRequestRuntime,
  input: {
    readonly path: string;
    readonly method: HttpMethod;
    readonly options?: RequestResultOptions;
    readonly context?: PrincipalHistoryRequestContext;
  },
): PrincipalHistoryRequestContext {
  return (
    input.context ??
    new PrincipalHistoryRequestContext(
      runtime,
      input.method,
      input.path,
      input.options,
    )
  );
}

/** Retry only an explicit, validated response proving the operation rolled back. */
export async function principalHistoryRequest<T>(
  runtime: ApiRequestRuntime,
  input: {
    readonly path: string;
    readonly validator: (value: unknown) => value is T;
    /** Maps a schema-valid 200 body to the value the validator checks. */
    readonly decode?: (value: unknown) => unknown;
    readonly method: HttpMethod;
    readonly body?: string;
    readonly options?: RequestResultOptions;
    readonly operation: JsonOperation;
    readonly context?: PrincipalHistoryRequestContext;
    readonly requestTimeoutMs?: number;
  },
): Promise<RequestResult<T>> {
  const { path, method } = input;
  const context = requestContext(runtime, input);
  const options = context.options;
  const progress: PreparationProgress = { previous: undefined, unchanged: 0 };
  while (true) {
    if (context.cancelled()) return context.failure();
    const decoded = await readResponse(runtime, context, input);
    if (!decoded.ok && context.restartReadAfterRenewal()) continue;
    if (!decoded.ok) return preserveCommitUncertainty(method, context, decoded);
    if (decoded.data.status === 202) {
      context.afterPreparation();
      const failure = await continuePreparation(decoded.data.data, progress);
      if (failure)
        return runtime.responseRequest.reportFailure({
          ...failure,
          method,
          options,
          path,
          status: 202,
          statusText: decoded.data.statusText,
        });
      continue;
    }
    const valid = validatedSuccess(decoded.data, input);
    return valid
      ? { ok: true, data: valid.data }
      : invalidResponseFailure(runtime, context, input, decoded.data);
  }
}

function invalidResponseFailure(
  runtime: ApiRequestRuntime,
  context: PrincipalHistoryRequestContext,
  input: { readonly path: string; readonly method: HttpMethod },
  response: { readonly status: number; readonly statusText: string },
): RequestFailure {
  const { path, method } = input;
  const options = context.options;
  const failure = runtime.responseRequest.reportFailure({
    kind: "shape",
    message: `Invalid principal policy response for ${path}`,
    method,
    options: method === "GET" ? options : { ...options, reportErrors: false },
    path,
    status: response.status,
    statusText: response.statusText,
  });
  return preserveCommitUncertainty(method, context, failure);
}

function decodeSuccess(
  response: { readonly data: unknown; readonly status: number },
  decode: ((value: unknown) => unknown) | undefined,
): unknown {
  return response.status === 200 && decode
    ? decode(response.data)
    : response.data;
}

function validatedSuccess<T>(
  response: { readonly data: unknown; readonly status: number },
  input: {
    readonly validator: (value: unknown) => value is T;
    readonly decode?: (value: unknown) => unknown;
  },
): { readonly data: T } | null {
  const data = decodeSuccess(response, input.decode);
  return response.status === 200 && input.validator(data) ? { data } : null;
}

function preserveCommitUncertainty(
  method: HttpMethod,
  context: PrincipalHistoryRequestContext,
  failure: RequestFailure,
): RequestFailure {
  if (method === "GET") return failure;
  // A network/decode failure or intermediary 5xx says nothing about commit.
  // Inner write errors are silent until this final classification is known.
  const ambiguous =
    failure.kind !== "http" ||
    ((failure.status ?? 0) >= 500 &&
      // The declared 503 schema requires the exact code and committed:false.
      // Unvalidated codes never reach RequestFailure.code.
      !(
        failure.status === 503 &&
        failure.code === "principal_history_preparation_unavailable"
      )) ||
    failure.status === 408 ||
    failure.status === 499;
  const result =
    ambiguous && failure.kind !== "outcome-unknown"
      ? context.failure()
      : failure;
  if (
    context.options.reportErrors !== false &&
    (result.kind === "http" || !context.cancelled())
  )
    result.report();
  return result;
}

/** A cancelled request is not a timeout, even if its deadline also passed. */
function interruptedFailure(
  context: PrincipalHistoryRequestContext,
  deadline: { readonly expired: () => boolean },
  response: Response | undefined,
): RequestFailure {
  return context.failure(response, deadline.expired() && !context.cancelled());
}

async function readResponse(
  runtime: ApiRequestRuntime,
  context: PrincipalHistoryRequestContext,
  input: {
    readonly path: string;
    readonly method: HttpMethod;
    readonly body?: string;
    readonly operation: JsonOperation;
    readonly requestTimeoutMs?: number;
  },
) {
  // A fresh timer per response, so preparation continuations reset it.
  const deadline = requestDeadline(
    context.options,
    // Writes await acknowledgement unless the caller supplies a deadline.
    // Aborting a committed write cannot be repaired by the continuation loop.
    input.requestTimeoutMs ??
      (input.method === "GET" ? PRINCIPAL_HISTORY_READ_TIMEOUT_MS : null),
  );
  const options =
    input.method === "GET"
      ? deadline.options
      : { ...deadline.options, reportErrors: false };
  try {
    const session = runtime.responseRequest.sessionSignal?.();
    const response = await context.withCredential(options.signal, () => {
      context.beforeRequest();
      return runtime.responseRequest(
        input.path,
        input.method,
        input.body,
        options,
        [],
        input.operation,
      );
    });
    if (!response) return interruptedFailure(context, deadline, undefined);
    if (!response.ok) {
      // Authentication rejection precedes the workflow and remains definitive.
      if (response.kind === "http" && response.status === 401) return response;
      return (
        (await context.withCredential(options.signal, () => response)) ??
        interruptedFailure(context, deadline, undefined)
      );
    }
    const body = response.data;
    const decoded = await context.withCredential(options.signal, () =>
      decodeJsonOperationResponse(
        runtime.responseRequest,
        input.operation,
        body,
        input.path,
        options,
        session,
      ),
    );
    if (!decoded) return interruptedFailure(context, deadline, body);
    const result = await context.withCredential(options.signal, () =>
      decoded.ok
        ? {
            ok: true as const,
            data: { ...decoded.data, statusText: body.statusText },
          }
        : decoded,
    );
    return result ?? interruptedFailure(context, deadline, body);
  } finally {
    options[resourceRequestActivity]?.finish();
    deadline.dispose();
  }
}

interface PreparationProgress {
  previous: string | undefined;
  unchanged: number;
}

async function continuePreparation(
  data: unknown,
  progress: PreparationProgress,
): Promise<{
  readonly kind: "shape" | "http";
  readonly message: string;
  readonly code?: string;
} | null> {
  const token =
    typeof data === "object" &&
    data !== null &&
    "progressToken" in data &&
    typeof data.progressToken === "string"
      ? data.progressToken
      : undefined;
  if (token === undefined)
    return {
      kind: "shape",
      message: "Principal preparation progress is missing",
    };
  progress.unchanged = token === progress.previous ? progress.unchanged + 1 : 0;
  progress.previous = token;
  if (progress.unchanged >= 2)
    return {
      code: "principal_history_preparation_stalled",
      kind: "http",
      message: "Principal history preparation did not advance; retry later",
    };
  // The next round checks cancellation and identity again before any request.
  await new Promise<void>((resolve) =>
    setTimeout(resolve, progress.unchanged ? 250 : 25),
  );
  return null;
}
