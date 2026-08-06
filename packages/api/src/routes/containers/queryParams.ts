import type { SyncWatermark } from "@tearleads/validators/response";

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
