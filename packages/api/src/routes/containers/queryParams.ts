import type { SyncWatermark } from "@tearleads/validators/response";

export function parseOptionalInteger(
  value: string | undefined,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!/^\d+$/u.test(value)) {
    return Number.NaN;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : Number.NaN;
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
