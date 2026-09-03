import { z } from "zod";

export const ORGANIZATION_READ_MODEL_ERROR_CODES = {
  cursorInvalid: "organization_read_model_cursor_invalid",
} as const;

export const OrganizationReadModelErrorCodeSchema = z.literal(
  ORGANIZATION_READ_MODEL_ERROR_CODES.cursorInvalid,
);

export type OrganizationReadModelErrorCode = z.infer<
  typeof OrganizationReadModelErrorCodeSchema
>;

/**
 * A warm client may discard its opaque read-model cursor only when the API
 * positively identifies that cursor as invalid. Other 400s remain uncoded and
 * terminal, while unknown tags fail response-schema validation.
 */
export const OrganizationReadModelFailureResponseSchema = z.looseObject({
  code: OrganizationReadModelErrorCodeSchema.optional(),
  error: z.string().min(1),
});

export type OrganizationReadModelFailureResponse = z.infer<
  typeof OrganizationReadModelFailureResponseSchema
>;
