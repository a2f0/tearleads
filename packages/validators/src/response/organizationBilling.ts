import { z } from "zod";
import { BILLING_ERROR_CODES } from "../billing";
import { registerJsonSchemaRuntimeRefinements } from "../jsonSchema";
import { organizationBillingAssignedSeatsRefinement } from "../organizationBillingRefinements";
import {
  arraySchema,
  boundedPositiveIntegerSchema,
  loosePlainObject,
  nonEmptyStringSchema,
  safeNonNegativeIntegerSchema,
} from "../schema";

export const OrganizationBillingStatusSchema = z.literal([
  "local",
  "trialing",
  "active",
  "past_due",
  "disabled",
  "deleting",
  "purged",
]);

export type OrganizationBillingStatus = z.infer<
  typeof OrganizationBillingStatusSchema
>;

export const OrganizationBillingProviderSchema = z.literal(["revenuecat"]);

export type OrganizationBillingProvider = z.infer<
  typeof OrganizationBillingProviderSchema
>;

/**
 * Per-organization sync-billing snapshot returned to the client. Sync is the one
 * paid feature; `status` decides whether the organization may sync at all. A
 * `local` organization is free and on-device only. `trialEndsAt` is set while
 * trialing, `currentPeriodStartsAt`/`currentPeriodEndsAt` while a paid
 * subscription is active, and `seatCount` tracks licensed seats in that paid
 * period. `activeMemberCount` is the server-authoritative signed Members-group
 * count used by the plan switcher; assigned seat fields expose the stable
 * per-user subset that may sync within the licensed capacity.
 */
export const OrganizationBillingResponseSchema =
  registerJsonSchemaRuntimeRefinements(
    loosePlainObject({
      organizationId: z.string(),
      activeMemberCount: safeNonNegativeIntegerSchema,
      assignedSeatCount: safeNonNegativeIntegerSchema,
      assignedUserIds: arraySchema(nonEmptyStringSchema),
      currentUserHasSyncSeat: z.boolean(),
      status: OrganizationBillingStatusSchema,
      trialEndsAt: z.string().nullable(),
      provider: OrganizationBillingProviderSchema.nullable(),
      currentPeriodStartsAt: z.string().nullable(),
      currentPeriodEndsAt: z.string().nullable(),
      seatCount: safeNonNegativeIntegerSchema,
      /** Destination native tier while the store has scheduled but not effected a change. */
      pendingSeatCount: boundedPositiveIntegerSchema(
        Number.MAX_SAFE_INTEGER,
      ).nullable(),
      disabledAt: z.string().nullable(),
      purgeAfter: z.string().nullable(),
    }).superRefine((value, context) => {
      if (value.assignedSeatCount !== value.assignedUserIds.length) {
        context.addIssue({
          code: "custom",
          message: "assignedSeatCount must match assignedUserIds length",
          path: ["assignedSeatCount"],
        });
      }
    }),
    [organizationBillingAssignedSeatsRefinement],
  );

export type OrganizationBillingResponse = z.infer<
  typeof OrganizationBillingResponseSchema
>;

export function isOrganizationBillingStatus(
  value: unknown,
): value is OrganizationBillingStatus {
  return OrganizationBillingStatusSchema.safeParse(value).success;
}

export function isOrganizationBillingProvider(
  value: unknown,
): value is OrganizationBillingProvider {
  return OrganizationBillingProviderSchema.safeParse(value).success;
}

export function isOrganizationBillingResponse(
  value: unknown,
): value is OrganizationBillingResponse {
  // This greenfield contract is deliberately flag-day strict: the server and
  // clients ship the assigned-seat fields together. Missing-field fallbacks
  // would preserve a wire format that has never been released.
  return OrganizationBillingResponseSchema.safeParse(value).success;
}

const BillingErrorCodeSchema = z.literal([
  BILLING_ERROR_CODES.checkoutNoActiveMembers,
  BILLING_ERROR_CODES.rosterOverCapacity,
]);

export const BillingErrorResponseSchema = loosePlainObject({
  code: BillingErrorCodeSchema.optional(),
  error: z.string(),
});

export type BillingErrorResponse = z.infer<typeof BillingErrorResponseSchema>;

/**
 * The HTTP 402 body a sync write returns when its target organization cannot
 * sync. Carries the target organization and whether billing or the caller's
 * seat assignment blocked the write.
 */
export const PaymentRequiredErrorResponseSchema = loosePlainObject({
  error: z.string(),
  organizationId: nonEmptyStringSchema,
  reason: z.literal(["billing_inactive", "sync_seat_unassigned"]),
});

export type PaymentRequiredErrorResponse = z.infer<
  typeof PaymentRequiredErrorResponseSchema
>;

export function isPaymentRequiredErrorResponse(
  value: unknown,
): value is PaymentRequiredErrorResponse {
  // Keep the reason mandatory for the same flag-day contract: a caller must be
  // able to distinguish an inactive organization from an unassigned user.
  return PaymentRequiredErrorResponseSchema.safeParse(value).success;
}
