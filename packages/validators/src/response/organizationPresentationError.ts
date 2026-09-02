import { z } from "zod";

/**
 * Read-model and data-usage denials purge requester-scoped presentation data.
 * The same code covers 403 and non-disclosing 404 responses so clients can
 * require positive endpoint evidence without learning whether the org exists.
 */
export const ORGANIZATION_PRESENTATION_ERROR_CODES = {
  accessDenied: "organization_presentation_access_denied",
} as const;

export const OrganizationPresentationErrorCodeSchema = z.literal([
  ORGANIZATION_PRESENTATION_ERROR_CODES.accessDenied,
]);

export type OrganizationPresentationErrorCode = z.infer<
  typeof OrganizationPresentationErrorCodeSchema
>;

export const OrganizationPresentationFailureResponseSchema = z.looseObject({
  code: OrganizationPresentationErrorCodeSchema,
  error: z.string().min(1),
});

export type OrganizationPresentationFailureResponse = z.infer<
  typeof OrganizationPresentationFailureResponseSchema
>;
