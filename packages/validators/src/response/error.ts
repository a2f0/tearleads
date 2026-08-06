import { z } from "zod";
import { loosePlainObject } from "../schema";

export const ErrorResponseSchema = loosePlainObject({
  error: z.string(),
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

export function isErrorResponse(value: unknown): value is ErrorResponse {
  return ErrorResponseSchema.safeParse(value).success;
}
