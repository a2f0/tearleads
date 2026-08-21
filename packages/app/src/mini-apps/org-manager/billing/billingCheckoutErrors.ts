import { BILLING_ERROR_CODES } from "@symcrypt/validators/billing";
import { ORG_MANAGER_LABELS } from "../labels";

/** Maps the server's stable roster-policy failures to actionable copy. */
export function checkoutOptionErrorMessage(error: unknown): string {
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : null;
  if (code === BILLING_ERROR_CODES.rosterOverCapacity) {
    return ORG_MANAGER_LABELS.billingCheckoutOverCapacity;
  }
  if (code === BILLING_ERROR_CODES.checkoutNoActiveMembers) {
    return ORG_MANAGER_LABELS.billingCheckoutNoMembers;
  }
  return ORG_MANAGER_LABELS.billingCheckoutUnavailable;
}
