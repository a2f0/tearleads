import { resolveApiIdentityTrustDomain } from "../apiIdentityTrustDomain";
import type { ApiServiceRuntime } from "./runtime";

/** Pass identity scope explicitly into mutation workflows, never through global state. */
export function createIdentityBoundDatabaseWorkflowService<Input, Result>(
  workflow: (
    db: ApiServiceRuntime["db"],
    input: Input,
    identityTrustDomain: string,
  ) => Promise<Result>,
): (
  runtime: ApiServiceRuntime,
  input: Input,
  requestUrl?: string,
) => Promise<Result> {
  return async (runtime, input, requestUrl) =>
    workflow(
      runtime.db,
      input,
      resolveApiIdentityTrustDomain(runtime.identityTrustDomain, requestUrl),
    );
}
