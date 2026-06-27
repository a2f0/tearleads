import type { ContainerAccessLevel } from "@tearleads/crypto";

export const DEFAULT_EFFECTIVE_ACCESS_LEVEL: ContainerAccessLevel = "admin";

const ACCESS_LEVEL_RANK: Record<ContainerAccessLevel, number> = {
  read: 1,
  write: 2,
  admin: 3,
};

export function normalizeEffectiveAccessLevel(
  value: unknown,
): ContainerAccessLevel {
  return value === "read" || value === "write" || value === "admin"
    ? value
    : DEFAULT_EFFECTIVE_ACCESS_LEVEL;
}

export function canWriteEffectiveAccessLevel(
  value: ContainerAccessLevel | null | undefined,
): boolean {
  return normalizeEffectiveAccessLevel(value) !== "read";
}

export function maxEffectiveAccessLevel(
  current: ContainerAccessLevel,
  incoming: ContainerAccessLevel,
): ContainerAccessLevel {
  return ACCESS_LEVEL_RANK[incoming] > ACCESS_LEVEL_RANK[current]
    ? incoming
    : current;
}
