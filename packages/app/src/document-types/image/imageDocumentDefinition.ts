import {
  deriveFileDocumentTitle,
  readImageDocumentFieldsFromRecord,
} from "../shared/fileDocumentDefinition";
import type { AppDocumentProjectorDefinition } from "../types";

export const IMAGE_DOCUMENT_KIND = "image";
const IMAGE_DOCUMENT_UNTITLED_TITLE = "Untitled image";

export const imageDocumentProjectorDefinition: AppDocumentProjectorDefinition =
  {
    createLabel: "New Image",
    kind: IMAGE_DOCUMENT_KIND,
    label: "image",
    project: ({ structuredFields }) => {
      const validated = readImageDocumentFieldsFromRecord(structuredFields);
      return {
        fieldValidationIssues: validated.issues,
        structuredFields: { ...validated.fields },
        title: deriveFileDocumentTitle(
          validated.fields,
          IMAGE_DOCUMENT_UNTITLED_TITLE,
        ),
      };
    },
    untitledTitle: IMAGE_DOCUMENT_UNTITLED_TITLE,
  };
