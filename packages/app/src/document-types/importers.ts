import type {
  DocumentAttachmentUpload,
  StoredDocumentKind,
} from "@tearleads/client-sdk";
import { AUDIO_DOCUMENT_KIND } from "./audio/audioDocumentDefinition";
import { GENERIC_FILE_DOCUMENT_KIND } from "./generic-file/genericFileDocumentDefinition";
import { IMAGE_DOCUMENT_KIND } from "./image/imageDocumentDefinition";
import { APP_DEFAULT_DOCUMENT_KIND } from "./note/noteDocument";
import { PDF_DOCUMENT_KIND } from "./pdf/pdfDocumentDefinition";

export const TEXT_FILE_IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const BINARY_FILE_IMPORT_MAX_BYTES = 50 * 1024 * 1024;

interface DocumentFileImportResult {
  attachment: DocumentAttachmentUpload | null;
  documentKind: StoredDocumentKind;
  initialText: string;
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
  ["md", "text/markdown"],
  ["mp3", "audio/mpeg"],
  ["ogg", "audio/ogg"],
  ["pdf", "application/pdf"],
  ["png", "image/png"],
  ["svg", "image/svg+xml"],
  ["txt", "text/plain"],
  ["wav", "audio/wav"],
  ["webp", "image/webp"],
]);

const TEXT_EXTENSIONS = new Set(["csv", "json", "md", "txt"]);
const IMAGE_EXTENSIONS = new Set(["gif", "jpeg", "jpg", "png", "svg", "webp"]);
const AUDIO_EXTENSIONS = new Set(["m4a", "mp3", "ogg", "wav"]);

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

  return (
    MIME_BY_EXTENSION.get(getFileExtension(file.name)) ?? declaredMimeType ?? ""
  );
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
    bytes: new Uint8Array(await file.arrayBuffer()),
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
  if (
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    mimeType === "application/csv"
  ) {
    return noteFileImporter;
  }
  if (mimeType.startsWith("image/")) {
    return imageFileImporter;
  }
  if (mimeType.startsWith("audio/")) {
    return audioFileImporter;
  }
  if (mimeType === "application/pdf") {
    return pdfFileImporter;
  }

  return null;
}

function getImporterForExtension(
  extension: string,
): DocumentFileImporter | null {
  if (TEXT_EXTENSIONS.has(extension)) {
    return noteFileImporter;
  }
  if (IMAGE_EXTENSIONS.has(extension)) {
    return imageFileImporter;
  }
  if (AUDIO_EXTENSIONS.has(extension)) {
    return audioFileImporter;
  }
  if (extension === "pdf") {
    return pdfFileImporter;
  }

  return null;
}

export function getDocumentFileImporter(file: File): DocumentFileImporter {
  const mimeImporter = getImporterForMimeType(normalizeMimeType(file.type));
  if (mimeImporter) {
    return mimeImporter;
  }

  return (
    getImporterForExtension(getFileExtension(file.name)) ?? genericFileImporter
  );
}
