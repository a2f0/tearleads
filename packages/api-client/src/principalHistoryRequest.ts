import type { JsonOperation } from "@tearleads/validators/operation";
import type { ApiRequestRuntime } from "./apiRequestRuntime";
import { decodeJsonOperationResponse } from "./operationResponse";
import { principalHistoryDeadline } from "./principalHistoryDeadline";
import { PrincipalHistoryRequestContext } from "./principalHistoryRequestContext";
import type { HttpMethod, RequestResult, RequestResultOptions } from "./types";

/** Retry only an explicit, validated response proving the operation rolled back. */
export async function principalHistoryRequest<T>(
  runtime: ApiRequestRuntime,
  input: {
    readonly path: string;
    readonly validator: (value: unknown) => value is T;
    readonly method: HttpMethod;
    readonly body?: string;
    readonly options?: RequestResultOptions;
    readonly operation: JsonOperation;
    readonly context?: PrincipalHistoryRequestContext;
    readonly requestTimeoutMs?: number;
  },
): Promise<RequestResult<T>> {
  const { path, method } = input;
  const context =
    input.context ??
    new PrincipalHistoryRequestContext(runtime, method, path, input.options);
  const options = context.options;
  const progress: PreparationProgress = { previous: undefined, unchanged: 0 };
  while (true) {
    if (context.cancelled()) return context.failure();
    context.beforeRequest();
    const decoded = await readResponse(runtime, context, input);
    if (!decoded.ok && context.restartReadAfterRenewal()) continue;
    if (!decoded.ok) return decoded;
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
    if (decoded.data.status !== 200 || !input.validator(decoded.data.data))
      return runtime.responseRequest.reportFailure({
        kind: "shape",
        message: `Invalid principal policy response for ${path}`,
        method,
        options,
        path,
        status: decoded.data.status,
        statusText: decoded.data.statusText,
      });
    return { ok: true, data: decoded.data.data };
  }
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
  const deadline = principalHistoryDeadline(
    context.options,
    input.requestTimeoutMs,
  );
  try {
    const response = await runtime.responseRequest(
      input.path,
      input.method,
      input.body,
      deadline.options,
      [],
      input.operation,
    );
    // Authentication rejection precedes the workflow, so renewal does not make
    // this write's outcome uncertain. Reads may restart after a known renewal.
    if (!response.ok && response.kind === "http" && response.status === 401)
      return response;
    if (context.cancelled() || deadline.expired())
      return context.failure(
        response.ok ? response.data : undefined,
        deadline.expired(),
      );
    if (!response.ok) return response;
    const decoded = await decodeJsonOperationResponse(
      runtime.responseRequest,
      input.operation,
      response.data,
      input.path,
      deadline.options,
    );
    if (context.cancelled() || deadline.expired())
      return context.failure(response.data, deadline.expired());
    if (!decoded.ok) return decoded;
    return {
      ok: true as const,
      data: { ...decoded.data, statusText: response.data.statusText },
    };
  } finally {
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
