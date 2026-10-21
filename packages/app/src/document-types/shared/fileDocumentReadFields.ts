import { useMemo } from "react";
import { formatByteLength } from "../../utils/formatByteLength";
import { formatMiniAppDateTime } from "../../utils/formatMiniAppDate";

export interface FileDocumentField {
  label: string;
  value: string;
}

/** A read-only row a file kind adds, derived from its structured fields. */
export interface FileDocumentExtraField {
  label: string;
  read: (fields: Readonly<Record<string, string>>) => string;
}

function readNumber(value: string | undefined): number | null {
  if (value === undefined || value.trim().length === 0) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function formatStoredByteLength(value: string): string {
  const byteLength = readNumber(value);
  return byteLength === null ? value : formatByteLength(byteLength);
}

/**
 * Importers store the source file's modified time as ISO text; older and
 * seeded documents store epoch milliseconds. Either shows as a date and time.
 */
export function formatSourceLastModified(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) return "";
  const epochMs = /^\d+$/.test(trimmed) ? Number(trimmed) : null;
  return formatMiniAppDateTime(epochMs ?? trimmed);
}

/** Pixel dimensions as "1536 × 1024", or empty when either side is unknown. */
export function readDimensions(
  fields: Readonly<Record<string, string>>,
): string {
  const { height = "", width = "" } = fields;
  const pixelsWide = readNumber(width);
  const pixelsHigh = readNumber(height);
  return pixelsWide && pixelsHigh ? `${pixelsWide} × ${pixelsHigh}` : "";
}

/** Media length as a clock, "3:07" or "1:02:09". */
export function readDuration(fields: Readonly<Record<string, string>>): string {
  const { durationMs: stored = "" } = fields;
  const durationMs = readNumber(stored);
  if (durationMs === null) return "";
  const totalSeconds = Math.round(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
}

export const DIMENSIONS_FIELD: FileDocumentExtraField = {
  label: "Dimensions",
  read: readDimensions,
};

export const DURATION_FIELD: FileDocumentExtraField = {
  label: "Duration",
  read: readDuration,
};

export const PAGE_COUNT_FIELD: FileDocumentExtraField = {
  label: "Pages",
  read: ({ pageCount = "" }) => pageCount,
};

export function useFileDocumentReadFields(params: {
  extraFields: ReadonlyArray<FileDocumentExtraField>;
  structuredFields: Readonly<Record<string, string>>;
}): FileDocumentField[] {
  const { extraFields, structuredFields } = params;
  return useMemo<FileDocumentField[]>(() => {
    const {
      byteLength = "",
      mimeType = "",
      sourceLastModified = "",
    } = structuredFields;
    return [
      { label: "File Type", value: mimeType },
      { label: "Size", value: formatStoredByteLength(byteLength) },
      {
        label: "Last Modified",
        value: formatSourceLastModified(sourceLastModified),
      },
      ...extraFields.map((field) => ({
        label: field.label,
        value: field.read(structuredFields),
      })),
    ];
  }, [extraFields, structuredFields]);
}
