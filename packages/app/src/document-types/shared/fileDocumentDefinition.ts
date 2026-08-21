import type { Icon } from "@phosphor-icons/react";
import {
  type DocumentFieldValidationIssue,
  readStringDocumentField,
  type StoredDocumentKind,
  type ValidatedDocumentFields,
} from "@symcrypt/client-sdk";
import type { AppDocumentProjectorDefinition } from "../types";

type FileDocumentFields = {
  byteLength: string;
  fileName: string;
  mimeType: string;
  sourceLastModified: string;
};

type ImageDocumentFields = FileDocumentFields & {
  height: string;
  width: string;
};

type AudioDocumentFields = FileDocumentFields & {
  durationMs: string;
};

type VideoDocumentFields = FileDocumentFields & {
  durationMs: string;
  height: string;
  width: string;
};

type PdfDocumentFields = FileDocumentFields & {
  pageCount: string;
};

function deriveFileDocumentTitle(
  fields: FileDocumentFields,
  fallbackTitle: string,
): string {
  return fields.fileName.trim() || fallbackTitle;
}

export function createFileDocumentType<
  TFields extends FileDocumentFields,
>(config: {
  createIcon: Icon;
  createLabel: string;
  kind: StoredDocumentKind;
  label: string;
  readFields: (
    source: Readonly<Record<string, unknown>>,
  ) => ValidatedDocumentFields<TFields>;
  untitledTitle: string;
}): AppDocumentProjectorDefinition {
  return {
    createIcon: config.createIcon,
    createLabel: config.createLabel,
    kind: config.kind,
    label: config.label,
    project: ({ structuredFields }) => {
      const validated = config.readFields(structuredFields);
      return {
        fieldValidationIssues: validated.issues,
        structuredFields: { ...validated.fields },
        title: deriveFileDocumentTitle(validated.fields, config.untitledTitle),
      };
    },
    untitledTitle: config.untitledTitle,
  };
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

export function readVideoDocumentFieldsFromRecord(
  source: Readonly<Record<string, unknown>>,
): ValidatedDocumentFields<VideoDocumentFields> {
  const issues: DocumentFieldValidationIssue[] = [];
  return {
    fields: {
      ...readFileDocumentBaseFields(source, issues),
      durationMs: readStringDocumentField(source, "durationMs", issues),
      height: readStringDocumentField(source, "height", issues),
      width: readStringDocumentField(source, "width", issues),
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
