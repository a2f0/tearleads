import {
  isNativeSubscriptionMoveConflict,
  isProviderSubscriptionOwnershipConflict,
} from "../../billing/databaseErrors";
import { OrganizationManagerError } from "../../workflows/organizations/errors";
import { OrganizationBillingProviderUnavailableError } from "./organizationBillingErrors";

export function mapNativeSubscriptionClaimError(error: unknown) {
  if (isProviderSubscriptionOwnershipConflict(error)) {
    return new OrganizationManagerError(
      "The native subscription was moved by another request; refresh and try again",
      409,
    );
  }
  if (isNativeSubscriptionMoveConflict(error)) {
    return new OrganizationBillingProviderUnavailableError(
      "The subscription move was interrupted; try again shortly",
    );
  }
  return null;
}
