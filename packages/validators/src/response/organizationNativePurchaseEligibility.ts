import { z } from "zod";
import { loosePlainObject } from "../schema";

export const OrganizationNativePurchaseIneligibilityReasonSchema = z.literal([
  "organization_admin_required",
  "personal_organization_required",
  "terminal_organization",
  "billing_past_due",
  "stripe_subscription_conflict",
  "existing_subscription_conflict",
  "native_subscription_buyer_mismatch",
]);

export type OrganizationNativePurchaseIneligibilityReason = z.infer<
  typeof OrganizationNativePurchaseIneligibilityReasonSchema
>;

/**
 * Authoritative point-in-time policy decision made before a native store flow.
 * The result is provider-neutral: store and catalog identifiers never cross
 * this boundary. Claims and webhooks revalidate because eligibility can change
 * after this response and before the provider finishes taking payment.
 */
export const OrganizationNativePurchaseEligibilityResponseSchema = z.union([
  loosePlainObject({
    eligible: z.literal(true),
    reason: z.null(),
  }),
  loosePlainObject({
    eligible: z.literal(false),
    reason: OrganizationNativePurchaseIneligibilityReasonSchema,
  }),
]);

export type OrganizationNativePurchaseEligibilityResponse = z.infer<
  typeof OrganizationNativePurchaseEligibilityResponseSchema
>;

export function isOrganizationNativePurchaseEligibilityResponse(
  value: unknown,
): value is OrganizationNativePurchaseEligibilityResponse {
  return OrganizationNativePurchaseEligibilityResponseSchema.safeParse(value)
    .success;
}
