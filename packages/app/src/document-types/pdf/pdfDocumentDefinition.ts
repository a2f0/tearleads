import { FilePdfIcon } from "@phosphor-icons/react/dist/csr/FilePdf";
import {
  createFileDocumentType,
  readPdfDocumentFieldsFromRecord,
} from "../shared/fileDocumentDefinition";

export const PDF_DOCUMENT_KIND = "pdf";
const PDF_DOCUMENT_UNTITLED_TITLE = "Untitled PDF";

export const pdfDocumentProjectorDefinition = createFileDocumentType({
  createIcon: FilePdfIcon,
  createLabel: "PDF",
  kind: PDF_DOCUMENT_KIND,
  label: "PDF",
  readFields: readPdfDocumentFieldsFromRecord,
  untitledTitle: PDF_DOCUMENT_UNTITLED_TITLE,
});
