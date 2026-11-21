import type { HttpOperation } from "@tearleads/validators/operation";
import { requestDeadline } from "../requestDeadline";
import { retiredRequest } from "../sessionResponse";
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
 * Attempts per lane listing, each under its own
 * {@link CONTAINER_LANE_LISTING_TIMEOUT_MS}. A timed-out listing is most
 * likely lost in transit rather than slow: in #3099 the Cloudflare edge
 * accepted one, the Worker never ran it, and the next listing returned in
 * 124 ms. A listing only reads, so it is sent once more before the timeout
 * fails it. Every other failure is final at once.
 */
export const CONTAINER_LANE_LISTING_ATTEMPTS = 2;

interface LaneListingInput<T> {
  readonly body: string;
  readonly method: HttpMethod;
  readonly operation: HttpOperation;
  readonly path: string;
  readonly reportErrors: boolean;
  readonly validator: (value: unknown) => value is T;
}

/**
 * Runs one lane listing in up to {@link CONTAINER_LANE_LISTING_ATTEMPTS}
 * attempts. The deadlines belong to the request, not to a caller, so a
 * de-duplicated listing ends, or is retried, for every caller joined to it.
 * Only the last timeout, before the headers or inside the body, fails the
 * listing: as one network failure rather than a cancellation or a body error,
 * reported once.
 */
export async function laneListingRequest<T>(
  context: ApiClientContext,
  input: LaneListingInput<T>,
): Promise<RequestResult<T>> {
  const { method, path, reportErrors } = input;
  const signIn = context.runtime.responseRequest.sessionSignal?.();
  for (let attempt = 1; ; attempt += 1) {
    const result = await laneListingAttempt(context, input);
    if (signIn?.aborted) return retiredRequest(method, path);
    if (result) {
      if (!result.ok && reportErrors) result.report();
      return result;
    }
    if (attempt >= CONTAINER_LANE_LISTING_ATTEMPTS) break;
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
}

/** One attempt's result, or `null` when its deadline ended it. */
async function laneListingAttempt<T>(
  context: ApiClientContext,
  input: LaneListingInput<T>,
): Promise<RequestResult<T> | null> {
  // Report only after classifying: an abort inside the body otherwise
  // surfaces as a body-read failure before it is known to be the deadline.
  const deadline = requestDeadline(
    { reportErrors: false },
    CONTAINER_LANE_LISTING_TIMEOUT_MS,
  );
  try {
    // Every wait inside the request observes the signal, session renewal
    // included, so the attempt has fully settled, and written its last
    // shared state, by the time the deadline's failure is classified.
    const result = await context.requestResult(
      input.path,
      input.validator,
      input.method,
      input.body,
      deadline.options,
      input.operation,
    );
    return result.ok || !deadline.expired() ? result : null;
  } finally {
    deadline.dispose();
  }
}
