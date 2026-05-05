import type { SyncWatermark } from "@tearleads/validators/response";

export function appendQuery(path: string, params: URLSearchParams): string {
  const query = params.toString();
  return query.length === 0 ? path : `${path}?${query}`;
}

export function appendOptionalWatermark(
  params: URLSearchParams,
  watermark: SyncWatermark | null | undefined,
) {
  if (!watermark) {
    return;
  }

  params.set("watermarkUpdatedAt", watermark.updatedAt);
  params.set("watermarkId", watermark.id);
}
