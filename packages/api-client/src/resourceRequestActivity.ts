import type { HttpOperation } from "@tearleads/validators/operation";
import type { ApiRequestMetrics } from "./apiRequestMetrics";

export const resourceRequestActivity = Symbol("resourceRequestActivity");
export interface ResourceRequestActivity {
  start(
    metrics: ApiRequestMetrics,
    identity: string | null,
    operation: HttpOperation,
  ): void;
  finish(): void;
}

/** Start only at fetch dispatch. Release after the response has been read,
 * including on decode failure, cancellation, or an early return. */
export async function withResourceRequestActivity<TOptions extends object, T>(
  resourceId: string,
  options: TOptions,
  request: (
    options: TOptions & { [resourceRequestActivity]: ResourceRequestActivity },
  ) => Promise<T>,
): Promise<T> {
  let release: (() => void) | undefined;
  const activity: ResourceRequestActivity = {
    start(metrics, identity, operation) {
      release ??= metrics.beginResource(identity, operation, resourceId);
    },
    finish() {
      const finish = release;
      release = undefined;
      try {
        finish?.();
      } catch {
        // A host's instrumentation cannot change a request's outcome.
      }
    },
  };
  try {
    return await request({ ...options, [resourceRequestActivity]: activity });
  } finally {
    activity.finish();
  }
}
