import type { JsonOperation } from "@tearleads/validators/operation";
import type { ApiRequestRuntime } from "./apiRequestRuntime";
import { decodeJsonOperationResponse } from "./operationResponse";
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
  },
): Promise<RequestResult<T>> {
  const { path, method, body, operation } = input;
  // A continuation belongs to this exact authentication context. Session
  // renewal must not replay it invisibly under a replacement token.
  const options = {
    ...input.options,
    retryOnSessionExpired: "renew-only" as const,
  };
  const authToken = runtime.getAuthToken();
  const progress: PreparationProgress = { previous: undefined, unchanged: 0 };
  const cancelled = () =>
    options.signal?.aborted || runtime.getAuthToken() !== authToken;
  const cancellation = () =>
    runtime.responseRequest.reportFailure({
      code: "principal_history_context_changed",
      kind: "cancelled",
      message: "Principal history request was cancelled",
      method,
      options: { ...options, reportErrors: false },
      path,
      status: null,
      statusText: "",
    });
  while (true) {
    if (cancelled()) return cancellation();
    const response = await runtime.responseRequest(
      path,
      method,
      body,
      options,
      [],
      operation,
    );
    if (cancelled()) return cancellation();
    if (!response.ok) return response;
    const decoded = await decodeJsonOperationResponse(
      runtime.responseRequest,
      operation,
      response.data,
      path,
      options,
    );
    if (cancelled()) return cancellation();
    if (!decoded.ok) return decoded;
    if (decoded.data.status === 202) {
      const failure = await continuePreparation(decoded.data.data, progress);
      if (failure)
        return runtime.responseRequest.reportFailure({
          ...failure,
          method,
          options,
          path,
          status: 202,
          statusText: response.data.statusText,
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
        status: response.data.status,
        statusText: response.data.statusText,
      });
    return { ok: true, data: decoded.data.data };
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
