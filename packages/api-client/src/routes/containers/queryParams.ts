import type { SyncWatermark } from "@tearleads/validators/response";
import type { ListContainerDocumentsOptions } from "../../types";
import { pathSegment } from "../path";

function appendQuery(path: string, params: URLSearchParams): string {
  const query = params.toString();
  return query.length === 0 ? path : `${path}?${query}`;
}

function appendOptionalWatermark(
  params: URLSearchParams,
  watermark: SyncWatermark | null | undefined,
) {
  if (!watermark) {
    return;
  }

  params.set("watermarkUpdatedAt", watermark.updatedAt);
  params.set("watermarkId", watermark.id);
}

export function containerDocsPath(
  containerId: string,
  options?: ListContainerDocumentsOptions,
): string {
  const params = new URLSearchParams();
  appendOptionalWatermark(params, options?.watermark);
  if (options?.limit !== undefined) {
    params.set("limit", String(options.limit));
  }

  return appendQuery(
    `/containers/${pathSegment(containerId)}/documents`,
    params,
  );
}
