import { z } from "zod";
import { loosePlainObject } from "../schema";

export const HealthResponseSchema = loosePlainObject({
  message: z.string(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export function isHealthResponse(value: unknown): value is HealthResponse {
  return HealthResponseSchema.safeParse(value).success;
}
