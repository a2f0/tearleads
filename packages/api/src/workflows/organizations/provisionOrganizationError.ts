import { ContainerMutationError } from "../containers/mutations/errors";
import { DocumentMutationError } from "../documents/mutations";
import { toPrincipalPolicyError } from "../principals/shared";

export class OrganizationProvisioningError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409 | 410 | 500 | 503,
  ) {
    super(message);
  }
}

/**
 * Maps the principal-policy / document / container mutation errors raised while
 * storing provisioning artifacts into a status-bearing
 * {@link OrganizationProvisioningError}. Returns null for unrelated errors so
 * the caller can rethrow.
 */
export function toOrganizationProvisioningError(
  error: unknown,
): OrganizationProvisioningError | null {
  if (!(error instanceof Error)) {
    return null;
  }

  const policyError = toPrincipalPolicyError(error);
  if (policyError) {
    return new OrganizationProvisioningError(
      policyError.message,
      policyError.status,
    );
  }

  if (
    error instanceof DocumentMutationError ||
    error instanceof ContainerMutationError
  ) {
    return new OrganizationProvisioningError(error.message, error.status);
  }

  return null;
}
