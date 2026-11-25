import { z } from "zod";
import { loosePlainObject, nonEmptyStringSchema } from "../schema";

export const ORGANIZATION_TWO_FACTOR_ERROR_CODES = {
  /**
   * An organization administrator requires two-factor authentication for this
   * member, and the calling session did not pass a second factor. Distinct
   * from an access denial: the client keeps the organization's local data and
   * asks the person to turn on two-factor authentication.
   */
  required: "organization_two_factor_required",
} as const;

/**
 * The 403 an organization-scoped request gets while its organization requires
 * two-factor authentication of a member whose session did not pass one.
 */
export const OrganizationTwoFactorRequiredResponseSchema = loosePlainObject({
  code: z.literal(ORGANIZATION_TWO_FACTOR_ERROR_CODES.required),
  error: z.string(),
  organizationId: nonEmptyStringSchema,
});

export type OrganizationTwoFactorRequiredResponse = z.infer<
  typeof OrganizationTwoFactorRequiredResponseSchema
>;

export function isOrganizationTwoFactorRequiredResponse(
  value: unknown,
): value is OrganizationTwoFactorRequiredResponse {
  return OrganizationTwoFactorRequiredResponseSchema.safeParse(value).success;
}
