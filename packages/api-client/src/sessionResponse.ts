import { errorMessage } from "./requestInternals";
import { responseBodyFailure } from "./responseBodyFailure";
import type {
  HttpMethod,
  OperationResponseRequestFn,
  RequestFailure,
  RequestResult,
  RequestResultOptions,
} from "./types";

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
    if (session?.aborted) return retiredRequest(method, path);
    return { ok: true, data };
  } catch (error) {
    if (session?.aborted) return retiredRequest(method, path);
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
