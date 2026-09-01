import type {
  DocumentAttachmentUpload,
  StoredDocumentKind,
} from "@tearleads/client-sdk";
import { AUDIO_DOCUMENT_KIND } from "./audio/audioDocumentDefinition";
import {
  ENV_FILE_DOCUMENT_KIND,
  ENV_FILE_VARIABLE_KEY_FIELD,
  ENV_FILE_VARIABLE_VALUE_FIELD,
  parseEnvFileText,
} from "./env-file/envFileDocumentDefinition";
import { GENERIC_FILE_DOCUMENT_KIND } from "./generic-file/genericFileDocumentDefinition";
import { IMAGE_DOCUMENT_KIND } from "./image/imageDocumentDefinition";
import { JSON_FILE_DOCUMENT_KIND } from "./json-file/jsonFileDocumentDefinition";
import { APP_DEFAULT_DOCUMENT_KIND } from "./note/noteDocumentDefinition";
import { PDF_DOCUMENT_KIND } from "./pdf/pdfDocumentDefinition";
import { VIDEO_DOCUMENT_KIND } from "./video/videoDocumentDefinition";

export const TEXT_FILE_IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const BINARY_FILE_IMPORT_MAX_BYTES = 1024 * 1024 * 1024;
const IMAGE_DIMENSION_PROBE_MAX_BYTES = 5 * 1024 * 1024;

interface DocumentFileImportResult {
  attachment: DocumentAttachmentUpload | null;
  documentKind: StoredDocumentKind;
  initialText: string;
  // Rows seeded into the document's first-class row list after creation (e.g. a
  // .env file's parsed variables). Each entry is one row's field map.
  rows?: ReadonlyArray<Readonly<Record<string, string>>>;
  structuredFields: Readonly<Record<string, string>>;
}

interface DocumentFileImporter {
  documentKind: StoredDocumentKind;
  importFile: (file: File) => Promise<DocumentFileImportResult>;
  maxByteLength: number;
}

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

const TEXT_EXTENSIONS = new Set(["csv", "md", "txt"]);
const IMAGE_EXTENSIONS = new Set(["gif", "jpeg", "jpg", "png", "svg", "webp"]);
const AUDIO_EXTENSIONS = new Set(["m4a", "mp3", "ogg", "wav"]);
const VIDEO_EXTENSIONS = new Set(["m4v", "mov", "mp4", "ogv", "webm"]);

function getFileExtension(fileName: string): string {
  const extensionStart = fileName.lastIndexOf(".");
  if (extensionStart < 0 || extensionStart === fileName.length - 1) {
    return "";
  }

  return fileName.slice(extensionStart + 1).toLowerCase();
}

function normalizeMimeType(value: string): string {
  return value.split(";")[0]?.trim().toLowerCase() ?? "";
}

function inferMimeType(file: File): string {
  const declaredMimeType = normalizeMimeType(file.type);
  if (
    declaredMimeType.length > 0 &&
    declaredMimeType !== "application/octet-stream"
  ) {
    return declaredMimeType;
  }

  // The declared type was rejected above (empty or application/octet-stream),
  // so fall back to extension inference only — never re-introduce the
  // unhelpful declared type for an unrecognized extension.
  return MIME_BY_EXTENSION.get(getFileExtension(file.name)) ?? "";
}

function formatSourceLastModified(lastModified: number): string {
  if (!Number.isFinite(lastModified) || lastModified <= 0) {
    return "";
  }

  try {
    return new Date(lastModified).toISOString();
  } catch {
    return "";
  }
}

function createCommonMetadata(file: File): Record<string, string> {
  return {
    byteLength: String(file.size),
    fileName: file.name,
    mimeType: inferMimeType(file),
    sourceLastModified: formatSourceLastModified(file.lastModified),
  };
}

function readSvgDimension(
  source: string,
  attribute: "height" | "width",
): string {
  const match = source.match(
    new RegExp(`\\b${attribute}\\s*=\\s*["']([^"']+)["']`, "iu"),
  );
  return match?.[1]?.trim() ?? "";
}

function readSvgViewBoxDimensions(source: string): {
  height: string;
  width: string;
} {
  const match = source.match(/\bviewBox\s*=\s*["']([^"']+)["']/iu);
  const parts = match?.[1]?.trim().split(/\s+/u) ?? [];
  return {
    height: parts[3] ?? "",
    width: parts[2] ?? "",
  };
}

function readSvgOpeningTag(source: string): string {
  const sourceWithoutComments = source.replaceAll(/<!--[\s\S]*?-->/gu, "");
  return sourceWithoutComments.match(/<svg\b[^>]*>/iu)?.[0] ?? "";
}

async function readImageDimensions(
  file: File,
): Promise<Record<string, string>> {
  if (file.size > IMAGE_DIMENSION_PROBE_MAX_BYTES) {
    return {};
  }

  if (inferMimeType(file) === "image/svg+xml") {
    try {
      const source = await file.text();
      const svgTag = readSvgOpeningTag(source);
      const viewBoxDimensions = readSvgViewBoxDimensions(svgTag);
      return {
        height: readSvgDimension(svgTag, "height") || viewBoxDimensions.height,
        width: readSvgDimension(svgTag, "width") || viewBoxDimensions.width,
      };
    } catch {
      return {};
    }
  }

  if (typeof createImageBitmap !== "function") {
    return {};
  }

  try {
    const bitmap = await createImageBitmap(file);
    try {
      return {
        height: String(bitmap.height),
        width: String(bitmap.width),
      };
    } finally {
      bitmap.close();
    }
  } catch {
    return {};
  }
}

async function readAttachmentUpload(
  file: File,
): Promise<DocumentAttachmentUpload> {
  const mimeType = inferMimeType(file);
  return {
    bytes: file,
    mimeType: mimeType.length > 0 ? mimeType : null,
    name: file.name,
  };
}

const noteFileImporter: DocumentFileImporter = {
  documentKind: APP_DEFAULT_DOCUMENT_KIND,
  importFile: async (file) => ({
    attachment: null,
    documentKind: APP_DEFAULT_DOCUMENT_KIND,
    initialText: await file.text(),
    structuredFields: {},
  }),
  maxByteLength: TEXT_FILE_IMPORT_MAX_BYTES,
};

const envFileImporter: DocumentFileImporter = {
  documentKind: ENV_FILE_DOCUMENT_KIND,
  importFile: async (file) => ({
    attachment: null,
    documentKind: ENV_FILE_DOCUMENT_KIND,
    initialText: "",
    rows: parseEnvFileText(await file.text()).map((variable) => ({
      [ENV_FILE_VARIABLE_KEY_FIELD]: variable.key,
      [ENV_FILE_VARIABLE_VALUE_FIELD]: variable.value,
    })),
    structuredFields: {
      fileName: file.name,
    },
  }),
  maxByteLength: TEXT_FILE_IMPORT_MAX_BYTES,
};

const jsonFileImporter: DocumentFileImporter = {
  documentKind: JSON_FILE_DOCUMENT_KIND,
  importFile: async (file) => ({
    attachment: null,
    documentKind: JSON_FILE_DOCUMENT_KIND,
    initialText: await file.text(),
    structuredFields: {
      fileName: file.name,
    },
  }),
  maxByteLength: TEXT_FILE_IMPORT_MAX_BYTES,
};

const imageFileImporter: DocumentFileImporter = {
  documentKind: IMAGE_DOCUMENT_KIND,
  importFile: async (file) => ({
    attachment: await readAttachmentUpload(file),
    documentKind: IMAGE_DOCUMENT_KIND,
    initialText: "",
    structuredFields: {
      ...createCommonMetadata(file),
      ...(await readImageDimensions(file)),
    },
  }),
  maxByteLength: BINARY_FILE_IMPORT_MAX_BYTES,
};

const audioFileImporter: DocumentFileImporter = {
  documentKind: AUDIO_DOCUMENT_KIND,
  importFile: async (file) => ({
    attachment: await readAttachmentUpload(file),
    documentKind: AUDIO_DOCUMENT_KIND,
    initialText: "",
    structuredFields: {
      ...createCommonMetadata(file),
      durationMs: "",
    },
  }),
  maxByteLength: BINARY_FILE_IMPORT_MAX_BYTES,
};

const videoFileImporter: DocumentFileImporter = {
  documentKind: VIDEO_DOCUMENT_KIND,
  importFile: async (file) => ({
    attachment: await readAttachmentUpload(file),
    documentKind: VIDEO_DOCUMENT_KIND,
    initialText: "",
    structuredFields: {
      ...createCommonMetadata(file),
      durationMs: "",
      height: "",
      width: "",
    },
  }),
  maxByteLength: BINARY_FILE_IMPORT_MAX_BYTES,
};

const pdfFileImporter: DocumentFileImporter = {
  documentKind: PDF_DOCUMENT_KIND,
  importFile: async (file) => ({
    attachment: await readAttachmentUpload(file),
    documentKind: PDF_DOCUMENT_KIND,
    initialText: "",
    structuredFields: {
      ...createCommonMetadata(file),
      pageCount: "",
    },
  }),
  maxByteLength: BINARY_FILE_IMPORT_MAX_BYTES,
};

const genericFileImporter: DocumentFileImporter = {
  documentKind: GENERIC_FILE_DOCUMENT_KIND,
  importFile: async (file) => ({
    attachment: await readAttachmentUpload(file),
    documentKind: GENERIC_FILE_DOCUMENT_KIND,
    initialText: "",
    structuredFields: createCommonMetadata(file),
  }),
  maxByteLength: BINARY_FILE_IMPORT_MAX_BYTES,
};

function getImporterForMimeType(mimeType: string): DocumentFileImporter | null {
  if (mimeType === "application/json" || mimeType.endsWith("+json")) {
    return jsonFileImporter;
  }
  if (mimeType.startsWith("text/") || mimeType === "application/csv") {
    return noteFileImporter;
  }
  if (mimeType.startsWith("image/")) {
    return imageFileImporter;
  }
  if (mimeType.startsWith("audio/")) {
    return audioFileImporter;
  }
  if (mimeType.startsWith("video/")) {
    return videoFileImporter;
  }
  if (mimeType === "application/pdf") {
    return pdfFileImporter;
  }

  return null;
}

function getImporterForExtension(
  extension: string,
): DocumentFileImporter | null {
  if (extension === "json") {
    return jsonFileImporter;
  }
  if (TEXT_EXTENSIONS.has(extension)) {
    return noteFileImporter;
  }
  if (IMAGE_EXTENSIONS.has(extension)) {
    return imageFileImporter;
  }
  if (AUDIO_EXTENSIONS.has(extension)) {
    return audioFileImporter;
  }
  if (VIDEO_EXTENSIONS.has(extension)) {
    return videoFileImporter;
  }
  if (extension === "pdf") {
    return pdfFileImporter;
  }

  return null;
}

function isEnvFileName(fileName: string): boolean {
  const normalized = fileName.trim().toLowerCase();
  return (
    normalized === ".env" ||
    normalized.startsWith(".env.") ||
    normalized.endsWith(".env") ||
    /\.env\.[a-z0-9-_]+$/u.test(normalized)
  );
}

export function getDocumentFileImporter(file: File): DocumentFileImporter {
  if (isEnvFileName(file.name)) {
    return envFileImporter;
  }

  const mimeImporter = getImporterForMimeType(normalizeMimeType(file.type));
  if (mimeImporter) {
    return mimeImporter;
  }

  return (
    getImporterForExtension(getFileExtension(file.name)) ?? genericFileImporter
  );
}
