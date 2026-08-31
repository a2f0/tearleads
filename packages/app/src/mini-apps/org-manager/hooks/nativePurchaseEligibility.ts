import type {
  OrganizationNativePurchaseEligibilityResponse,
  OrganizationNativePurchaseIneligibilityReason,
} from "@symcrypt/validators/response";
import { ORG_MANAGER_LABELS } from "../labels";

export type CheckNativePurchaseEligibility =
  () => Promise<OrganizationNativePurchaseEligibilityResponse | null>;

type EligibilityFailure =
  | OrganizationNativePurchaseIneligibilityReason
  | "unavailable";

export class NativePurchaseEligibilityError extends Error {
  readonly reason: EligibilityFailure;

  constructor(reason: EligibilityFailure, options?: ErrorOptions) {
    super(`Native purchase is ineligible: ${reason}`, options);
    this.name = "NativePurchaseEligibilityError";
    this.reason = reason;
  }
}

export async function requireNativePurchaseEligibility(
  check: CheckNativePurchaseEligibility,
): Promise<void> {
  let result: OrganizationNativePurchaseEligibilityResponse | null;
  try {
    result = await check();
  } catch (cause) {
    throw new NativePurchaseEligibilityError("unavailable", { cause });
  }
  if (!result) {
    throw new NativePurchaseEligibilityError("unavailable");
  }
  if (!result.eligible) {
    throw new NativePurchaseEligibilityError(result.reason);
  }
}

const ELIGIBILITY_LABELS: Record<EligibilityFailure, string> = {
  billing_past_due: ORG_MANAGER_LABELS.billingEligibilityPastDue,
  existing_subscription_conflict:
    ORG_MANAGER_LABELS.billingEligibilityExistingSubscription,
  native_subscription_buyer_mismatch:
    ORG_MANAGER_LABELS.billingEligibilityBuyerMismatch,
  organization_admin_required:
    ORG_MANAGER_LABELS.billingEligibilityAdminRequired,
  personal_organization_required:
    ORG_MANAGER_LABELS.billingEligibilityPersonalRequired,
  stripe_subscription_conflict:
    ORG_MANAGER_LABELS.billingEligibilityStripeConflict,
  terminal_organization: ORG_MANAGER_LABELS.billingEligibilityTerminal,
  unavailable: ORG_MANAGER_LABELS.billingEligibilityUnavailable,
};

export function nativePurchaseEligibilityErrorLabel(
  error: unknown,
): string | null {
  return error instanceof NativePurchaseEligibilityError
    ? ELIGIBILITY_LABELS[error.reason]
    : null;
}
