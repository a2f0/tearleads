import {
  documentSyncOperation,
  getDocumentWriterProjectionOperation,
  type HttpOperation,
  updateOrganizationProfileOperation,
} from "@tearleads/validators/operation";
import type { ApiRequestInstrumentation } from "./apiRequestMetrics";
import { parseServerTiming, serverTimingHeaderName } from "./serverTiming";

type FinishMeasurement = ReturnType<
  ApiRequestInstrumentation["metrics"]["begin"]
>;
type Outcome = Parameters<FinishMeasurement>[0];

function beginMeasurement(
  instrumentation: ApiRequestInstrumentation | undefined,
  operation: HttpOperation,
  path?: string,
): (outcome: Outcome, response?: Response) => void {
  let finish: FinishMeasurement | undefined;
  try {
    // Only these parameterized routes report live resource activity. Their
    // second path segment is the ID. Queries never enter the metrics store.
    const tracksResource =
      operation.id === documentSyncOperation.id ||
      operation.id === getDocumentWriterProjectionOperation.id ||
      operation.id === updateOrganizationProfileOperation.id;
    const encodedId = tracksResource ? path?.split("/", 3)[2] : undefined;
    finish = instrumentation?.metrics.begin(
      instrumentation.getIdentity(),
      operation,
      encodedId && decodeURIComponent(encodedId),
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
  path?: string,
): Promise<Response> {
  const finish = beginMeasurement(instrumentation, operation, path);
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
