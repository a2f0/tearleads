import { runExpireOrganizationTrialsWorkflow } from "../../workflows/billing/organizationTrialLifecycle";
import type { ApiServiceRuntime } from "../runtime";

/** Composition seam for the out-of-process free-trial expiry worker. */
export function expireOrganizationTrials(
  runtime: ApiServiceRuntime,
  options: { readonly limit?: number; readonly now?: Date } = {},
): Promise<{
  readonly examined: number;
  readonly expired: number;
  readonly failed: number;
}> {
  return runExpireOrganizationTrialsWorkflow(runtime.db, options);
}
