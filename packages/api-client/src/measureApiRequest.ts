import type { HttpOperation } from "@tearleads/validators/operation";
import type { ApiRequestInstrumentation } from "./apiRequestMetrics";

type FinishMeasurement = ReturnType<
  ApiRequestInstrumentation["metrics"]["begin"]
>;

function beginMeasurement(
  instrumentation: ApiRequestInstrumentation | undefined,
  operation: HttpOperation,
): FinishMeasurement {
  let finish: FinishMeasurement | undefined;
  try {
    finish = instrumentation?.metrics.begin(
      instrumentation.getIdentity(),
      operation,
    );
  } catch {
    // Optional host instrumentation must not prevent HTTP dispatch.
  }
  return (outcome) => {
    try {
      finish?.(outcome);
    } catch {
      // Nor may a recording failure replace the transport's result.
    }
  };
}

/** Counts each fetch, including automatic retries, without consuming bodies. */
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
    );
    return response;
  } catch (error) {
    finish(signal?.aborted ? "cancelled" : "failed");
    throw error;
  }
}
