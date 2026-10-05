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
  const options = { ...input.options, retryOnSessionExpired: false };
  const authToken = runtime.getAuthToken();
  const cancelled = () =>
    options.signal?.aborted || runtime.getAuthToken() !== authToken;
  const cancellation = () =>
    runtime.responseRequest.reportFailure({
      kind: "network",
      message: "Principal history request was cancelled",
      method,
      options,
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
      // Yield between independently bounded requests. Cancellation and identity
      // changes stop before issuing another request; transport failures never retry.
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
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
