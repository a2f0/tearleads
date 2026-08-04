import {
  type ExpireOrganizationTrialsOptions,
  type ExpireOrganizationTrialsSummary,
  runExpireOrganizationTrialsWorkflow,
} from "../../workflows/billing/organizationTrialLifecycle";
import type { ApiServiceRuntime } from "../runtime";

/** Composition seam for the out-of-process free-trial expiry worker. */
export function expireOrganizationTrials(
  runtime: ApiServiceRuntime,
  options: ExpireOrganizationTrialsOptions = {},
): Promise<ExpireOrganizationTrialsSummary> {
  return runExpireOrganizationTrialsWorkflow(runtime.db, options);
}
