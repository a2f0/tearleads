// What a file holds, for the files a document imports or attaches. A file
// manager often hands over a file with no type, or the generic binary type, so
// a known extension stands in for the declared type in that case.

const GENERIC_BINARY_MIME_TYPE = "application/octet-stream";

const MIME_BY_EXTENSION = new Map<string, string>([
  ["csv", "text/csv"],
  ["gif", "image/gif"],
  ["jpeg", "image/jpeg"],
  ["jpg", "image/jpeg"],
  ["json", "application/json"],
  ["m4a", "audio/mp4"],
  ["m4v", "video/mp4"],
  ["mov", "video/quicktime"],
  ["md", "text/markdown"],
  ["mp3", "audio/mpeg"],
  ["mp4", "video/mp4"],
  ["ogg", "audio/ogg"],
  ["ogv", "video/ogg"],
  ["pdf", "application/pdf"],
  ["png", "image/png"],
  ["svg", "image/svg+xml"],
  ["txt", "text/plain"],
  ["wav", "audio/wav"],
  ["webm", "video/webm"],
  ["webp", "image/webp"],
]);

export function getFileExtension(fileName: string): string {
  const extensionStart = fileName.lastIndexOf(".");
  if (extensionStart < 0 || extensionStart === fileName.length - 1) {
    return "";
  }

  return fileName.slice(extensionStart + 1).toLowerCase();
}

export function normalizeMimeType(value: string): string {
  return value.split(";")[0]?.trim().toLowerCase() ?? "";
}

/**
 * The file's declared type, or, when it declares none or only the generic
 * binary type, the type its extension names; blank when neither tells.
 */
export function inferFileMimeType(file: Pick<File, "name" | "type">): string {
  const declaredMimeType = normalizeMimeType(file.type);
  if (
    declaredMimeType.length > 0 &&
    declaredMimeType !== GENERIC_BINARY_MIME_TYPE
  ) {
    return declaredMimeType;
  }

  // The declared type was rejected above (empty or application/octet-stream),
  // so fall back to extension inference only — never re-introduce the
  // unhelpful declared type for an unrecognized extension.
  return MIME_BY_EXTENSION.get(getFileExtension(file.name)) ?? "";
}
