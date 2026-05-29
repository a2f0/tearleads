import {
  deriveFileDocumentTitle,
  readPdfDocumentFieldsFromRecord,
} from "../shared/fileDocumentDefinition";
import type { AppDocumentProjectorDefinition } from "../types";

export const PDF_DOCUMENT_KIND = "pdf";
const PDF_DOCUMENT_UNTITLED_TITLE = "Untitled PDF";

export const pdfDocumentProjectorDefinition: AppDocumentProjectorDefinition = {
  createLabel: "New PDF",
  kind: PDF_DOCUMENT_KIND,
  label: "PDF",
  project: ({ structuredFields }) => {
    const validated = readPdfDocumentFieldsFromRecord(structuredFields);
    return {
      fieldValidationIssues: validated.issues,
      structuredFields: { ...validated.fields },
      title: deriveFileDocumentTitle(
        validated.fields,
        PDF_DOCUMENT_UNTITLED_TITLE,
      ),
    };
  },
  untitledTitle: PDF_DOCUMENT_UNTITLED_TITLE,
};
