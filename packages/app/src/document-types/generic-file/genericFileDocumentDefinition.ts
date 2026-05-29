import {
  deriveFileDocumentTitle,
  readFileDocumentFieldsFromRecord,
} from "../shared/fileDocumentDefinition";
import type { AppDocumentProjectorDefinition } from "../types";

export const GENERIC_FILE_DOCUMENT_KIND = "generic_file";
const GENERIC_FILE_DOCUMENT_UNTITLED_TITLE = "Untitled file";

export const genericFileDocumentProjectorDefinition: AppDocumentProjectorDefinition =
  {
    createLabel: "New File",
    kind: GENERIC_FILE_DOCUMENT_KIND,
    label: "file",
    project: ({ structuredFields }) => {
      const validated = readFileDocumentFieldsFromRecord(structuredFields);
      return {
        fieldValidationIssues: validated.issues,
        structuredFields: { ...validated.fields },
        title: deriveFileDocumentTitle(
          validated.fields,
          GENERIC_FILE_DOCUMENT_UNTITLED_TITLE,
        ),
      };
    },
    untitledTitle: GENERIC_FILE_DOCUMENT_UNTITLED_TITLE,
  };
