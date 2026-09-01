import type { TestUser } from "@tearleads/bob-and-alice";
import type { CreateOrganizationRequest } from "@tearleads/validators/request";
import { routeApp } from "../../../src/routeApp";
import { createRegistrationRequestBody } from "./submitRegistration";

/**
 * Builds the provisioning artifacts for an additional organization owned by an
 * already-registered `user`. This is exactly a registration request re-signed
 * with the user's existing identity and a fresh organization/container id, minus
 * the public-key material the server already stores.
 */
export async function createOrganizationRequestBody(
  user: TestUser,
  options: {
    includeOrganizationProfileDocument?: boolean | undefined;
    includeRosterProfileDocument?: boolean | undefined;
    includeTrashSystemContainer?: boolean | undefined;
    organizationId?: string | undefined;
    rootContainerId?: string | undefined;
  } = {},
): Promise<CreateOrganizationRequest> {
  const {
    signingPublicKey: _signingPublicKey,
    encapsulationPublicKey: _encapsulationPublicKey,
    ...request
  } = await createRegistrationRequestBody(
    user.signing.signingPublicKey,
    user.signing.signingPrivateKey,
    user.kem.publicKey,
    { ...options, userId: user.userId },
  );
  return request;
}

export async function submitCreateOrganization(
  user: TestUser,
  body: CreateOrganizationRequest,
): Promise<Response> {
  return routeApp.request("/organizations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${user.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
