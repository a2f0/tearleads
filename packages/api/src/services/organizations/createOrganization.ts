import type { CreateOrganizationRequest } from "@tearleads/validators/request";
import type { CreateOrganizationResponse } from "@tearleads/validators/response";
import { runCreateOrganizationWorkflow } from "../../workflows/organizations/createOrganization";
import {
  OrganizationProvisioningError,
  toOrganizationProvisioningResponse,
} from "../../workflows/organizations/provisionOrganization";
import type { ApiServiceRuntime } from "../runtime";

export { OrganizationProvisioningError };

/**
 * Creates an additional organization for the authenticated user, with that user
 * as its founding admin.
 *
 * The caller may only provision an organization they will own: `input.userId`
 * must be the authenticated user, so a client can never mint an organization
 * whose founding admin is someone else. The new organization starts on
 * local-only billing; upgrading it to sync is a separate, admin-gated action.
 */
export async function createOrganization(
  runtime: ApiServiceRuntime,
  authenticatedUserId: string,
  input: CreateOrganizationRequest,
): Promise<CreateOrganizationResponse> {
  if (input.userId !== authenticatedUserId) {
    throw new OrganizationProvisioningError(
      "Cannot create an organization on behalf of another user",
      403,
    );
  }
  const provisioned = await runCreateOrganizationWorkflow(runtime.db, input);
  return toOrganizationProvisioningResponse(authenticatedUserId, provisioned);
}
