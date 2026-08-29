import type { CreateOrganizationRequest } from "@symcrypt/validators/request";
import type { CreateOrganizationResponse } from "@symcrypt/validators/response";
import { publishBestEffort } from "../../utils/publishBestEffort";
import { runCreateOrganizationWorkflow } from "../../workflows/organizations/createOrganization";
import { OrganizationProvisioningError } from "../../workflows/organizations/provisionOrganizationError";
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
  authenticatedSessionId: string,
  input: CreateOrganizationRequest,
): Promise<CreateOrganizationResponse> {
  if (input.userId !== authenticatedUserId) {
    throw new OrganizationProvisioningError(
      "Cannot create an organization on behalf of another user",
      403,
    );
  }
  const response = await runCreateOrganizationWorkflow(runtime.db, input);

  // The transaction has committed a brand-new root that this user's other
  // sessions do not know to list yet. Reuse the same user-scoped discovery hint
  // as a newly shared root; the authoring session is excluded because it owns
  // the provisioning response and persists that state locally itself.
  await publishBestEffort(
    runtime.eventPublisher.publish,
    {
      type: "shared_with_you",
      userId: authenticatedUserId,
      origin: {
        sessionId: authenticatedSessionId,
        userId: authenticatedUserId,
      },
    },
    "organization root discovery notification",
  );

  return response;
}
