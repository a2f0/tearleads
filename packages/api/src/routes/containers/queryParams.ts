import type { SyncWatermark } from "@tearleads/validators/response";

export function parseOptionalInteger(
  value: string | undefined,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  return Number(value);
}

export function parseOptionalParentId(
  value: string | undefined,
): string | null {
  if (value === undefined || value === "null") {
    return null;
  }
  return value;
}

export function parseOptionalWatermark(
  updatedAt: string | undefined,
  id: string | undefined,
): SyncWatermark | undefined {
  if (updatedAt === undefined && id === undefined) {
    return undefined;
  }
  return {
    id: id ?? "",
    updatedAt: updatedAt ?? "",
  };
}
