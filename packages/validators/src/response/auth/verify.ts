import { z } from "zod";
import { loosePlainObject, nonEmptyStringSchema } from "../../schema";

export const VerifySuccessResponseSchema = loosePlainObject({
  authenticated: z.literal(true),
  error: z.never().optional(),
  /** Platform-operator flag; gates the root console, enforced server-side. */
  isRoot: z.boolean(),
  organizationId: nonEmptyStringSchema,
  token: nonEmptyStringSchema,
  userId: nonEmptyStringSchema,
});

export const VerifyFailureResponseSchema = loosePlainObject({
  authenticated: z.literal(false),
  error: z.string().optional(),
  isRoot: z.never().optional(),
  organizationId: z.never().optional(),
  token: z.never().optional(),
  userId: z.never().optional(),
});

export type VerifySuccessResponse = z.infer<typeof VerifySuccessResponseSchema>;
export type VerifyFailureResponse = z.infer<typeof VerifyFailureResponseSchema>;
export type VerifyResponse = VerifySuccessResponse | VerifyFailureResponse;

export function isVerifyResponse(value: unknown): value is VerifyResponse {
  return (
    VerifySuccessResponseSchema.safeParse(value).success ||
    VerifyFailureResponseSchema.safeParse(value).success
  );
}
