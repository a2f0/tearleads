import { BracketsCurlyIcon } from "@phosphor-icons/react/dist/csr/BracketsCurly";
import {
  type DocumentFieldValidationIssue,
  readStringDocumentField,
  type ValidatedDocumentFields,
} from "@tearleads/client-sdk";
import { structuredFieldsProjector } from "../shared/documentFieldUtils";
import type { AppDocumentProjectorDefinition } from "../types";

export const JSON_FILE_DOCUMENT_KIND = "json_file";
const JSON_FILE_UNTITLED_TITLE = "Untitled JSON file";

export type JsonFileDocumentFields = {
  fileName: string;
};

function deriveJsonFileTitle(fields: JsonFileDocumentFields): string {
  return fields.fileName.trim() || JSON_FILE_UNTITLED_TITLE;
}

function readJsonFileFieldsFromRecord(
  source: Readonly<Record<string, unknown>>,
): ValidatedDocumentFields<JsonFileDocumentFields> {
  const issues: DocumentFieldValidationIssue[] = [];
  return {
    fields: { fileName: readStringDocumentField(source, "fileName", issues) },
    issues,
  };
}

export function readJsonFileFields(
  fields: Readonly<Record<string, unknown>>,
): JsonFileDocumentFields {
  return readJsonFileFieldsFromRecord(fields).fields;
}

export const jsonFileDocumentProjectorDefinition: AppDocumentProjectorDefinition =
  {
    createIcon: BracketsCurlyIcon,
    createLabel: "JSON File",
    kind: JSON_FILE_DOCUMENT_KIND,
    label: "JSON file",
    project: structuredFieldsProjector(
      readJsonFileFieldsFromRecord,
      deriveJsonFileTitle,
    ),
    untitledTitle: JSON_FILE_UNTITLED_TITLE,
  };
