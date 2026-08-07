import type { ApiServiceRuntime } from "./runtime";

/**
 * Adapts a database workflow to the route-facing service runtime boundary.
 * Database-only services remain intentional facades: routes depend on services,
 * while services select the runtime capability passed to workflows.
 */
export function createDatabaseWorkflowService<Input, Result>(
  workflow: (db: ApiServiceRuntime["db"], input: Input) => Promise<Result>,
): (runtime: ApiServiceRuntime, input: Input) => Promise<Result> {
  return async (runtime, input) => workflow(runtime.db, input);
}
