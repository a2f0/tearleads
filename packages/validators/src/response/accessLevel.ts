export type EffectiveAccessLevel = "admin" | "read" | "write";

export function isEffectiveAccessLevel(
  value: unknown,
): value is EffectiveAccessLevel {
  return value === "admin" || value === "read" || value === "write";
}
