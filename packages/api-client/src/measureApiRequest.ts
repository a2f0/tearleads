import type { HttpOperation } from "@tearleads/validators/operation";
import type { ApiRequestInstrumentation } from "./apiRequestMetrics";

/** Counts each fetch, including automatic retries, without consuming bodies. */
export async function measureApiRequest(
  instrumentation: ApiRequestInstrumentation | undefined,
  operation: HttpOperation,
  fetchResponse: () => Promise<Response>,
  signal: AbortSignal | undefined,
): Promise<Response> {
  const finish = instrumentation?.metrics.begin(
    instrumentation.getIdentity(),
    operation,
  );
  try {
    const response = await fetchResponse();
    finish?.(response.status < 400 ? "succeeded" : "failed");
    return response;
  } catch (error) {
    finish?.(signal?.aborted ? "cancelled" : "failed");
    throw error;
  }
}
