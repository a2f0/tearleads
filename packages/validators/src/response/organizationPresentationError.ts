import { z } from "zod";

/**
 * Read-model and data-usage denials purge requester-scoped presentation data.
 * The same code covers the existing 403 access-denied and 404 missing-org
 * responses so clients can require positive endpoint evidence without matching
 * diagnostic text.
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
