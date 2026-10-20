import type { HttpOperation } from "@tearleads/validators/operation";
import type { ApiRequestInstrumentation } from "./apiRequestMetrics";
import { parseServerTiming, serverTimingHeaderName } from "./serverTiming";

type FinishMeasurement = ReturnType<
  ApiRequestInstrumentation["metrics"]["begin"]
>;
type Outcome = Parameters<FinishMeasurement>[0];

function beginMeasurement(
  instrumentation: ApiRequestInstrumentation | undefined,
  operation: HttpOperation,
): (outcome: Outcome, response?: Response) => void {
  let finish: FinishMeasurement | undefined;
  try {
    finish = instrumentation?.metrics.begin(
      instrumentation.getIdentity(),
      operation,
    );
  } catch {
    // Optional host instrumentation must not prevent HTTP dispatch.
  }
  return (outcome, response) => {
    try {
      finish?.(
        outcome,
        response &&
          parseServerTiming(response.headers.get(serverTimingHeaderName)),
      );
    } catch {
      // Nor may a recording failure replace the transport's result.
    }
  };
}

/**
 * Counts and times each fetch, including automatic retries, without consuming
 * bodies: an attempt ends when its response headers arrive or it fails.
 */
export async function measureApiRequest(
  instrumentation: ApiRequestInstrumentation | undefined,
  operation: HttpOperation,
  fetchResponse: () => Promise<Response>,
  signal: AbortSignal | undefined,
): Promise<Response> {
  const finish = beginMeasurement(instrumentation, operation);
  try {
    const response = await fetchResponse();
    finish(
      response.status >= 200 && response.status < 400 ? "succeeded" : "failed",
      response,
    );
    return response;
  } catch (error) {
    finish(signal?.aborted ? "cancelled" : "failed");
    throw error;
  }
}
