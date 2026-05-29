import {
  type DocumentFieldValidationIssue,
  readStringDocumentField,
  type ValidatedDocumentFields,
} from "@tearleads/client-sdk";

interface FileDocumentFields {
  byteLength: string;
  fileName: string;
  mimeType: string;
  sourceLastModified: string;
}

interface ImageDocumentFields extends FileDocumentFields {
  height: string;
  width: string;
}

interface AudioDocumentFields extends FileDocumentFields {
  durationMs: string;
}

interface PdfDocumentFields extends FileDocumentFields {
  pageCount: string;
}

export function deriveFileDocumentTitle(
  fields: FileDocumentFields,
  fallbackTitle: string,
): string {
  return fields.fileName.trim() || fallbackTitle;
}

function readFileDocumentBaseFields(
  source: Readonly<Record<string, unknown>>,
  issues: DocumentFieldValidationIssue[],
): FileDocumentFields {
  return {
    byteLength: readStringDocumentField(source, "byteLength", issues),
    fileName: readStringDocumentField(source, "fileName", issues),
    mimeType: readStringDocumentField(source, "mimeType", issues),
    sourceLastModified: readStringDocumentField(
      source,
      "sourceLastModified",
      issues,
    ),
  };
}

export function readFileDocumentFieldsFromRecord(
  source: Readonly<Record<string, unknown>>,
): ValidatedDocumentFields<FileDocumentFields> {
  const issues: DocumentFieldValidationIssue[] = [];
  return {
    fields: readFileDocumentBaseFields(source, issues),
    issues,
  };
}

export function readImageDocumentFieldsFromRecord(
  source: Readonly<Record<string, unknown>>,
): ValidatedDocumentFields<ImageDocumentFields> {
  const issues: DocumentFieldValidationIssue[] = [];
  return {
    fields: {
      ...readFileDocumentBaseFields(source, issues),
      height: readStringDocumentField(source, "height", issues),
      width: readStringDocumentField(source, "width", issues),
    },
    issues,
  };
}

export function readAudioDocumentFieldsFromRecord(
  source: Readonly<Record<string, unknown>>,
): ValidatedDocumentFields<AudioDocumentFields> {
  const issues: DocumentFieldValidationIssue[] = [];
  return {
    fields: {
      ...readFileDocumentBaseFields(source, issues),
      durationMs: readStringDocumentField(source, "durationMs", issues),
    },
    issues,
  };
}

export function readPdfDocumentFieldsFromRecord(
  source: Readonly<Record<string, unknown>>,
): ValidatedDocumentFields<PdfDocumentFields> {
  const issues: DocumentFieldValidationIssue[] = [];
  return {
    fields: {
      ...readFileDocumentBaseFields(source, issues),
      pageCount: readStringDocumentField(source, "pageCount", issues),
    },
    issues,
  };
}
