import { z } from "zod";

export const EffectiveAccessLevelSchema = z.literal(["admin", "read", "write"]);

export type EffectiveAccessLevel = z.infer<typeof EffectiveAccessLevelSchema>;

export function isEffectiveAccessLevel(
  value: unknown,
): value is EffectiveAccessLevel {
  return EffectiveAccessLevelSchema.safeParse(value).success;
}
