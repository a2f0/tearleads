import { createFileDocumentTypeApp } from "../shared/createDocumentTypeApp";
import { PAGE_COUNT_FIELD } from "../shared/fileDocumentReadFields";
import { PDF_DOCUMENT_KIND } from "./pdfDocumentDefinition";

export const PdfDocumentApp = createFileDocumentTypeApp(PDF_DOCUMENT_KIND, {
  extraFields: [PAGE_COUNT_FIELD],
  title: "PDF",
});
