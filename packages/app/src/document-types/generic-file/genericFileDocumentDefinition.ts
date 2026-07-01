import { FileIcon } from "@phosphor-icons/react/dist/csr/File";
import {
  deriveFileDocumentTitle,
  readFileDocumentFieldsFromRecord,
} from "../shared/fileDocumentDefinition";
import type { AppDocumentProjectorDefinition } from "../types";

export const GENERIC_FILE_DOCUMENT_KIND = "generic_file";
const GENERIC_FILE_DOCUMENT_UNTITLED_TITLE = "Untitled file";

export const genericFileDocumentProjectorDefinition: AppDocumentProjectorDefinition =
  {
    createIcon: FileIcon,
    createLabel: "File",
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
