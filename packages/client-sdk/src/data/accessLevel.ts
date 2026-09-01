import type { ContainerAccessLevel } from "@tearleads/crypto";

// Fail closed: an unknown or missing effective access level is treated as
// read-only. Locally-created records stamp "admin" explicitly at creation time,
// and the server independently enforces writes, so this only down-grades
// un-hydrated data (which the next sync corrects) rather than blocking owners.
export const DEFAULT_EFFECTIVE_ACCESS_LEVEL: ContainerAccessLevel = "read";

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
