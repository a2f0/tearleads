import { isNativeSubscriptionMoveConflict } from "../../billing/databaseErrors";
import { OrganizationManagerError } from "../../workflows/organizations/errors";

export function mapNativeSubscriptionClaimError(
  error: unknown,
): OrganizationManagerError | null {
  return isNativeSubscriptionMoveConflict(error)
    ? new OrganizationManagerError(
        "The native subscription was moved by another request; refresh and try again",
        409,
      )
    : null;
}
