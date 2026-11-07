import type { HttpOperation } from "@tearleads/validators/operation";
import { requestDeadline } from "../requestDeadline";
import type { HttpMethod, RequestResult } from "../types";
import type { ApiClientContext } from "./apiClientContext";

/**
 * A container lane listing with no complete response by now is treated as
 * lost. Far above a healthy batch, it bounds every sweep and tree crawl that
 * waits on one: without it, a request that never settles holds the shared
 * listing, and everything joined to it, indefinitely.
 */
export const CONTAINER_LANE_LISTING_TIMEOUT_MS = 60_000;

/**
 * Runs one lane listing under {@link CONTAINER_LANE_LISTING_TIMEOUT_MS}. The
 * deadline belongs to the request, not to a caller, so a de-duplicated
 * listing ends for every caller joined to it. A timeout, before the headers
 * or inside the body, fails as one network failure rather than a cancellation
 * or a body error, so it is reported once and retried like any lost request.
 */
export async function laneListingRequest<T>(
  context: ApiClientContext,
  input: {
    readonly body: string;
    readonly method: HttpMethod;
    readonly operation: HttpOperation;
    readonly path: string;
    readonly reportErrors: boolean;
    readonly validator: (value: unknown) => value is T;
  },
): Promise<RequestResult<T>> {
  const { method, path, reportErrors } = input;
  // Report only after classifying: an abort inside the body otherwise
  // surfaces as a body-read failure before it is known to be the deadline.
  const deadline = requestDeadline(
    { reportErrors: false },
    CONTAINER_LANE_LISTING_TIMEOUT_MS,
  );
  try {
    const result = await context.requestResult(
      path,
      input.validator,
      method,
      input.body,
      deadline.options,
      input.operation,
    );
    if (result.ok) return result;
    if (!deadline.expired()) {
      if (reportErrors) result.report();
      return result;
    }
    return context.runtime.responseRequest.reportFailure({
      code: "request_timed_out",
      kind: "network",
      message: `${method} ${path}: no response within ${CONTAINER_LANE_LISTING_TIMEOUT_MS} ms`,
      method,
      options: { reportErrors },
      path,
      status: null,
      statusText: "",
    });
  } finally {
    deadline.dispose();
  }
}
