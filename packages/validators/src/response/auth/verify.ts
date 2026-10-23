import { z } from "zod";
import { loosePlainObject, nonEmptyStringSchema } from "../../schema";

export const VERIFY_ERROR_CODES = {
  /**
   * The signature is valid but a platform operator suspended the account.
   * Terminal: renewing the session cannot succeed until the suspension lifts.
   */
  accountSuspended: "account_suspended",
} as const;

export const VerifySuccessResponseSchema = loosePlainObject({
  authenticated: z.literal(true),
  code: z.never().optional(),
  error: z.never().optional(),
  /** Platform-operator flag; gates the root console, enforced server-side. */
  isRoot: z.boolean(),
  organizationId: nonEmptyStringSchema,
  rootContainerId: nonEmptyStringSchema.nullable(),
  token: nonEmptyStringSchema,
  userId: nonEmptyStringSchema,
  /** Single-use upgrade ticket for this session's first websocket connect. */
  wsTicket: nonEmptyStringSchema,
});

export const VerifyFailureResponseSchema = loosePlainObject({
  authenticated: z.literal(false),
  code: z.literal(VERIFY_ERROR_CODES.accountSuspended).optional(),
  error: z.string().optional(),
  isRoot: z.never().optional(),
  organizationId: z.never().optional(),
  rootContainerId: z.never().optional(),
  token: z.never().optional(),
  userId: z.never().optional(),
  wsTicket: z.never().optional(),
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
