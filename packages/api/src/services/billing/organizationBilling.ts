import type { OrganizationBillingResponse } from "@tearleads/validators/response";
import { serializeOrganizationBilling } from "../../billing/organizationBilling";
import {
  runGetOrganizationBillingWorkflow,
  runStartOrganizationTrialWorkflow,
} from "../../workflows/billing/organizationBilling";
import type { ApiServiceRuntime } from "../runtime";

export async function getOrganizationBilling(
  runtime: ApiServiceRuntime,
  organizationId: string,
  sessionUserId: string,
): Promise<OrganizationBillingResponse> {
  return serializeOrganizationBilling(
    await runGetOrganizationBillingWorkflow(
      runtime.db,
      organizationId,
      sessionUserId,
    ),
  );
}

export async function startOrganizationTrial(
  runtime: ApiServiceRuntime,
  organizationId: string,
  sessionUserId: string,
): Promise<OrganizationBillingResponse> {
  return serializeOrganizationBilling(
    await runStartOrganizationTrialWorkflow(
      runtime.db,
      organizationId,
      sessionUserId,
    ),
  );
}
