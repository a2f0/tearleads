import { errorMessage } from "./requestInternals";
import { responseBodyFailure } from "./responseBodyFailure";
import type {
  HttpMethod,
  OperationResponseRequestFn,
  RequestFailure,
  RequestResult,
  RequestResultOptions,
} from "./types";

export function requestRetired(
  session: AbortSignal | undefined,
  options?: RequestResultOptions,
) {
  return session?.aborted || options?.stillCurrent?.() === false;
}

/** Once headers arrive, caller cancellation also retires response decoding. */
export function responseRetired(
  session?: AbortSignal,
  options?: RequestResultOptions,
) {
  return options?.signal?.aborted || requestRetired(session, options);
}

/** A retired request cannot overwrite the active session's failure cache. */
export function retiredRequest(
  method: HttpMethod,
  path: string,
): RequestFailure {
  return {
    code: "request_aborted",
    kind: "cancelled",
    message: `${method} ${path}: Sign-in ended`,
    method,
    ok: false,
    path,
    report: () => {},
    status: null,
    statusText: "",
  };
}

export async function readSessionJson(
  request: OperationResponseRequestFn,
  response: Response,
  method: HttpMethod,
  path: string,
  options: RequestResultOptions,
  session: AbortSignal | undefined,
): Promise<RequestResult<unknown>> {
  try {
    const data: unknown = await response.json();
    if (responseRetired(session, options)) return retiredRequest(method, path);
    return { ok: true, data };
  } catch (error) {
    if (responseRetired(session, options)) return retiredRequest(method, path);
    const failure = responseBodyFailure(
      error,
      errorMessage(error),
      options.signal?.aborted === true,
    );
    return request.reportFailure({
      ...failure,
      message: `${method} ${path}: ${failure.message}`,
      method,
      options,
      path,
      status: response.status,
      statusText: response.statusText,
    });
  }
}

export function retiredResponse(
  refused: boolean,
  method: HttpMethod,
  path: string,
  response: Response,
  code?: string | null,
): RequestFailure {
  void response.body?.cancel().catch(() => {});
  const retired = retiredRequest(method, path);
  // Principal writes refused before dispatch have a definitive outcome.
  if (response.status !== 401 || !refused) return retired;
  return {
    ...retired,
    kind: "http",
    status: 401,
    statusText: response.statusText,
    code: code ?? undefined,
    message: `${method} ${path}: 401 ${response.statusText}`,
  };
}
