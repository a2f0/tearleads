import { createFileDocumentTypeApp } from "../shared/createDocumentTypeApp";
import { PDF_DOCUMENT_KIND } from "./pdfDocumentDefinition";

export const PdfDocumentApp = createFileDocumentTypeApp(PDF_DOCUMENT_KIND, {
  extraFieldLabels: { pageCount: "Pages" },
  title: "PDF",
});
