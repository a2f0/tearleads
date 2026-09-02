import { z } from "zod";
import { loosePlainObject } from "../../schema";

export const SESSION_ERROR_CODES = {
  refreshRequired: "session_refresh_required",
} as const;

export const SessionErrorCodeSchema = z.literal([
  SESSION_ERROR_CODES.refreshRequired,
]);

export type SessionErrorCode = z.infer<typeof SessionErrorCodeSchema>;

/**
 * Session-authenticated routes may still return ordinary uncoded 401s (for
 * example, a missing bearer token). Only a positively identified stale or
 * invalid server session carries the refresh-required behavior tag.
 */
export const SessionFailureResponseSchema = loosePlainObject({
  code: z.literal(SESSION_ERROR_CODES.refreshRequired).optional(),
  error: z.string().min(1),
});

export type SessionFailureResponse = z.infer<
  typeof SessionFailureResponseSchema
>;

export function isSessionRefreshRequiredFailure(
  value: unknown,
): value is SessionFailureResponse & {
  readonly code: typeof SESSION_ERROR_CODES.refreshRequired;
} {
  const parsed = SessionFailureResponseSchema.safeParse(value);
  return (
    parsed.success && parsed.data.code === SESSION_ERROR_CODES.refreshRequired
  );
}
